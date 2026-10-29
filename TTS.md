# ChatKHU Gemini TTS 연결

기존 오프닝·전송 영상·연결 영상·시계 로딩·이미지 에셋·성별 선택·립싱크 함수는 유지합니다.
`api/chatkhu.js`의 LLM 및 안전 분류 로직도 변경하지 않았습니다.

## 환경 변수와 실행

- Vercel 서버 환경 변수 `CHATKHU_API_KEY`: 기존 LLM과 같은 바인딩 사용. 브라우저에는 전달하지 않습니다.
- 기존 `CHATKHU_MODEL`은 LLM에만 필요합니다. TTS 모델은 서버에서 `gemini-2.5-flash-preview-tts`로 고정합니다.
- 여성 `Kore`, 남성 **대문자 I로 시작하는 `Iapetus`**. 이전의 소문자 L `lapetus`와 구별합니다. 요청의 임의 `voice` 필드는 무시합니다.
- 기존 Vercel 프로젝트를 재배포하면 됩니다. 추가 패키지는 필요 없습니다.
- `/api/tts`는 `vercel.json`에 90초 실행 시간을 지정했습니다. 외부 요청은 최대 65초이며, 브라우저는 음성 생성 시작부터 최대 60초 후 기본 음성으로 전환합니다. 기존 LLM 함수의 60초 설정은 유지합니다.

## 엔드포인트

`POST /api/tts`에 `{ "text": "생성된 답장", "gender": "female" }`를 전송합니다.
서버는 `https://factchat-cloud.mindlogic.ai/v1/gateway/audio/speech/`에 Bearer 인증으로 요청합니다.

성공 응답은 JSON/base64가 아닌 **WAV 파일 바이트**이며 다음 헤더를 포함합니다.

- `Content-Type: audio/wav`
- `X-Audio-Duration`: 샘플 수로 계산한 초 단위 길이
- `X-Audio-Sample-Rate`, `X-Audio-Channels`, `X-TTS-Voice`
- `X-PCM-Format-Assumed`: 원본 PCM 규격을 가정해 변환했다면 `true`

검증된 PCM WAV는 헤더를 중복 추가하지 않습니다. raw `audio/pcm`, `audio/raw`,
`application/octet-stream`은 제공된 요구사항의 **24kHz / 16-bit / mono / little-endian PCM**으로
간주해 WAV 헤더를 붙입니다. 이 바이트 규격은 아직 실제 Gateway 응답과 대조하지 못했습니다.
명시된 다른 샘플레이트·채널, JSON/base64/URL 응답, MP3, `audio/L16` 등은 추측 변환하지 않고
`TTS_AUDIO_FORMAT` 안내로 처리합니다. 해당 형식의 실제 응답 자료가 생기면 서버 어댑터만 추가해야 합니다.
최대 WAV 응답은 4 MiB로 제한해 Vercel 응답 크기 한도 아래로 유지합니다.

오류는 `{ error, code, retryable, requestId, upstreamStatus? }` 형식입니다.
키 누락은 503으로 반환하되 프런트엔드에서 브라우저 기본 음성으로 자동 전환합니다.
키 값·대사·외부 오류 원문은 응답/로그에 노출하지 않습니다.

## 프런트엔드 연결 지점

- `tts-client.js`: 성별+전체 대사별 메모리 캐시, 진행 중 요청 합치기, 성공 Blob URL 재사용.
  같은 탭에서 다시 재생할 때 재호출하지 않습니다. 최대 6개 항목이며 새로고침 초기화 정책을 유지합니다.
- `app.js`: 정상 답장을 받으면 남녀 프로필의 음성을 미리 생성합니다. 위험 응답에는 요청하지 않습니다.
  기타·미선택은 기존 캐릭터 선택을 마친 뒤 그 캐릭터의 음성을 요청합니다.
- `result-player.js`: 기존 영상 편지 화면에서 Audio를 재생하고 기존 `animateMouth`,
  `setFrame`, 자막 칸, 인사 유지, 건너뛰기 연결을 사용합니다. 새 영상/성별 매핑을 만들지 않습니다.
