const $ = (selector) => document.querySelector(selector);
const video = $('#opening-video');
const ageInput = $('#age-input');
const genderInput = $('#gender-input');
const genders = ['female', 'male', 'other', 'undisclosed'];
const nicknameInput = $('#nickname-input');
const nextButton = $('#next-to-letter-btn');
const letter = $('#letter-textarea');
const sendButton = $('#send-letter-btn');
const letterStatus = $('#letter-status');
const fullscreenButton = $('#fullscreen-toggle');
const orientationHint = $('#orientation-hint');
let orientationAttempt = 0;
let orientationRequested = false;
let orientationFailed = false;
function updateOrientationHint() {
    orientationHint.hidden = !fullscreenElement() || !orientationFailed
        || !window.matchMedia('(orientation: portrait)').matches;
}
function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement;
}
function updateFullscreenButton() {
    const active = !!fullscreenElement();
    fullscreenButton.textContent = active ? '전체화면 나가기' : '전체화면';
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.title = active ? 'ESC로도 나갈 수 있어요' : '전체화면으로 보기';
    if (!active) {
        orientationAttempt++;
        if (orientationRequested) {
            try { window.screen.orientation?.unlock?.(); } catch { /* Unsupported browser. */ }
        }
        orientationRequested = false;
        orientationFailed = false;
    }
    updateOrientationHint();
}
async function tryLandscapeLock() {
    if (!fullscreenElement() || !(navigator.maxTouchPoints > 0
        || window.matchMedia('(pointer: coarse)').matches)) return;
    const attempt = ++orientationAttempt;
    orientationRequested = true;
    try {
        if (!window.screen.orientation?.lock) throw new Error('unsupported');
        await window.screen.orientation.lock('landscape');
        if (attempt !== orientationAttempt || !fullscreenElement()) {
            try { window.screen.orientation?.unlock?.(); } catch { /* No active lock. */ }
            return;
        }
        orientationFailed = false;
    } catch {
        if (attempt !== orientationAttempt || !fullscreenElement()) return;
        orientationFailed = true;
    }
    updateOrientationHint();
}
async function enterFullscreen() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request || document.fullscreenEnabled === false) return;
    fullscreenButton.hidden = false;
    if (fullscreenElement()) return;
    try { await request.call(root); }
    catch { $('#fullscreen-status').textContent = '전체화면을 사용할 수 없어 일반 화면으로 계속합니다.'; }
    updateFullscreenButton();
    await tryLandscapeLock();
}
fullscreenButton.addEventListener('click', async () => {
    if (!fullscreenElement()) { enterFullscreen(); return; }
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try { if (exit) await exit.call(document); }
    catch { $('#fullscreen-status').textContent = 'ESC를 눌러 전체화면을 나갈 수 있어요.'; }
    updateFullscreenButton();
});
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
window.addEventListener('resize', updateOrientationHint);
let sending = false;
let latestResult = null;
const resultStorageKey = 'dearMe.letterResult';
const sendVideo = $('#send-video');
window.dearMeProfile = null;

let flow = 'idle';
let sendFinished = false;
const loadingVideo = $('#loading-video');
const media = [sendVideo, loadingVideo];
function playAsset(element, filename) {
    element.hidden = false;
    if (element === sendVideo) $('#resume-send-btn').hidden = true;
    element.muted = true;
    element.src = `/${filename}`;
    element.load();
    element.play().catch(() => {
        if (element.error) element.dispatchEvent(new Event('error'));
        else if (element === sendVideo) $('#resume-send-btn').hidden = false;
    });
}
function showResult() {
    if (!latestResult || flow !== 'pending') return;
    flow = 'result';
    window.DearMePlayer.prepare(latestResult);
}
function finishSendVideo() {
    // Ignore duplicate ended/error/skip events from the same playback.
    if (flow !== 'pending' || sendFinished) return;
    sendFinished = true;
    sendVideo.pause();
    if (latestResult) showResult();
    else {
        showScreen('loading-screen', '#loading-title');
        playAsset(loadingVideo, 'loading-loop.mp4');
    }
}
sendVideo.addEventListener('ended', finishSendVideo);
sendVideo.addEventListener('error', finishSendVideo);
$('#resume-send-btn').addEventListener('click', () => {
    sendVideo.play().then(() => { $('#resume-send-btn').hidden = true; }).catch(() => {});
});
[loadingVideo].forEach(element => {
    element.addEventListener('error', () => { element.hidden = true; });
});
$('#finish-letter-btn').addEventListener('click', () => {
    if (flow !== 'result') return;
    flow = 'idle';
    latestResult = null;
    letter.value = '';
    letterStatus.textContent = '';
    try { sessionStorage.removeItem(resultStorageKey); } catch { /* Optional storage. */ }
    updateLetterButton();
    updateNextButton();
    showScreen('setup-screen', '#setup-title');
});
function writeAgain() {
    flow = 'idle';
    latestResult = null;
    letter.value = '';
    letterStatus.textContent = '';
    updateLetterButton();
    showScreen('letter-screen', '#letter-title');
}
$('#write-again-btn').addEventListener('click', writeAgain);
$('#safety-back-btn').addEventListener('click', writeAgain);

