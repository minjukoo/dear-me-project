const $ = (selector) => document.querySelector(selector);
const video = $('#opening-video');
const photoInput = $('#photo-input');
const nicknameInput = $('#nickname-input');
const preview = $('#photo-preview');
const placeholder = $('#preview-placeholder');
const nextButton = $('#next-to-letter-btn');
const setupStatus = $('#setup-status');
const letter = $('#letter-textarea');
const sendButton = $('#send-letter-btn');
const letterStatus = $('#letter-status');
let photoData = '';
let photoVersion = 0;
let sending = false;
let latestResult = null;
const resultStorageKey = 'dearMe.letterResult';
const sendVideo = $('#send-video');
window.dearMeProfile = null;

let flow = 'idle';
let sendFinished = false;
const loadingVideo = $('#loading-video');
const characterVideo = $('#character-video');
const endingVideo = $('#ending-video');
const media = [sendVideo, loadingVideo, characterVideo, endingVideo];
function playAsset(element, filename) {
    element.hidden = false;
    element.src = `/${filename}`;
    element.play().catch(() => {
        if (element.error) element.dispatchEvent(new Event('error'));
        // Autoplay may be blocked; native controls and skip buttons remain usable.
    });
}
function showResult() {
    if (!latestResult || flow !== 'pending') return;
    flow = 'result';
    showScreen('result-screen', '#reply-title');
    endingVideo.hidden = true;
    playAsset(characterVideo, 'character-loop.mp4');
}
function finishSendVideo() {
    if (flow !== 'pending') return;
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
$('#skip-send-btn').addEventListener('click', finishSendVideo);
[loadingVideo, characterVideo, endingVideo].forEach(element => {
    element.addEventListener('error', () => { element.hidden = true; });
});
$('#finish-letter-btn').addEventListener('click', () => {
    if (flow !== 'result') return;
    characterVideo.pause();
    characterVideo.hidden = true;
    playAsset(endingVideo, 'character-ending.mp4');
});
endingVideo.addEventListener('ended', () => { endingVideo.hidden = true; });
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
    media.forEach(element => { if (!element.closest(`#${id}`)) element.pause(); });
    document.querySelectorAll('.screen').forEach((screen) => {
        const active = screen.id === id;
        screen.hidden = !active;
        screen.classList.toggle('active', active);
    });
    $(heading).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

function startSetup() {
    video.pause();
    showScreen('setup-screen', '#setup-title');
}
$('#skip-opening-btn').addEventListener('click', startSetup);
video.addEventListener('ended', startSetup);
// opening.mp4 is optional: keep the opening title and Start button usable.
function hideUnavailableVideo() { video.hidden = true; }
video.addEventListener('error', hideUnavailableVideo);
video.querySelector('source').addEventListener('error', hideUnavailableVideo);

function updateNextButton() {
    nextButton.disabled = !photoData || !nicknameInput.value.trim();
}
nicknameInput.addEventListener('input', updateNextButton);
photoInput.addEventListener('change', () => {
    const version = ++photoVersion;
    const file = photoInput.files[0];
    photoData = '';
    preview.hidden = true;
    preview.removeAttribute('src');
    placeholder.hidden = false;
    setupStatus.textContent = '';
    updateNextButton();
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
        setupStatus.textContent = '5MB 이하의 이미지 파일을 선택해 주세요.';
        photoInput.value = '';
        return;
    }
    setupStatus.textContent = '사진을 불러오고 있어요…';
    const reader = new FileReader();
    reader.onload = () => {
        if (version !== photoVersion) return;
        // Decode a separate image so an older selection cannot replace a newer one.
        const image = new Image();
        image.onload = () => {
            if (version !== photoVersion) return;
            photoData = reader.result;
            preview.src = photoData;
            preview.hidden = false;
            placeholder.hidden = true;
            setupStatus.textContent = '';
            updateNextButton();
        };
        image.onerror = () => {
            if (version !== photoVersion) return;
            setupStatus.textContent = '사진을 표시할 수 없어요. JPG, PNG 등 다른 사진을 선택해 주세요.';
        };
        image.src = reader.result;
    };
    reader.onerror = () => {
        if (version !== photoVersion) return;
        setupStatus.textContent = '사진을 읽지 못했어요. 다시 선택해 주세요.';
    };
    reader.readAsDataURL(file);
});

$('#setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!photoData || !nicknameInput.value.trim()) return;
    window.dearMeProfile = { nickname: nicknameInput.value.trim(), photo: photoData };
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
    playAsset(sendVideo, 'letter-send.mp4');
    try {
        const response = await fetch('/api/chatkhu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
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
            nickname: window.dearMeProfile?.nickname || '나',
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

// Recover the most recent reply when this tab is refreshed. Do not persist photos.
try {
    const saved = JSON.parse(sessionStorage.getItem(resultStorageKey));
    if (saved && saved.safetyType === 'normal' && typeof saved.reply === 'string' && saved.reply.trim()
        && typeof saved.nickname === 'string' && typeof saved.message === 'string') {
        latestResult = saved;
        flow = 'result';
        $('#letter-reply').textContent = saved.reply;
        $('#result-recipient').textContent = `${saved.nickname}님에게 도착한 편지`;
        letter.value = saved.message;
        window.dearMeProfile = { nickname: saved.nickname, photo: null };
        $('#display-nickname').textContent = `${saved.nickname}님`;
        video.pause();
        showScreen('result-screen', '#reply-title');
        playAsset(characterVideo, 'character-loop.mp4');
    }
} catch { /* Storage may be unavailable or contain an outdated record. */ }
