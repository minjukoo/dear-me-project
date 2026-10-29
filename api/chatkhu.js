const { randomUUID } = require('node:crypto');
const { findProhibitedTerms, classifyInput } = require('../moderation-rules.js');
const { characters, estimateTtsSeconds, buildSystemPrompt, safetyResponse, fallbackLetter, validateLetter } = require('../lib/reply-policy.cjs');
module.exports = async function handler(req, res) {
  const requestId = randomUUID();
  const start = Date.now();
  let stage = 'validation';
  let classification;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  console.info(JSON.stringify({ event: 'chatkhu.request', requestId, method: req.method }));
  function fail(status, code, error, details = {}) {
    console.error(JSON.stringify({ event: 'chatkhu.error', requestId, code, inputType: classification?.type, stage, httpStatus: status, elapsedMs: Date.now() - start, ...details }));
    return res.status(status).json({ error, code, requestId, ...details });
  }
  function finish(payload, source) {
    console.info(JSON.stringify({ event: 'chatkhu.success', requestId, inputType: classification.type,
      safetyType: payload.safetyType, source, replyCharacters: characters(payload.reply),
      estimatedTtsSeconds: payload.safetyType === 'normal' ? estimateTtsSeconds(payload.reply) : null,
      emergencyContacts: (payload.emergencyContacts || []).map(contact => contact.number), elapsedMs: Date.now() - start }));
    return res.status(200).json(payload);
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.'); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return fail(400, 'INVALID_JSON', '올바른 JSON을 보내 주세요.'); } }
  const message = body?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) return fail(400, 'INVALID_MESSAGE', '1~2000자의 메시지를 보내 주세요.');

  // This decision is based on the concern, never on a client-provided classification.
  classification = classifyInput(message);
  console.info(JSON.stringify({ event: 'chatkhu.classified', requestId, ...classification }));
  const safe = safetyResponse(classification);
  if (safe) return finish(safe, 'safety_policy');
  const prohibitedTerms = findProhibitedTerms(message);
  if (prohibitedTerms.length) return fail(400, 'PROHIBITED_LANGUAGE', '금지어가 포함되어 있어 편지를 보낼 수 없어요. 해당 표현을 수정해 주세요.', { prohibitedTerms });
  const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
  const age = body.age;
  const gender = body.gender ?? 'undisclosed';
  if (!['female', 'male', 'other', 'undisclosed'].includes(gender)) return fail(400, 'INVALID_GENDER', '성별 설정을 확인해 주세요.');
  if (!nickname || nickname.length > 20 || /[\p{C}\r\n]/u.test(nickname) || !Number.isInteger(age) || age < 1 || age > 120) return fail(400, 'INVALID_PROFILE', '별명(1~20자)과 나이(1~120의 정수)를 설정해 주세요.');
  const salutation = `${age}살의 ${nickname}에게`;
  const apiKey = process.env.CHATKHU_API_KEY;
  const model = process.env.CHATKHU_MODEL;
  if (!apiKey || !model) {
    const missing = [!apiKey && 'CHATKHU_API_KEY', !model && 'CHATKHU_MODEL'].filter(Boolean);
    return fail(503, 'MISSING_CONFIG', `Vercel 환경 변수 ${missing.join(', ')}를 설정한 뒤 재배포해 주세요.`);
  }
  // One generation plus at most one repair share the original 50s server budget.
  const signal = AbortSignal.timeout(50000);
  let repairReason;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      stage = 'upstream_request';
      const messages = [
        { role: 'system', content: buildSystemPrompt(classification) },
        { role: 'user', content: JSON.stringify({ recipient: { nickname, age, gender }, concern: message.trim() }) },
      ];
      if (attempt) messages.push({ role: 'system', content: `이전 생성은 ${repairReason} 조건을 충족하지 못했다. 같은 고민에 답하되 호칭을 포함한 350~450자, 완결된 문장, 긴급 연락처 없음 조건을 모두 지켜 새로 작성한다. 문장을 잘라내지 않는다.` });
      const response = await fetch('https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, max_tokens: 1200 }), signal,
      });
      console.info(JSON.stringify({ event: 'chatkhu.upstream_response', requestId, attempt: attempt + 1, upstreamStatus: response.status, elapsedMs: Date.now() - start }));
      stage = 'upstream_body';
      if (!response.ok) {
        const reasons = { 400: '게이트웨이가 요청 형식을 거부했습니다. 모델 ID와 요청 규격을 확인해 주세요.', 401: '게이트웨이 인증에 실패했습니다. CHATKHU_API_KEY를 확인해 주세요.', 403: '게이트웨이 접근 권한이 없습니다. API 키와 모델 사용 권한을 확인해 주세요.', 404: '게이트웨이 경로 또는 모델을 찾지 못했습니다. 엔드포인트와 모델 ID를 확인해 주세요.', 429: '게이트웨이 요청 한도 또는 사용량 제한에 도달했습니다.' };
        return fail(response.status === 429 ? 429 : 502, 'GATEWAY_HTTP_ERROR', reasons[response.status] || `게이트웨이가 HTTP ${response.status} 오류를 반환했습니다.`, { upstreamStatus: response.status });
      }
      let data;
      try { data = await response.json(); }
      catch (error) { if (error.name !== 'SyntaxError') throw error; return fail(502, 'GATEWAY_INVALID_JSON', '게이트웨이가 올바른 JSON을 반환하지 않았습니다.'); }
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === 'length') repairReason = 'unfinished_sentence';
      else {
        const content = choice?.message?.content;
        if (typeof content !== 'string' || !content.trim()) return fail(502, 'GATEWAY_INVALID_RESPONSE', '게이트웨이 응답에 choices[0].message.content 문자열이 없거나 비어 있습니다.');
        let generated;
        try { generated = JSON.parse(content); }
        catch { return fail(502, 'GATEWAY_INVALID_SAFETY_RESPONSE', '답장의 안전 분류를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
        // A coarse model danger flag without confirmed intent must not produce emergency numbers.
        if (generated?.safetyType === 'danger') return finish(safetyResponse({ type: 'uncertain', confirmedRisk: false }), 'safety_clarification');
        if (generated?.safetyType !== 'normal' || typeof generated.reply !== 'string' || !generated.reply.trim()) return fail(502, 'GATEWAY_INVALID_SAFETY_RESPONSE', '답장의 안전 분류 또는 내용이 올바르지 않습니다.');
        stage = 'reply_validation';
        const checked = validateLetter(generated.reply, salutation);
        if (checked.valid) return finish({ reply: checked.text, safetyType: 'normal' }, attempt ? 'llm_repaired' : 'llm');
        repairReason = checked.reason;
      }
      console.warn(JSON.stringify({ event: 'chatkhu.reply_validation', requestId, inputType: classification.type, reason: repairReason, attempt: attempt + 1 }));
    }
    // Never slice an answer mid-sentence or keep unwanted phone numbers after repair fails.
    return finish({ reply: fallbackLetter(classification.type, salutation), safetyType: 'normal' }, 'validated_fallback');
  } catch (error) {
    if (error.name === 'TimeoutError') return fail(504, 'GATEWAY_TIMEOUT', '게이트웨이 응답이 50초를 초과했습니다. 다시 시도해 주세요.');
    const networkCode = error.cause?.code;
    const reasons = { ENOTFOUND: '게이트웨이 DNS 주소를 찾을 수 없습니다.', EAI_AGAIN: '게이트웨이 DNS 조회가 일시적으로 실패했습니다.', ECONNREFUSED: '게이트웨이가 연결을 거부했습니다.', ECONNRESET: '게이트웨이 연결이 중단되었습니다.', UND_ERR_CONNECT_TIMEOUT: '게이트웨이 연결 시간이 초과되었습니다.', CERT_HAS_EXPIRED: '게이트웨이 TLS 인증서가 만료되었습니다.', UNABLE_TO_VERIFY_LEAF_SIGNATURE: '게이트웨이 TLS 인증서를 검증하지 못했습니다.' };
    return fail(502, 'GATEWAY_CONNECTION_ERROR', reasons[networkCode] || '게이트웨이 요청 또는 응답 수신 중 네트워크 오류가 발생했습니다.', reasons[networkCode] ? { networkCode } : {});
  }
};
