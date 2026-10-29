const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../moderation-rules');
const handler = require('../api/chatkhu');
test('Shared rules find canonical prohibited terms, including punctuation/spacing variants', () => {
  assert.deepEqual(rules.findProhibitedTerms('씨 발, 병.신, ㅅㅂ'), ['씨발', '병신', 'ㅅㅂ']);
  assert.deepEqual(rules.findProhibitedTerms('씨발 씨발'), ['씨발']);
  assert.deepEqual(rules.findProhibitedTerms('새끼 고양이를 돌보며 새로운 시발점을 찾았어.'), []);
  assert.deepEqual(rules.findProhibitedTerms('고민이 많아서 너무 힘들고 불안해.'), []);
});
test('Server blocks prohibited language before LLM calls, logging only controlled terms', async () => {
  const originalFetch=global.fetch, originalInfo=console.info, originalError=console.error;
  const logs=[];
  const response=()=>({setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this}});
  try {
    console.info=console.error=text=>logs.push(JSON.parse(text));
    global.fetch=()=>{throw Error('must not call paid API')};
    let res=response();
    await handler({method:'POST',body:{message:'PRIVATE_CONCERN 씨발',nickname:'PRIVATE_NAME',age:25,gender:'female'}},res);
    assert.equal(res.code,400);
    assert.equal(res.data.code,'PROHIBITED_LANGUAGE');
    assert.deepEqual(res.data.prohibitedTerms,['씨발']);
    assert.deepEqual(logs.find(log=>log.code==='PROHIBITED_LANGUAGE').prohibitedTerms,['씨발']);
    assert(!JSON.stringify(logs).includes('PRIVATE'));
    res=response();
    await handler({method:'POST',body:{message:'씨발 자살하고 싶어'}},res);
    assert.equal(res.code,200);
    assert.equal(res.data.safetyType,'danger');
  } finally {global.fetch=originalFetch;console.info=originalInfo;console.error=originalError;}
});
