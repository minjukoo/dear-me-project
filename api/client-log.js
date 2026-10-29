// Browser diagnostics are untrusted metadata, never user content or raw exceptions.
const events = new Set(['tts.client_request', 'tts.client_ready', 'tts.client_error', 'tts.fallback', 'tts.playback_started', 'tts.browser_error', 'media.error', 'client.error', 'chat.client_error', 'chat.input_blocked']);
const codes = new Set(['TTS_CLIENT_TIMEOUT', 'TTS_NETWORK_ERROR', 'TTS_HTTP_ERROR', 'INVALID_AUDIO', 'INVALID_INPUT', 'MISSING_TTS_KEY', 'TTS_UPSTREAM_ERROR', 'TTS_TIMEOUT', 'TTS_AUDIO_FORMAT', 'TTS_CONNECTION_ERROR', 'TTS_PREPARATION_TIMEOUT', 'TTS_MEDIA_LOAD_TIMEOUT', 'TTS_MEDIA_LOAD_ERROR', 'TTS_DURATION_MISMATCH', 'TTS_PLAYBACK_ERROR', 'TTS_PLAYBACK_START_TIMEOUT', 'TTS_PLAYBACK_STALLED', 'TTS_AUTOPLAY_BLOCKED', 'TTS_UNKNOWN_ERROR', 'BROWSER_SPEECH_ERROR', 'BROWSER_SPEECH_START_TIMEOUT', 'MEDIA_PLAYBACK_ERROR', 'JS_RUNTIME_ERROR', 'UNHANDLED_REJECTION', 'PROHIBITED_LANGUAGE', 'CHAT_CLIENT_TIMEOUT', 'CHAT_NETWORK_ERROR', 'CHAT_UNKNOWN_ERROR', 'CHAT_INVALID_RESPONSE', 'METHOD_NOT_ALLOWED', 'INVALID_JSON', 'INVALID_MESSAGE', 'INVALID_PROFILE', 'INVALID_TEXT', 'INVALID_GENDER', 'MISSING_CONFIG', 'GATEWAY_HTTP_ERROR', 'GATEWAY_INVALID_JSON', 'GATEWAY_INVALID_RESPONSE', 'GATEWAY_INVALID_SAFETY_RESPONSE', 'GATEWAY_TIMEOUT', 'GATEWAY_CONNECTION_ERROR']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  const origin = req.headers?.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).end(); }
    catch { return res.status(403).end(); }
  }
  let body = req.body;
  if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body || {})) > 4096) return res.status(413).end();
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).end(); } }
  if (!events.has(body?.event)) return res.status(400).end();
  const log = { event: body.event, source: 'browser', receivedAt: new Date().toISOString() };
  for (const key of ['requestId', 'clientRequestId']) if (typeof body[key] === 'string' && uuid.test(body[key])) log[key] = body[key];
  if (codes.has(body.code)) log.code = body.code;
  for (const key of ['elapsedMs', 'remainingMs', 'durationSeconds', 'attempts', 'mediaCode', 'httpStatus', 'upstreamStatus', 'line']) {
    if (typeof body[key] === 'number' && Number.isFinite(body[key]) && body[key] >= 0 && body[key] <= 3600000) log[key] = body[key];
  }
  for (const [key, values] of Object.entries({ stage: ['request', 'body', 'ready', 'failed', 'media_load', 'transition', 'playback'], gender: ['male', 'female'], voice: ['Kore', 'Iapetus'], fallback: ['browser', 'captions'], media: ['opening-video', 'send-video', 'link-video', 'bgm', 'bgm-unlock'], script: ['app.js', 'result-player.js', 'tts-client.js', 'sound-manager.js', 'media-layout.js', 'diagnostics.js'], browserCode: ['canceled', 'interrupted', 'audio-busy', 'audio-hardware', 'network', 'synthesis-unavailable', 'synthesis-failed', 'language-unavailable', 'voice-unavailable', 'text-too-long', 'invalid-argument', 'not-allowed'] })) {
    if (values.includes(body[key])) log[key] = body[key];
  }
  if (body.event === 'chat.input_blocked' && Array.isArray(body.prohibitedTerms)) {
    const { terms } = require('../moderation-rules.js');
    log.prohibitedTerms = [...new Set(body.prohibitedTerms)].filter(term => terms.includes(term));
  }
  // This describes a browser report; it is not proof of an upstream provider failure.
  const level = /error$/.test(log.event) ? 'error' : ['tts.fallback', 'chat.input_blocked'].includes(log.event) ? 'warn' : 'info';
  console[level](JSON.stringify(log));
  return res.status(204).end();
};
