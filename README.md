# Dear Me

Vercel에서 Framework Preset을 `Other`로 선택하고 저장소 루트를 배포합니다.
별도의 빌드 명령이나 패키지 설치는 필요하지 않습니다. Node.js 22 이상을 사용하세요.

## 서버 환경 변수

Vercel 프로젝트의 Settings → Environment Variables에서 다음 값을 설정한 뒤 재배포하세요.

- `CHATKHU_API_KEY`: 챗쿠 API Gateway에서 발급한 키. 서버에서만 사용하며 저장소에 커밋하지 않습니다.
- `CHATKHU_MODEL`: 계정에서 사용할 수 있는 정확한 모델 ID. 제공된 명세에 모델 ID가 없어 기본값을 지정하지 않았습니다.

`POST /api/chatkhu`에 `{"message":"안녕하세요","nickname":"민민","age":25}`를 보내면 `{"reply":"..."}`를 반환합니다.
서버는 `https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions`에
Bearer 인증으로 요청합니다. 요청의 `model`, `messages`, `stream: false`와
응답의 `choices[0].message.content`는 OpenAI 호환 형식을 가정합니다.
실제 Gateway 명세가 다르면 해당 필드를 조정해야 합니다.

모델은 시스템 지시에 따라 `{"safetyType":"normal","reply":"답장"}` 또는
`{"safetyType":"danger","reply":""}` JSON을 content로 반환해야 합니다.
안전 분류가 누락되거나 형식이 잘못되면 답장을 표시하지 않고 502를 반환합니다.
서버의 보수적인 한국어·영어 위험 표현 탐지와 모델 안전 분류를 함께 사용합니다.
위험 탐지는 오탐·미탐 가능성이 있으며 전문 위험 평가를 대체하지 않습니다.
위험 응답에는 일반 편지 대신 고정 안전 안내와 109·112·119 연락처가 포함됩니다.
위험 입력과 답변은 sessionStorage에 저장하지 않습니다.

## 영상 에셋과 전송 흐름

확인 후 `/api/chatkhu` 요청과 `letter-send.mp4` 재생을 동시에 시작합니다.
일반 답장이 먼저 도착해도 전송 영상 종료/건너뛰기까지 기다립니다.
영상 종료 후 응답 대기 중에는 `loading-loop.mp4`를 반복 재생합니다.
결과 화면은 `character-loop.mp4`를 재생합니다. 읽기 마치기는 임시 답장을 지우고 사용자 설정 화면으로 돌아갑니다. `character-ending.mp4`용 요소는 후속 연출을 위해 유지합니다.
네 파일을 저장소 루트에 추가하면 코드 수정 없이 사용됩니다. 에셋이 없으면
정적 대기 안내나 텍스트 결과를 사용합니다. 자동 재생이 차단되면 비디오 컨트롤로 재생할 수 있습니다.
위험 응답이 오면 영상 재생을 즉시 멈추고 별도 안전 안내 화면을 표시합니다.

Vercel 함수의 최대 실행 시간은 `vercel.json`에서 60초로 설정합니다.
외부 API 호출은 50초 후 중단하며 브라우저는 최대 65초 동안 서버 응답을 기다립니다.
오류 응답에는 진단 코드, 요청 ID와 해당하는 경우 게이트웨이 HTTP 상태가 포함됩니다.
원문 오류 본문과 API 키는 반환하거나 로그에 기록하지 않습니다.
현재 메시지 한 건만 전송하며 이전 대화 내용은 전송하지 않습니다.

Vercel의 함수 URL은 파일 확장자를 제외한 `/api/chatkhu`입니다.
JSON이 아닌 404/HTML 응답은 함수에 도달하지 못했을 가능성이 있으므로 배포의 Functions 목록에
`api/chatkhu.js`가 있는지, Root Directory가 저장소 루트인지 확인하세요.
함수 진입 시 `chatkhu.request`, 실패 시 `chatkhu.error`를 요청 ID와 함께 기록합니다.

사용자 설정은 사진 없이 별명(1~20자)과 나이(1~120의 정수)를 받습니다.
일반 답장은 서버에서도 `그리운 [나이]살의 [별명]아,`로 시작하도록 보장합니다.
안전 안내에는 편지 호칭을 붙이지 않습니다.
