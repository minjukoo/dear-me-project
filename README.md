# Dear Me

Vercel에서 Framework Preset을 `Other`로 선택하고 저장소 루트를 배포합니다.
별도의 빌드 명령이나 패키지 설치는 필요하지 않습니다. Node.js 22 이상을 사용하세요.

## 서버 환경 변수

Vercel 프로젝트의 Settings → Environment Variables에서 다음 값을 설정한 뒤 재배포하세요.

- `CHATKHU_API_KEY`: 챗쿠 API Gateway에서 발급한 키. 서버에서만 사용하며 저장소에 커밋하지 않습니다.
- `CHATKHU_MODEL`: 계정에서 사용할 수 있는 정확한 모델 ID. 제공된 명세에 모델 ID가 없어 기본값을 지정하지 않았습니다.

`POST /api/chatkhu`에 `{"message":"안녕하세요"}`를 보내면 `{"reply":"..."}`를 반환합니다.
서버는 `https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions`에
Bearer 인증으로 요청합니다. 요청의 `model`, `messages`, `stream: false`와
응답의 `choices[0].message.content`는 OpenAI 호환 형식을 가정합니다.
실제 Gateway 명세가 다르면 해당 필드를 조정해야 합니다.

API 호출은 10초 후 중단하며 외부 서비스 오류 내용이나 API 키를 클라이언트에 반환하지 않습니다.
현재 메시지 한 건만 전송하며 이전 대화 내용은 전송하지 않습니다.