- 기존 마지막 "그럼 안녕."은 같은 음성 파일 끝에 포함하며, 재생 완료 후 hello 포즈 2.8초 유지도 동일합니다.
- 생성 실패 후 자동 재호출하지 않습니다. 일시 오류만 사용자 버튼으로 최초 포함 최대 3회 요청합니다.
  인증·규격·키 누락은 반복 호출하지 않습니다. 서버 음성의 생성·준비·재생 실패 시 브라우저 음성으로 자동 전환합니다.
- 건너뛰기·화면 이탈 시 음성과 애니메이션 타이머를 중단합니다. 이미 전송된 생성 요청은
  성공할 경우 캐시에 남아 다시 사용될 수 있으며, 그 요청의 과금 취소를 보장하지는 않습니다.

현재 Gateway에서 단어/문장 타임스탬프를 받지 않으므로 기존 문장 자막을 **실제 오디오 시간에
문자 수 비율로 배분**합니다. 정밀 자막 싱크/음소 립싱크는 구현하지 않았습니다.
BGM은 별도 `sound-manager.js`에서 관리하며 TTS 화면에서는 중단합니다. 새 공통 마무리 영상은 추가하지 않았고 기존 인사 이미지와 빈방 전환을 유지합니다.
서버 TTS가 기본이며, 실패하거나 준비에 60초가 걸리면 기존 Web Speech 한국어 음성 경로로 자동 전환합니다. 기기 음성이 없으면 기존 자막·편지 받기를 이용할 수 있습니다.

## 검증

외부 호출 없는 서버 검증:

```sh
node --test tests/*.test.cjs
```

PCM→WAV, 원본 WAV, 45·60초 합성 데이터의 정확한 길이, 형식/크기 오류, 음성 화이트리스트,
키 누락, 429/인증/서버 오류, 타임아웃을 검증합니다.
로컬 모의 Gateway의 실제 WAV를 Chromium에서 재생해 여성/남성, 재생 길이, 캐시 재사용,
재시도 3회 제한, 키 누락, 자동재생 거절 후 재생, 건너뛰기를 확인했습니다.
이 검증은 실제 ChatKHU 음성의 발음·품질·응답 형식을 증명하지 않습니다.

요청한 유료 검증은 키가 없고 사용자가 코드 우선 진행을 요청해 **실행하지 않았습니다**.
공식 문서 접근은 네트워크 프록시에서 403으로 차단됐으며 Python 테스트 자료는 없다고 확인받았습니다.

키가 안전하게 환경에 설정된 뒤 명시적으로 실행하는 유료 스모크 테스트:

```sh
node scripts/tts-smoke.cjs --live
```

100자 대사 1회(Kore)와 45~60초를 목표로 한 실제 편지 대사 1회(Iapetus), 최대 두 요청만 보냅니다.
자동 재시도 없이 `/tmp/dear-me-tts-smoke/`에 WAV 두 개와 응답 시간·실제 길이 보고서를 저장합니다.
두 번째 대사의 실제 길이가 범위를 벗어나면 실패로 보고하고 반복 호출하지 않습니다.
실제 음성 길이는 아직 미측정입니다. 생성된 파일의 실제 재생·발음도 별도로 확인해야 합니다.

## 음성 준비 완료 후 화면 전환

정상 LLM 답장이 도착했어도 음성 생성 중에는 기존 시계 로딩 화면을 유지합니다.
WAV를 받은 뒤 브라우저 `canplay` 상태와 실제 duration까지 확인한 후에만 캐릭터 화면으로 전환합니다.
자막에 음성 준비 문구를 표시하지 않습니다. 캐시 재생도 재생 가능 여부를 확인하며 API를 다시 호출하지 않습니다.
실패하거나 60초 준비 제한을 넘으면 로딩을 끝내고 기본 브라우저 음성으로 편지를 읽습니다.

60초 예산은 LLM 완료 후 최초 TTS prefetch 시점부터 계산하며 다운로드·브라우저 재생 준비를 포함합니다.
기본 음성으로 전환한 뒤 늦은 서버 응답이 현재 재생을 가로채지 않습니다. 자동 유료 재호출도 하지 않습니다.
기본 음성은 기기의 첫 한국어 음성을 우선하며, Gemini의 Kore/Iapetus와 동일한 목소리나 성별을 보장하지 않습니다.

### 배포 오류와 기본 음성 전환 로그