function receiveReply(result) {
    latestResult = result;
    if (result.safetyType === 'danger') {
        flow = 'danger';
        try { sessionStorage.removeItem(resultStorageKey); } catch { /* Optional storage. */ }
        $('#safety-message').textContent = result.reply;
        showScreen('safety-screen', '#safety-title');
        return;
    }
    $('#letter-reply').textContent = result.reply;
    $('#result-recipient').textContent = `${result.nickname}님에게 도착한 편지`;
    $('#storage-status').textContent = '';
    try {
        sessionStorage.setItem(resultStorageKey, JSON.stringify(result));
    } catch {
        $('#storage-status').textContent = '브라우저 임시 저장을 사용할 수 없어 이 화면에서만 답장을 볼 수 있어요.';
    }
    if (sendFinished) showResult();
}

function showScreen(id, heading) {
    if (id !== 'opening-screen' && id !== 'start-screen'
        && ((document.documentElement.requestFullscreen && document.fullscreenEnabled !== false)
            || document.documentElement.webkitRequestFullscreen)) fullscreenButton.hidden = false;
    if (!['player-screen', 'character-select-screen', 'ending-screen', 'result-screen'].includes(id)) window.DearMePlayer.stop();
    media.forEach(element => { if (!element.closest(`#${id}`)) element.pause(); });
    document.querySelectorAll('.screen').forEach((screen) => {
        const active = screen.id === id;
        screen.hidden = !active;
        screen.classList.toggle('active', active);
    });
    $(heading).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

window.addEventListener('dearme:screen', event => showScreen(event.detail.id, event.detail.heading));

function startSetup() {
    video.pause();
    showScreen('setup-screen', '#setup-title');
}
function showStart() {
    if (!$('#opening-screen').classList.contains('active')) return;
    video.pause();
    showScreen('start-screen', '#start-btn');
}
$('#start-btn').addEventListener('click', () => {
    // Request during the user gesture; do not wait for permission to continue.
    enterFullscreen();
    startSetup();
});
$('#skip-opening-btn').addEventListener('click', showStart);
video.addEventListener('ended', showStart);
// Missing video or autoplay restrictions must not leave a blank opening.
function hideUnavailableVideo() { showStart(); }
video.addEventListener('error', hideUnavailableVideo);
video.querySelector('source').addEventListener('error', hideUnavailableVideo);

function validProfile(nickname, age, gender = 'undisclosed') {
    return typeof nickname === 'string' && nickname.trim().length > 0
        && nickname.trim().length <= 20 && !/[\p{C}\r\n]/u.test(nickname)
        && Number.isInteger(age) && age >= 1 && age <= 120 && genders.includes(gender);
}
function updateNextButton() {
    nextButton.disabled = !validProfile(nicknameInput.value, ageInput.valueAsNumber, genderInput.value);
}
nicknameInput.addEventListener('input', updateNextButton);
ageInput.addEventListener('input', updateNextButton);
genderInput.addEventListener('change', updateNextButton);

$('#setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validProfile(nicknameInput.value, ageInput.valueAsNumber, genderInput.value)) return;
    window.dearMeProfile = { nickname: nicknameInput.value.trim(), age: ageInput.valueAsNumber, gender: genderInput.value };
    $('#display-nickname').textContent = `${window.dearMeProfile.nickname}님`;
    showScreen('letter-screen', '#letter-title');
});

