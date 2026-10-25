// Vercel Node.js Function: credentials stay on the server.
module.exports = async function handler(req, res) {
  const requestId = require('node:crypto').randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  console.info(JSON.stringify({ event: 'chatkhu.request', requestId, method: req.method }));
  function fail(status, code, error, details = {}) {
    // Only controlled metadata: never log keys, messages, or raw upstream bodies.
    console.error(JSON.stringify({ event: 'chatkhu.error', requestId, code, ...details }));
    return res.status(status).json({ error, code, requestId, ...details });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.');
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return fail(400, 'INVALID_JSON', '올바른 JSON을 보내 주세요.'); }
  }
  const message = body && body.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
    return fail(400, 'INVALID_MESSAGE', '1~2000자의 메시지를 보내 주세요.');
  }

  const apiKey = process.env.CHATKHU_API_KEY;
  const model = process.env.CHATKHU_MODEL;
  if (!apiKey || !model) {
    const missing = [!apiKey && 'CHATKHU_API_KEY', !model && 'CHATKHU_MODEL'].filter(Boolean);
    return fail(503, 'MISSING_CONFIG', `Vercel 환경 변수 ${missing.join(', ')}를 설정한 뒤 재배포해 주세요.`);
  }

  try {
    const response = await fetch(
      'https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: message.trim() }],
          stream: false,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      const reasons = {
        400: '게이트웨이가 요청 형식을 거부했습니다. 모델 ID와 요청 규격을 확인해 주세요.',
        401: '게이트웨이 인증에 실패했습니다. CHATKHU_API_KEY를 확인해 주세요.',
        403: '게이트웨이 접근 권한이 없습니다. API 키와 모델 사용 권한을 확인해 주세요.',
        404: '게이트웨이 경로 또는 모델을 찾지 못했습니다. 엔드포인트와 모델 ID를 확인해 주세요.',
        429: '게이트웨이 요청 한도 또는 사용량 제한에 도달했습니다.',
      };
      return fail(response.status === 429 ? 429 : 502, 'GATEWAY_HTTP_ERROR',
        reasons[response.status] || `게이트웨이가 HTTP ${response.status} 오류를 반환했습니다.`,
        { upstreamStatus: response.status });
    }
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (error.name !== 'SyntaxError') throw error;
      return fail(502, 'GATEWAY_INVALID_JSON', '게이트웨이가 올바른 JSON을 반환하지 않았습니다.');
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return fail(502, 'GATEWAY_INVALID_RESPONSE', '게이트웨이 응답에 choices[0].message.content 문자열이 없거나 비어 있습니다. 응답 규격을 확인해 주세요.');
    }
    return res.status(200).json({ reply });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return fail(504, 'GATEWAY_TIMEOUT', '게이트웨이 응답이 10초를 초과했습니다. 다시 시도해 주세요.');
    }
    const networkCode = error.cause?.code;
    const reasons = {
      ENOTFOUND: '게이트웨이 DNS 주소를 찾을 수 없습니다.',
      EAI_AGAIN: '게이트웨이 DNS 조회가 일시적으로 실패했습니다.',
      ECONNREFUSED: '게이트웨이가 연결을 거부했습니다.',
      ECONNRESET: '게이트웨이 연결이 중단되었습니다.',
      UND_ERR_CONNECT_TIMEOUT: '게이트웨이 연결 시간이 초과되었습니다.',
      CERT_HAS_EXPIRED: '게이트웨이 TLS 인증서가 만료되었습니다.',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: '게이트웨이 TLS 인증서를 검증하지 못했습니다.',
    };
    return fail(502, 'GATEWAY_CONNECTION_ERROR', reasons[networkCode] || '게이트웨이 요청 또는 응답 수신 중 네트워크 오류가 발생했습니다.',
      reasons[networkCode] ? { networkCode } : {});
  }
};
