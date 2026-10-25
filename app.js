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
window.dearMeProfile = null;

function showScreen(id, heading) {
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
    sending = true;
    updateLetterButton();
    letterStatus.textContent = '미래의 나에게 편지를 전하고 있어요…';
    $('#reply-panel').hidden = true;
    try {
        const response = await fetch('/api/chatkhu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: letter.value.trim() }),
            signal: AbortSignal.timeout(15000),
        });
        let data;
        const text = await response.text();
        try { data = JSON.parse(text); }
        catch { throw new Error(`API가 JSON 대신 다른 응답을 반환했습니다 (HTTP ${response.status}). 서버리스 함수 배포와 라우팅을 확인해 주세요.`); }
        if (!response.ok) {
            throw new Error(`${data?.error || '답변을 받지 못했습니다.'} (HTTP ${response.status}${data?.code ? `, ${data.code}` : ''}${data?.requestId ? `, 요청 ${data.requestId}` : ''})`);
        }
        if (typeof data?.reply !== 'string' || !data.reply.trim()) throw new Error('답장 형식이 올바르지 않습니다.');
        $('#letter-reply').textContent = data.reply;
        $('#reply-panel').hidden = false;
        letterStatus.textContent = '답장이 도착했어요.';
        $('#reply-title').focus();
    } catch (error) {
        letterStatus.textContent = error.name === 'TimeoutError'
            ? '응답이 늦어지고 있어요. 다시 시도해 주세요.'
            : error instanceof TypeError
                ? 'API에 연결하지 못했습니다. 네트워크 연결과 배포 주소를 확인해 주세요.'
                : error.message || '편지를 보내지 못했어요. 다시 시도해 주세요.';
    } finally {
        sending = false;
        updateLetterButton();
    }
});
