const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeAudio } = require('../lib/tts-audio.cjs');
function client(fetch, clock = { now: 100000 }) {
  const timeouts = [];
  const context = { window: {}, fetch, Date: { now: () => clock.now }, AbortSignal: { timeout(ms) { timeouts.push(ms); return new AbortController().signal; } }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../tts-client.js'), 'utf8'), context);
  return { api: context.window.DearMeTTS, timeouts };
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
