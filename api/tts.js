const { randomUUID } = require('node:crypto');
const { normalizeAudio, readLimited } = require('../lib/tts-audio.cjs');
// Iapetus starts with uppercase I, not lowercase L.
const VOICES = Object.freeze({ female: 'Kore', male: 'Iapetus' });
module.exports = async function handler(req, res) {
  const requestId = randomUUID();
  const start = Date.now();
  let stage = 'validation';
  const context = { model: 'gemini-2.5-flash-preview-tts' };
  const networkCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);
  const fail = (status, code, error, retryable = false, upstreamStatus) => {
    console.error(JSON.stringify({ event: 'tts.error', requestId, ...context, code, stage, httpStatus: status, upstreamStatus: upstreamStatus ?? context.upstreamStatus, retryable, elapsedMs: Date.now() - start }));
    return res.status(status).json({ error, code, retryable, requestId, ...(context.clientRequestId ? { clientRequestId: context.clientRequestId } : {}), ...(upstreamStatus ? { upstreamStatus } : {}) });
  };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.'); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return fail(400, 'INVALID_JSON', '올바른 JSON을 보내 주세요.'); } }
  if (typeof body?.clientRequestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.clientRequestId)) context.clientRequestId = body.clientRequestId;
  console.info(JSON.stringify({ event: 'tts.request', requestId, ...context }));
  if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 6000) return fail(400, 'INVALID_TEXT', '음성 대사는 1~6000자로 보내 주세요.');
  if (!Object.hasOwn(VOICES, body.gender)) return fail(400, 'INVALID_GENDER', '남자 또는 여자 캐릭터를 선택해 주세요.');
  context.voice = VOICES[body.gender];
  context.gender = body.gender;
  const key = process.env.CHATKHU_API_KEY;
  if (!key) return fail(503, 'MISSING_TTS_KEY', '서버에 CHATKHU_API_KEY를 설정한 뒤 재배포해 주세요.');
  try {
    stage = 'upstream_request';
    console.info(JSON.stringify({ event: 'tts.upstream_request', requestId, ...context, timeoutMs: 65000 }));
    const response = await fetch('https://factchat-cloud.mindlogic.ai/v1/gateway/audio/speech/', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-2.5-flash-preview-tts', input: body.text.trim(), voice: VOICES[body.gender] }),
      signal: AbortSignal.timeout(65000),
    });
    context.upstreamStatus = response.status;
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    context.contentType = ['audio/wav', 'audio/x-wav', 'audio/pcm', 'audio/raw', 'application/octet-stream', 'application/json', 'text/html', 'text/plain'].includes(mime) ? mime : 'other';
    console.info(JSON.stringify({ event: 'tts.upstream_response', requestId, ...context, elapsedMs: Date.now() - start }));
    stage = 'upstream_body';
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const error = [401, 403].includes(response.status) ? '음성 API 인증 또는 사용 권한을 확인해 주세요.' : response.status === 400 ? `${body.gender === 'male' ? '남성' : '여성'} 음성(${VOICES[body.gender]}) 요청이 거부됐어요. 음성 ID·모델 권한·요청 규격을 확인해 주세요.` : '음성 서비스가 일시적으로 응답하지 않습니다.';
      return fail(response.status === 429 ? 429 : 502, 'TTS_UPSTREAM_ERROR', error, retryable, response.status);
    }
    const bytes = await readLimited(response);
    context.bytes = bytes.length;
    stage = 'audio_decode';
    const audio = normalizeAudio(bytes, response.headers.get('content-type') || '');
    stage = 'response';
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', audio.buffer.length);
    res.setHeader('X-Audio-Duration', String(audio.durationSeconds));
    res.setHeader('X-Audio-Sample-Rate', String(audio.sampleRate));
    res.setHeader('X-Audio-Channels', String(audio.channels));
    res.setHeader('X-TTS-Voice', VOICES[body.gender]);
    res.setHeader('X-PCM-Format-Assumed', String(audio.pcmFormatAssumed));
    console.info(JSON.stringify({ event: 'tts.success', requestId, ...context, stage, voice: VOICES[body.gender], durationSeconds: audio.durationSeconds, elapsedMs: Date.now() - start, pcmFormatAssumed: audio.pcmFormatAssumed }));
    return res.status(200).send(audio.buffer);
  } catch (error) {
    context.errorName = ['Error', 'TypeError', 'TimeoutError', 'AbortError', 'RangeError'].includes(error.name) ? error.name : 'OtherError';
    context.networkCode = networkCodes.has(error.cause?.code) ? error.cause.code : undefined;
    if (error.name === 'TimeoutError') return fail(504, 'TTS_TIMEOUT', '음성 생성이 65초를 초과했습니다. 다시 시도해 주세요.', true);
    if (/AUDIO|WAV|PCM/.test(error.message)) return fail(502, 'TTS_AUDIO_FORMAT', '음성 응답 형식을 확인하지 못했습니다. API 응답 규격 확인이 필요합니다.');
    return fail(502, 'TTS_CONNECTION_ERROR', '음성 서비스에 연결하지 못했습니다.', true);
  }
};