function updateLetterButton() {
    $('#char-count').textContent = `${letter.value.length.toLocaleString('ko-KR')} / 1,000자`;
    sendButton.disabled = sending || letter.value.trim().length < 50 || letter.value.length > 1000;
}
letter.addEventListener('input', updateLetterButton);
$('#letter-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    updateLetterButton();
    if (sendButton.disabled) return;
    if (!validProfile(window.dearMeProfile?.nickname, window.dearMeProfile?.age, window.dearMeProfile?.gender)) {
        showScreen('setup-screen', '#setup-title');
        return;
    }
    if (!window.confirm('정말 편지를 보낼까요?')) return;
    const message = letter.value.trim();
    sending = true;
    letter.readOnly = true;
    sendButton.textContent = '시간 우체통으로 보내는 중...';
    updateLetterButton();
    letterStatus.textContent = '시간 우체통으로 보내는 중...';
    $('#letter-form').setAttribute('aria-busy', 'true');
    flow = 'pending';
    sendFinished = false;
    latestResult = null;
    try { sessionStorage.removeItem(resultStorageKey); } catch { /* Optional storage. */ }
    showScreen('send-screen', '#send-title');
    // Start playback without awaiting it; the API request runs in parallel.
    playAsset(sendVideo, 'letter-send.mp4');
    try {
        const response = await fetch('/api/chatkhu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, ...window.dearMeProfile }),
            signal: AbortSignal.timeout(65000),
        });
        let data;
        const text = await response.text();
        try { data = JSON.parse(text); }
        catch { throw new Error(`API가 JSON 대신 다른 응답을 반환했습니다 (HTTP ${response.status}). 서버리스 함수 배포와 라우팅을 확인해 주세요.`); }
        if (!response.ok) {
            throw new Error(`${data?.error || '답변을 받지 못했습니다.'} (HTTP ${response.status}${data?.code ? `, ${data.code}` : ''}${data?.requestId ? `, 요청 ${data.requestId}` : ''})`);
        }
        if (typeof data?.reply !== 'string' || !data.reply.trim()) throw new Error('답장 형식이 올바르지 않습니다.');
        if (!['normal', 'danger'].includes(data.safetyType)) throw new Error('답장의 안전 분류를 확인하지 못했습니다. 다시 시도해 주세요.');
        receiveReply({
            nickname: window.dearMeProfile.nickname,
            age: window.dearMeProfile.age,
            gender: window.dearMeProfile.gender,
            message,
            reply: data.reply,
            safetyType: data.safetyType === 'danger' ? 'danger' : 'normal',
            receivedAt: new Date().toISOString(),
        });
        letterStatus.textContent = '';
    } catch (error) {
        flow = 'error';
        showScreen('letter-screen', '#letter-title');
        letterStatus.textContent = error.name === 'TimeoutError'
            ? '응답이 늦어지고 있어요. 다시 시도해 주세요.'
            : error instanceof TypeError
                ? 'API에 연결하지 못했습니다. 네트워크 연결과 배포 주소를 확인해 주세요.'
                : error.message || '편지를 보내지 못했어요. 다시 시도해 주세요.';
    } finally {
        sending = false;
        letter.readOnly = false;
        sendButton.textContent = '미래의 나에게 보내기';
        $('#letter-form').removeAttribute('aria-busy');
        updateLetterButton();
    }
});

// Recover only replies with a complete current profile.
try {
    const saved = JSON.parse(sessionStorage.getItem(resultStorageKey));
    if (saved && saved.safetyType === 'normal' && typeof saved.reply === 'string' && saved.reply.trim()
        && validProfile(saved.nickname, saved.age, saved.gender) && typeof saved.message === 'string') {
        latestResult = saved;
        flow = 'result';
        $('#letter-reply').textContent = saved.reply;
        $('#result-recipient').textContent = `${saved.nickname}님에게 도착한 편지`;
        letter.value = saved.message;
        window.dearMeProfile = { nickname: saved.nickname, age: saved.age, gender: saved.gender || 'undisclosed' };
        nicknameInput.value = saved.nickname;
        ageInput.value = saved.age;
        genderInput.value = saved.gender || 'undisclosed';
        updateNextButton();
        $('#display-nickname').textContent = `${saved.nickname}님`;
        video.pause();
        window.DearMePlayer.prepare(saved);
    }
} catch { /* Storage may be unavailable or contain an outdated record. */ }

if ($('#opening-screen').classList.contains('active')) {
    video.muted = true;
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) showStart();
    else video.play().catch(showStart);
}
window.addEventListener('load', () => {
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) showStart();
});