Vercel 프로젝트의 **Logs**에서 `tts.fallback`, `tts.error`, `tts.client_error`를 검색합니다. 서버 TTS 로그는 `/api/tts`, 브라우저에서 전달한 로그는 `/api/client-log` 함수에 남습니다. 클라이언트 이벤트는 `source: "browser"`로 구분합니다. 브라우저 콘솔에도 같은 클라이언트 이벤트가 표시됩니다.

- `tts.request` → `tts.upstream_request` → `tts.upstream_response` → `tts.success` 또는 `tts.error`: 서버의 요청 단계, HTTP 상태, 음성 ID, 응답 형식·크기, 경과 시간과 네트워크 오류 코드를 확인합니다.
- `tts.client_error`: 브라우저의 HTTP 오류, 네트워크 실패, 60초 요청 제한, 응답 검증 실패입니다.
- `tts.fallback`: 실제로 기본 음성(또는 음성 미지원 시 자막)으로 전환하기로 결정한 기록입니다. `code`, `stage`, `elapsedMs`, `attempts`, `httpStatus`, `upstreamStatus`, `fallback`을 확인합니다.
- `tts.playback_started`: 브라우저에서 생성된 음성이 실제 재생되기 시작한 기록입니다. 서버의 `tts.success`만으로 브라우저 재생 성공을 판단하지 않습니다.
- `tts.browser_error`: 대체한 브라우저 음성마저 실패한 경우입니다.
- `media.error`: 영상·BGM 재생 실패, `client.error`: 일반 JS 오류(가능한 경우 파일명·줄 번호), `chat.client_error`: 브라우저의 답장 요청 실패. ChatKHU 답장 API에도 단계·경과 시간·성공 여부를 남깁니다.

대표 원인:

| code | 의미 |
| --- | --- |
| `TTS_PREPARATION_TIMEOUT` | 선요청 시간을 포함한 60초 준비 제한으로 대체 음성 선택 |
| `TTS_CLIENT_TIMEOUT` | 브라우저의 60초 fetch 제한 |
| `TTS_TIMEOUT` | 서버의 외부 API 65초 제한 |
| `TTS_UPSTREAM_ERROR` | 외부 API 거부. `upstreamStatus` 400=규격, 401/403=인증·권한, 429=한도, 5xx=공급자 오류 |
| `TTS_NETWORK_ERROR` / `TTS_CONNECTION_ERROR` | 브라우저 / 서버 네트워크 문제. 서버에서는 가능한 경우 `networkCode`도 확인 |
| `TTS_AUDIO_FORMAT` / `INVALID_AUDIO` | 서버 / 브라우저의 음성 형식 검증 실패 |
| `TTS_MEDIA_LOAD_ERROR` / `TTS_MEDIA_LOAD_TIMEOUT` | 브라우저 파일 디코딩·준비 실패 / 15초 제한 |
| `TTS_DURATION_MISMATCH` | 실제 오디오 길이와 서버 계산 길이 불일치 |
| `TTS_AUTOPLAY_BLOCKED` | 브라우저 자동재생 정책으로 재생 거부 |
| `TTS_PLAYBACK_ERROR` / `TTS_PLAYBACK_START_TIMEOUT` / `TTS_PLAYBACK_STALLED` | 재생 오류 / 시작 실패 / 장시간 재생 중단 |

`requestId`로 서버 요청을 찾습니다. 응답 이전에 시간이 초과되어 서버 ID를 못 받은 경우 `clientRequestId`로 서버의 `tts.request`와 브라우저의 `tts.fallback`을 연결합니다. 서버가 나중에 성공하더라도 브라우저는 이미 기본 음성으로 전환했을 수 있습니다. 시간 초과는 공급자 내부 장애의 확정 근거가 아니며 로그에 기록된 마지막 단계까지만 판단합니다.

로그에는 편지·답장 본문, 이름, 나이, API 키, 원본 오류 메시지·스택, 오디오 데이터·URL을 포함하지 않습니다. 클라이언트 수집 API는 허용한 이벤트·필드만 기록하고 동일 출처 검사 및 본문 크기 제한을 적용합니다. 브라우저 전송은 탭당 최대 40건으로 제한하며, 실패 시 재시도하지 않습니다. 오프라인·차단 확장프로그램·탭 종료 등으로 전송이 불가능하면 Vercel 로그에 남지 않을 수 있으며 브라우저 콘솔을 확인해야 합니다. 브라우저 로그는 진단용 보고이며 신뢰할 수 있는 서버 관측과 구분해야 합니다.
