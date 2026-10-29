const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeAudio } = require('../lib/tts-audio.cjs');
function client(fetch, clock = { now: 100000 }) {
  const timeouts = [];
  const logs = [];
  const context = { window: { DearMeDiagnostics: { report(event, details) { logs.push({ event, ...details }); } } }, fetch, Date: { now: () => clock.now }, AbortSignal: { timeout(ms) { timeouts.push(ms); return new AbortController().signal; } }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../tts-client.js'), 'utf8'), context);
  return { api: context.window.DearMeTTS, timeouts, logs };
}
test('60-second budget includes prefetch time; successful cached audio is reused', async () => {
  let resolve, calls = 0;
  const pending = new Promise(r => resolve = r);
  const clock = { now: 100000 };
  const { api, timeouts } = client(async () => { calls++; return pending; }, clock);
  const job = api.get('대사', 'male');
  assert.equal(api.remaining('대사', 'male'), 60000);
  clock.now += 12000;
  assert.equal(api.remaining('대사', 'male'), 48000);
  clock.now += 18000;
  assert.equal(api.remaining('대사', 'male'), 30000);
  clock.now += 30001;
  assert.equal(api.remaining('대사', 'male'), 0);
  const wav = normalizeAudio(Buffer.alloc(48000), 'audio/pcm').buffer;
  resolve(new Response(wav, { headers: { 'content-type': 'audio/wav', 'x-audio-duration': '1', 'x-tts-voice': 'Iapetus' } }));
  const data = await job;
  assert.equal((await api.get('대사', 'male')).url, data.url);
  assert.equal(calls, 1);
  assert.deepEqual(timeouts, [60000]);
  assert.equal(api.remaining('대사', 'male'), 60000);
});
test('Failure is cached, no automatic retries and the manual retry limit stays bounded', async () => {
  let calls = 0;
  const { api } = client(async () => { calls++; return new Response(JSON.stringify({ error: '일시 오류', code: 'TTS_UPSTREAM_ERROR', retryable: true }), { status: 503, headers: { 'content-type': 'application/json' } }); });
  await assert.rejects(api.get('대사', 'female'));
  await assert.rejects(api.get('대사', 'female'));
  assert.equal(calls, 1);
  await assert.rejects(api.get('대사', 'female', { retry: true }));
  await assert.rejects(api.get('대사', 'female', { retry: true }));
  await assert.rejects(api.get('대사', 'female', { retry: true }));
  assert.equal(calls, 3);
});

test('Timeout DOMException has a numeric code: classify it and log metadata without speech text', async () => {
  const clock = { now: 100000 };
  const { api, logs } = client(async () => {
    clock.now += 60000;
    throw new DOMException('PRIVATE_PROVIDER_DETAIL', 'TimeoutError');
  }, clock);
  await assert.rejects(api.get('PRIVATE_LETTER_TEXT', 'male'), error => error.code === 'TTS_CLIENT_TIMEOUT');
  const error = logs.find(log => log.event === 'tts.client_error');
  assert.equal(error.code, 'TTS_CLIENT_TIMEOUT');
  assert.equal(error.elapsedMs, 60000);
  assert.match(error.clientRequestId, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(logs).includes('PRIVATE'), false);
});
test('HTTP provider errors retain IDs and status for fallback correlation', async () => {
  const requestId = '12345678-1234-4234-8234-123456789abc';
  const { api, logs } = client(async () => new Response(JSON.stringify({ code: 'TTS_UPSTREAM_ERROR', retryable: true, requestId, upstreamStatus: 429 }), { status: 429, headers: { 'content-type': 'application/json', 'x-request-id': requestId } }));
  await assert.rejects(api.get('PRIVATE_REPLY', 'female'), error => error.requestId === requestId && error.httpStatus === 429 && error.upstreamStatus === 429);
  const details = api.info('PRIVATE_REPLY', 'female');
  assert.equal(details.requestId, requestId);
  assert.equal(details.stage, 'failed');
  assert.equal(logs.find(log => log.event === 'tts.client_error').requestId, requestId);
  assert.equal(JSON.stringify(logs).includes('PRIVATE'), false);
});
