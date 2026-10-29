// Explicit paid smoke test. Exactly two upstream calls, no retries.
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const handler = require('../api/tts');
const first = '25살의 민민에게. 요즘 해야 할 일이 겹쳐서 마음이 무거웠겠네. 오늘은 꼭 필요한 일 하나만 정하고 짧게 시작해 봐. 작은 기록이 다음 선택의 기준이 될 수 있어. 지금 할 수 있는 만큼이면 충분해.';
const short = first.slice(0,99)+'!';
const long = '25살의 민민에게. 새로운 일을 시작하고 싶은데 생활비와 시간을 생각하면 쉽게 결정하기 어렵겠네. 지금은 어느 선택이 더 멋진지보다, 감당할 수 있는 범위를 먼저 살펴보면 좋겠어. 이번 주에는 한 달 생활비와 꼭 필요한 지출을 적어 봐. 그리고 하루 이십 분 정도, 관심 있는 일을 작게 경험해 보는 건 어떨까. 직접 해본 기록이 생기면 막연한 불안과 실제 어려움을 구분하기 쉬워질 거야. 당장 큰 결정을 내릴 필요는 없어. 다음 주에 기록을 다시 읽고, 계속해 보고 싶은 부분 하나만 골라도 좋아. 네 속도로 선택해도 괜찮아. 그럼 안녕.';
async function main(){
  if (!process.argv.includes('--live')) throw new Error('Paid calls are disabled. Use --live explicitly.');
  if (!process.env.CHATKHU_API_KEY) throw new Error('CHATKHU_API_KEY is not set; no calls made.');
  const output = '/tmp/dear-me-tts-smoke'; mkdirSync(output,{recursive:true});
  const report=[];
  for(const sample of [{name:'100-chars',text:short,gender:'female'},{name:'45-60s-letter',text:long,gender:'male'}]){
    const start=Date.now();const headers={};let status;
    const response={setHeader(k,v){headers[k]=v},status(n){status=n;return this},json(data){this.error=data;return this},send(buffer){this.audio=buffer;return this}};
    await handler({method:'POST',body:{text:sample.text,gender:sample.gender}},response);
    const row={name:sample.name,characters:sample.text.length,status,elapsedMs:Date.now()-start,voice:headers['X-TTS-Voice']};
    if(response.audio){row.durationSeconds=Number(headers['X-Audio-Duration']);row.file=path.join(output,sample.name+'.wav');writeFileSync(row.file,response.audio);row.durationInTarget=sample.name==='45-60s-letter'?row.durationSeconds>=45&&row.durationSeconds<=60:null;}
    else row.errorCode=response.error?.code;
    report.push(row);console.log(JSON.stringify(row));
  }
  writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  if(report.some(r=>r.status!==200||r.durationInTarget===false))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
