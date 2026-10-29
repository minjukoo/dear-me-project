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
    fullscreenButton.textContent = '전체화면';
    fullscreenButton.hidden = active || !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.title = '전체화면으로 보기';
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
fullscreenButton.addEventListener('click', () => enterFullscreen());
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
const linkVideo = $('#link-video');
const clockScene = document.querySelector('.clock-scene');
let linkStarted = false;
let linkFinished = false;
let sendRun = 0;
const media = [sendVideo, linkVideo];
// Decode the background before exposing the clock or its independently loaded hand.
const clockDecoded = $('#loading-background').decode().then(() => {
    clockScene.classList.add('background-ready');
    return true;
}).catch(() => false);
clockDecoded.then(ready => {
    if (ready && flow === 'pending' && linkFinished && $('#loading-screen').classList.contains('active')) {
        linkVideo.classList.remove('link-visible');
    }
});
async function waitForClock() {
    let timer;
    try { return await Promise.race([clockDecoded, new Promise(resolve => { timer = setTimeout(() => resolve(false), 10000); })]); }
    finally { clearTimeout(timer); }
}
async function finishLink() {
    if (flow !== 'pending' || !linkStarted || linkFinished) return;
    linkFinished = true;
    linkVideo.pause(); // Retain the last decoded frame while the background loads.
    const run = sendRun;
    if (latestResult) { showResult(); return; }
    const backgroundReady = await waitForClock();
    if (flow !== 'pending' || run !== sendRun) return;
    if (latestResult) { showResult(); return; }
    showScreen('loading-screen', '#loading-title');
    // The video overlays the decoded clock: fading reveals it without a blank frame.
    if (backgroundReady || linkVideo.error) linkVideo.classList.remove('link-visible');
    $('#loading-screen').classList.add('clock-waiting');
}
linkVideo.addEventListener('playing', () => {
    if (flow !== 'pending' || !linkStarted || linkFinished) return;
    linkVideo.classList.add('link-visible');
    showScreen('loading-screen', '#loading-title');
});
linkVideo.addEventListener('ended', finishLink);
linkVideo.addEventListener('error', finishLink);
function startLink() {
    linkStarted = true;
    if (linkVideo.error) { finishLink(); return; }
    window.DearMeSound.playVideo(linkVideo).catch(finishLink);
}
function playAsset(element, filename) {
    element.hidden = false;
    if (element === sendVideo) $('#resume-send-btn').hidden = true;
    element.src = `/${filename}`;
    element.load();
    window.DearMeSound.playVideo(element).catch(() => {
        if (element.error) element.dispatchEvent(new Event('error'));
        else if (element === sendVideo) $('#resume-send-btn').hidden = false;
    });
}
function showResult() {
    if (!latestResult || flow !== 'pending' || (linkStarted && !linkFinished)) return;
    flow = 'result';
    window.DearMePlayer.prepare(latestResult);
}
function finishSendVideo() {
    // Ignore duplicate ended/error/skip events from the same playback.
    if (flow !== 'pending' || sendFinished) return;
    sendFinished = true;
    sendVideo.pause();
    if (latestResult) showResult();
    else startLink();
}
sendVideo.addEventListener('ended', finishSendVideo);
sendVideo.addEventListener('error', finishSendVideo);
$('#resume-send-btn').addEventListener('click', () => {
    window.DearMeSound.playVideo(sendVideo).then(() => { $('#resume-send-btn').hidden = true; }).catch(() => {});
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
    if (['male', 'female'].includes(result.gender)) {
        window.DearMeTTS.get(window.DearMeTTS.script(result.reply), result.gender).catch(() => {});
    }
    $('#letter-reply').textContent = result.reply;
    $('#result-recipient').textContent = `${result.nickname}님에게 도착한 편지`;
    $('#storage-status').textContent = '';
    try {
        sessionStorage.setItem(resultStorageKey, JSON.stringify(result));
    } catch {
        $('#storage-status').textContent = '브라우저 임시 저장을 사용할 수 없어 이 화면에서만 답장을 볼 수 있어요.';
    }
    if (sendFinished && (!linkStarted || linkFinished)) showResult();
}

function showScreen(id, heading) {
    fullscreenButton.classList.toggle('opening-art', id === 'opening-screen' || id === 'send-screen');
    fullscreenButton.classList.toggle('gold-art', id === 'letter-screen');
    fullscreenButton.classList.toggle('dark-art', id === 'player-screen' || id === 'ending-screen');
    fullscreenButton.classList.toggle('glass-art', ['start-screen', 'setup-screen',
        'character-select-screen', 'loading-screen', 'result-screen'].includes(id));
    updateFullscreenButton();
    if (!['player-screen', 'character-select-screen', 'ending-screen', 'result-screen'].includes(id)) window.DearMePlayer.stop();
    media.forEach(element => { if (!element.closest(`#${id}`)) element.pause(); });
    document.querySelectorAll('.screen').forEach((screen) => {
        const active = screen.id === id;
        screen.hidden = !active;
        screen.classList.toggle('active', active);
    });
    window.DearMeSound.sync();
    $(heading).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

window.addEventListener('dearme:screen', event => showScreen(event.detail.id, event.detail.heading));

function startSetup() {
    video.pause();
    showScreen('setup-screen', '#setup-title');
}
let openingFinishing = false;
function showStart() {
    if (!$('#opening-screen').classList.contains('active') || openingFinishing) return;
    openingFinishing = true;
    video.pause();
    $('#skip-opening-btn').hidden = true;
    $('#opening-screen').classList.add('opening-fading');
    setTimeout(startSetup, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600);
}
let openingStarted = false;
$('#opening-trigger').addEventListener('click', () => {
    if (openingStarted) return;
    openingStarted = true;
    $('#opening-trigger').hidden = true;
    $('#skip-opening-btn').hidden = false;
    // Both actions begin inside the same user gesture, with no intervening await.
    window.DearMeSound.unlock();
    const openingPlayback = window.DearMeSound.playVideo(video);
    enterFullscreen();
    openingPlayback.catch(showStart);
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
const sendConfirmDialog = $('#send-confirm-dialog');
function confirmLetter() {
    if (sendConfirmDialog.open) return Promise.resolve(false);
    return new Promise(resolve => {
        sendConfirmDialog.returnValue = 'cancel';
        sendConfirmDialog.addEventListener('close', () => {
            resolve(sendConfirmDialog.returnValue === 'send');
        }, { once: true });
        sendConfirmDialog.showModal();
    });
}
$('#cancel-send-btn').addEventListener('click', () => sendConfirmDialog.close('cancel'));
$('#confirm-send-btn').addEventListener('click', () => sendConfirmDialog.close('send'));
$('#letter-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    updateLetterButton();
    if (sendButton.disabled) return;
    if (!validProfile(window.dearMeProfile?.nickname, window.dearMeProfile?.age, window.dearMeProfile?.gender)) {
        showScreen('setup-screen', '#setup-title');
        return;
    }
    if (!await confirmLetter()) return;
    const message = letter.value.trim();
    sending = true;
    letter.readOnly = true;
    sendButton.textContent = '시간 우체통으로 보내는 중...';
    updateLetterButton();
    letterStatus.textContent = '시간 우체통으로 보내는 중...';
    $('#letter-form').setAttribute('aria-busy', 'true');
    flow = 'pending';
    sendFinished = false;
    linkStarted = false;
    linkFinished = false;
    sendRun++;
    $('#loading-screen').classList.remove('clock-waiting');
    linkVideo.classList.remove('link-visible');
    linkVideo.currentTime = 0;
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

// A newly loaded page always starts a fresh visit at the paused opening.
// Do not clear storage in beforeunload: cancelling must preserve this session.
try { sessionStorage.removeItem(resultStorageKey); } catch { /* Optional storage. */ }
$('#setup-form').reset();
$('#letter-form').reset();
updateNextButton();
updateLetterButton();
window.addEventListener('beforeunload', event => {
    // Browsers supply the text and may suppress prompts without user activation.
    event.preventDefault();
    event.returnValue = '';
});

if ($('#opening-screen').classList.contains('active')) {
    video.muted = true;
    video.pause();
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) showStart();
}
window.addEventListener('load', () => {
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) showStart();
});
