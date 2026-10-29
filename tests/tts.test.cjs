const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAudio, wavInfo, readLimited, MAX_AUDIO_BYTES } = require('../lib/tts-audio.cjs');
const handler = require('../api/tts');
const pcm = seconds => Buffer.alloc(24000 * 2 * seconds);
function res() { return { headers: {}, setHeader(k,v){this.headers[k]=v}, status(n){this.code=n;return this}, json(data){this.data=data;return this}, send(data){this.data=data;return this} }; }
test('PCM conversion preserves samples and computes exact 1, 45 and 60 second durations', () => {
  for (const seconds of [1,45,60]) {
    const raw = pcm(seconds); const result = normalizeAudio(raw,'audio/pcm;rate=24000;channels=1');
    assert.equal(result.durationSeconds, seconds); assert.equal(result.sampleRate,24000);
    assert.equal(result.channels,1); assert.equal(result.bitsPerSample,16);
    assert.deepEqual(result.buffer.subarray(44),raw); assert.equal(result.buffer.length,raw.length+44);
    assert.equal(wavInfo(result.buffer).durationSeconds,seconds);
    assert.equal(normalizeAudio(result.buffer,'audio/wav').pcmFormatAssumed,false);
  }
});
test('Reject unsupported/truncated audio instead of playing error bodies', async () => {
  assert.throws(()=>normalizeAudio(Buffer.from('{"error":"private"}'),'application/json'));
  assert.throws(()=>normalizeAudio(Buffer.alloc(3),'audio/pcm'));
  assert.throws(()=>normalizeAudio(pcm(1),'audio/pcm;rate=48000'));
  const wav=normalizeAudio(pcm(1),'audio/pcm').buffer;
  assert.throws(()=>wavInfo(wav.subarray(0,wav.length-1)));
  assert.throws(()=>normalizeAudio(Buffer.alloc(MAX_AUDIO_BYTES+1),'audio/pcm'));
  await assert.rejects(()=>readLimited(new Response(Buffer.from('test'),{headers:{'content-length':MAX_AUDIO_BYTES+1}})));
});
test('API mapping, missing key, timeout and sanitized upstream errors', async () => {
  const originalFetch=global.fetch, originalKey=process.env.CHATKHU_API_KEY;
  try {
    delete process.env.CHATKHU_API_KEY;
    global.fetch=()=>{throw new Error('must not call upstream')};
    let r=res();await handler({method:'POST',body:{text:'테스트',gender:'female'}},r);
    assert.equal(r.code,503);assert.equal(r.data.code,'MISSING_TTS_KEY');assert.equal(r.data.retryable,false);
    process.env.CHATKHU_API_KEY='test-only-key';
    for (const [gender,voice] of [['female','Kore'],['male','Iapetus']]) {
      global.fetch=async(url,options)=>{
        assert.equal(url,'https://factchat-cloud.mindlogic.ai/v1/gateway/audio/speech/');
        const body=JSON.parse(options.body);assert.equal(body.voice,voice);assert.equal(body.model,'gemini-2.5-flash-preview-tts');
        assert.equal(options.headers.Authorization,'Bearer test-only-key');
        return new Response(pcm(1),{headers:{'content-type':'audio/pcm'}});
      };
      r=res();await handler({method:'POST',body:{text:'테스트',gender,voice:'lapetus'}},r);
      assert.equal(r.code,200);assert.equal(r.headers['X-Audio-Duration'],'1');assert.equal(r.headers['X-TTS-Voice'],voice);assert.equal(wavInfo(r.data).durationSeconds,1);
    }
    for (const body of [{text:'',gender:'male'},{text:'x'.repeat(6001),gender:'female'},{text:'hello',gender:'other'},{text:'hello',gender:'constructor'}]) {r=res();await handler({method:'POST',body},r);assert.equal(r.code,400);}
    for (const status of [400,401,403,429,500]) {
      global.fetch=async()=>new Response('private-key-and-error-detail',{status});r=res();await handler({method:'POST',body:{text:'테스트',gender:'male'}},r);
      assert.equal(r.data.upstreamStatus,status);assert.equal(r.data.retryable,status===429||status>=500);assert.ok(!JSON.stringify(r.data).includes('private-key'));
      if (status === 400) assert.ok(r.data.error.includes('남성 음성(Iapetus)'));
    }
    global.fetch=async()=>{throw new DOMException('timeout','TimeoutError')};r=res();await handler({method:'POST',body:{text:'테스트',gender:'male'}},r);assert.equal(r.code,504);
    global.fetch=async()=>new Response('{"audio":"unknown schema"}',{headers:{'content-type':'application/json'}});r=res();await handler({method:'POST',body:{text:'테스트',gender:'male'}},r);assert.equal(r.data.code,'TTS_AUDIO_FORMAT');
    r=res();await handler({method:'GET'},r);assert.equal(r.code,405);
  } finally { global.fetch=originalFetch;if(originalKey===undefined)delete process.env.CHATKHU_API_KEY;else process.env.CHATKHU_API_KEY=originalKey; }
});
