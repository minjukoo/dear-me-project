const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/client-log');
const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.code=n;return this; }, end() { return this; } });
test('Browser log ingestion allows diagnostic metadata and drops private/raw fields', async () => {
  const logs = [];
  const original = console.warn;
  console.warn = text => logs.push(JSON.parse(text));
  try {
    const res = response();
    await handler({ method: 'POST', headers: { origin: 'https://dear-me-project.vercel.app', host: 'dear-me-project.vercel.app' }, body: {
      event: 'tts.fallback', code: 'TTS_PREPARATION_TIMEOUT', stage: 'request', elapsedMs: 60000,
      clientRequestId: '12345678-1234-4234-8234-123456789abc', fallback: 'browser', gender: 'male',
      text: 'PRIVATE_TEXT', nickname: 'PRIVATE_NAME', message: 'PRIVATE_ERROR', key: 'PRIVATE_KEY', url: 'PRIVATE_URL', stack: 'PRIVATE_STACK',
    } }, res);
    assert.equal(res.code,204);
    assert.equal(logs.length,1);
    assert.equal(logs[0].code,'TTS_PREPARATION_TIMEOUT');
    assert.equal(logs[0].elapsedMs,60000);
    assert.equal(logs[0].source,'browser');
    assert.equal(JSON.stringify(logs).includes('PRIVATE'),false);
    const blocked=response();
    await handler({method:'POST',headers:{},body:{event:'chat.input_blocked',code:'PROHIBITED_LANGUAGE',prohibitedTerms:['씨발','PRIVATE_UNREGISTERED_TERM']}},blocked);
    assert.equal(blocked.code,204);
    assert.deepEqual(logs[1].prohibitedTerms,['씨발']);
    assert.equal(JSON.stringify(logs).includes('PRIVATE'),false);
  } finally { console.warn=original; }
});
test('Reject invalid events, malformed JSON, oversized bodies and cross-site origins', async () => {
  for (const [body, headers, code] of [
    [{event:'arbitrary'}, {}, 400], ['{bad',{},400], ['x'.repeat(4097),{},413],
    [{event:'tts.fallback'},{origin:'https://other.example',host:'dear-me-project.vercel.app'},403],
  ]) {
    const res=response(); await handler({method:'POST',body,headers},res);assert.equal(res.code,code);
  }
});
test('Server TTS diagnostics correlate the client ID and expose safe network cause without private input', async () => {
  const handler = require('../api/tts');
  const fetchOriginal = global.fetch, infoOriginal = console.info, errorOriginal = console.error;
  const keyOriginal = process.env.CHATKHU_API_KEY;
  const logs=[];
  try {
    console.info = console.error = text => logs.push(JSON.parse(text));
    process.env.CHATKHU_API_KEY='PRIVATE_SECRET_KEY';
    global.fetch=async()=>{throw Object.assign(new TypeError('PRIVATE_RAW_MESSAGE'),{cause:{code:'ECONNRESET'}})};
    const res = { headers:{}, setHeader(k,v){this.headers[k]=v;}, status(n){this.code=n;return this;}, json(data){this.data=data;return this;} };
    const clientRequestId='12345678-1234-4234-8234-123456789abc';
    await handler({method:'POST',body:{text:'PRIVATE_LETTER',gender:'female',clientRequestId}},res);
    const error=logs.find(log=>log.event==='tts.error');
    assert.equal(error.clientRequestId,clientRequestId);
    assert.equal(error.requestId,res.data.requestId);
    assert.equal(error.networkCode,'ECONNRESET');
    assert.equal(error.stage,'upstream_request');
    assert.equal(error.voice,'Kore');
    assert.equal(error.code,'TTS_CONNECTION_ERROR');
    assert.equal(typeof error.elapsedMs,'number');
    assert.equal(JSON.stringify(logs).includes('PRIVATE'),false);
  } finally {
    global.fetch=fetchOriginal;console.info=infoOriginal;console.error=errorOriginal;
    if(keyOriginal===undefined)delete process.env.CHATKHU_API_KEY;else process.env.CHATKHU_API_KEY=keyOriginal;
  }
});
