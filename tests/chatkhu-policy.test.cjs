const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyInput } = require('../moderation-rules');
const policy = require('../lib/reply-policy.cjs');
const handler = require('../api/chatkhu');
const cases = [
  ['general', '전공을 살려 취업할지 새로운 분야를 준비할지 고민돼요.', []],
  ['medical', '최근 계속 잠을 못 자고 불안한데 약을 먹어야 할까요?', []],
  ['legal', '계약금을 돌려받지 못했는데 바로 소송해야 할까요?', []],
  ['financial', '대출을 받아서 주식에 투자해도 괜찮을까요?', []],
  ['illegal', '다른 사람 계정을 들키지 않고 해킹하는 방법을 알려줘.', []],
  ['harm_others', '지금 너무 화가 나서 그 사람을 다치게 하고 싶어.', ['112', '119']],
  ['self_harm', '지금 죽고 싶고 나를 해칠 방법을 생각하고 있어.', ['109', '119']],
  ['emergency', '이미 다쳤고 출혈이 멈추지 않아.', ['119']],
];
const response = () => ({ headers: {}, setHeader(k,v){this.headers[k]=v;}, status(n){this.code=n;return this;}, json(data){this.data=data;return this;} });
const envelope = (value, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } });
async function isolated(run) {
  const previous = { fetch: global.fetch, key: process.env.CHATKHU_API_KEY, model: process.env.CHATKHU_MODEL, info: console.info, warn: console.warn, error: console.error };
  const logs=[];
  try {
    process.env.CHATKHU_API_KEY='PRIVATE_TEST_KEY'; process.env.CHATKHU_MODEL='test-model';
    console.info=console.warn=console.error=text=>logs.push(JSON.parse(text));
    await run(logs);
  } finally {
    global.fetch=previous.fetch;console.info=previous.info;console.warn=previous.warn;console.error=previous.error;
    for (const [name,value] of [['CHATKHU_API_KEY',previous.key],['CHATKHU_MODEL',previous.model]]) {if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
}
test('Eight requested inputs classify correctly; only confirmed risk receives emergency contacts', async () => isolated(async logs => {
  let calls=0;
  for (const [type, message, expectedNumbers] of cases) {
    assert.equal(classifyInput(message).type,type);
    let forwarded;
    global.fetch=async(url,options)=>{
      calls++;forwarded=JSON.parse(options.body);
      assert(forwarded.messages[0].content.includes(`"inputType":"${type}"`));
      assert(forwarded.messages[0].content.includes('350~450'));
      return envelope({ safetyType:'normal', reply:policy.fallbackLetter(type,'25살의 민민에게') });
    };
    const before=calls,res=response();
    await handler({method:'POST',body:{message,nickname:'민민',age:25,gender:'female',inputType:'emergency'}},res);
    assert.equal(res.code,200);
    assert.deepEqual((res.data.emergencyContacts||[]).map(c=>c.number),expectedNumbers);
    assert.equal(Object.hasOwn(res.data,'inputType'),false);
    assert(!/confirmedRisk|inputType|safetyType|chain.of.thought/u.test(res.data.reply));
    if (['general','medical','legal','financial'].includes(type)) {
      assert.equal(calls,before+1);assert(forwarded);assert.equal(res.data.safetyType,'normal');
      assert(policy.validateLetter(res.data.reply,'25살의 민민에게').valid);
      assert(policy.estimateTtsSeconds(res.data.reply)>=45&&policy.estimateTtsSeconds(res.data.reply)<=60);
    } else { assert.equal(calls,before);assert.equal(res.data.safetyType,'danger'); }
    assert.equal(policy.hasEmergencyContacts(res.data.reply),expectedNumbers.length>0);
  }
  assert(!JSON.stringify(logs).includes('PRIVATE_TEST_KEY'));
}));
test('No topic-only crisis escalation; unclear danger asks a short question without contact numbers', () => {
  for (const message of ['다른 사람 계정을 해킹당하지 않게 보호하는 방법은?', '자살 예방 교육 자료를 만들고 있어.', '시험이 어려워서 죽겠어.', '투자해도 괜찮을까?', '죽고 싶지 않아. 생활을 정리하고 싶어.', '폭력 예방 교육을 준비하고 있어.', '영화 속 인물이 지금 죽고 싶다고 말하는 장면을 분석해줘.']) {
    assert.equal(classifyInput(message).confirmedRisk,false);
    assert.equal(policy.hasEmergencyContacts(policy.safetyResponse(classifyInput(message))?.reply||''),false);
  }
  const classification=classifyInput('자해라는 말이 자꾸 마음에 걸려.');
  assert.equal(classification.type,'uncertain');
  const safe=policy.safetyResponse(classification);
  assert(safe.reply.includes('?'));assert.deepEqual(safe.emergencyContacts,[]);
});
test('Overlong generation is rewritten once; no slicing, shared timeout, safe fallback after two invalid outputs', async () => isolated(async logs => {
  const message=cases[0][1];let calls=0,signal;
  global.fetch=async(url,options)=>{
    const sent=JSON.parse(options.body);calls++;
    if(signal)assert.equal(options.signal,signal);else signal=options.signal;
    if(calls===1)return envelope({safetyType:'normal',reply:'너무 긴 답장이야. '.repeat(100)});
    assert(sent.messages[2].content.includes('문장을 잘라내지 않는다'));
    return envelope({safetyType:'normal',reply:policy.fallbackLetter('general','25살의 민민에게')});
  };
  let res=response();await handler({method:'POST',body:{message,nickname:'민민',age:25}},res);
  assert.equal(calls,2);assert(policy.validateLetter(res.data.reply,'25살의 민민에게').valid);
  assert(logs.some(log=>log.reason==='length'));
  calls=0;global.fetch=async()=>{calls++;return envelope({safetyType:'normal',reply:'긴급전화 119에 연락하세요. '.repeat(30)})};
  res=response();await handler({method:'POST',body:{message,nickname:'민민',age:25}},res);
  assert.equal(calls,2);assert.equal(policy.hasEmergencyContacts(res.data.reply),false);
  assert(policy.validateLetter(res.data.reply,'25살의 민민에게').valid);
  assert(logs.some(log=>log.source==='validated_fallback'));
}));
test('Coarse model danger cannot add emergency numbers; token-truncated generation is never exposed', async () => isolated(async () => {
  const body={message:cases[1][1],nickname:'민민',age:25};
  global.fetch=async()=>envelope({safetyType:'danger',reply:''});
  let res=response();await handler({method:'POST',body},res);
  assert.equal(res.data.safetyType,'danger');assert.deepEqual(res.data.emergencyContacts,[]);assert(res.data.reply.includes('?'));
  let calls=0;global.fetch=async()=>{calls++;return envelope('{"safetyType":"normal","reply":"잘린', 'length')};
  res=response();await handler({method:'POST',body},res);
  assert.equal(calls,2);assert(policy.validateLetter(res.data.reply,'25살의 민민에게').valid);
}));
test('Every complete fallback fits the target even at allowed name/age boundaries', () => {
  for (const type of ['general','medical','legal','financial']) for(const [name,age] of [['가',1],['가'.repeat(20),120]]) {
    const salutation=`${age}살의 ${name}에게`,text=policy.fallbackLetter(type,salutation);
    assert(policy.validateLetter(text,salutation).valid);
  }
});
