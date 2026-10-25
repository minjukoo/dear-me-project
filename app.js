const form = document.querySelector('#chat-form');
const input = document.querySelector('#message');
const messages = document.querySelector('#messages');
const status = document.querySelector('#status');
const button = form.querySelector('button');

const setupForm = document.querySelector('#setup-form');
const photoInput = document.querySelector('#photo');
const nicknameInput = document.querySelector('#nickname');
const preview = document.querySelector('#photo-preview');
const placeholder = document.querySelector('#photo-placeholder');
const nextButton = document.querySelector('#next-button');
const setupStatus = document.querySelector('#setup-status');
const setupScreen = document.querySelector('#setup-screen');
const letterScreen = document.querySelector('#letter-screen');
// Page-lifetime state avoids browser storage quotas and persisting personal photos.
window.dearMeProfile = null;
let photoData = '';
let photoVersion = 0;

function updateNextButton() {
  nextButton.disabled = !photoData || !nicknameInput.value.trim();
}

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
    preview.onload = () => {
      if (version !== photoVersion) return;
      photoData = reader.result;
      preview.hidden = false;
      placeholder.hidden = true;
      setupStatus.textContent = '';
      updateNextButton();
    };
    preview.onerror = () => {
      if (version !== photoVersion) return;
      photoData = '';
      preview.hidden = true;
      placeholder.hidden = false;
      setupStatus.textContent = '사진을 표시할 수 없어요. JPG, PNG 등 다른 사진을 선택해 주세요.';
      updateNextButton();
    };
    preview.src = reader.result;
  };
  reader.onerror = () => {
    if (version !== photoVersion) return;
    setupStatus.textContent = '사진을 읽지 못했어요. 다시 선택해 주세요.';
    updateNextButton();
  };
  reader.readAsDataURL(file);
});

nicknameInput.addEventListener('input', updateNextButton);

function showScreen(show, hide, heading) {
  hide.hidden = true;
  show.hidden = false;
  document.querySelector(heading).focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

setupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!photoData || !nicknameInput.value.trim()) return;
  window.dearMeProfile = { nickname: nicknameInput.value.trim(), photo: photoData };
  document.querySelector('#profile-photo').src = photoData;
  document.querySelector('#recipient').textContent = `${window.dearMeProfile.nickname}님에게 보내는 편지`;
  showScreen(letterScreen, setupScreen, '#letter-title');
});

document.querySelector('#edit-profile').addEventListener('click', () => {
  showScreen(setupScreen, letterScreen, '#setup-title');
});

function addMessage(text, role) {
  const message = document.createElement('p');
  message.className = `message ${role}`;
  message.textContent = text;
  messages.append(message);
  message.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || button.disabled) return;
  button.disabled = true;
  status.textContent = '답변을 준비하고 있어요…';
  addMessage(message, 'user');
  try {
    // Vercel exposes api/chatkhu.js at /api/chatkhu (without .js).
    const response = await fetch('/api/chatkhu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      throw new Error(`API가 JSON 대신 다른 응답을 반환했습니다 (HTTP ${response.status}). Vercel의 서버리스 함수 배포와 라우팅을 확인해 주세요.`);
    }
    if (!response.ok) {
      throw new Error(`${data.error || '답변을 받지 못했습니다.'} (HTTP ${response.status}${data.code ? `, ${data.code}` : ''}${data.requestId ? `, 요청 ${data.requestId}` : ''})`);
    }
    if (typeof data.reply !== 'string') throw new Error('응답 형식이 올바르지 않습니다.');
    addMessage(data.reply, 'assistant');
    input.value = '';
    status.textContent = '';
  } catch (error) {
    status.textContent = error.name === 'TimeoutError'
      ? '응답이 늦어지고 있어요. 다시 시도해 주세요.'
      : error instanceof TypeError
        ? 'API에 연결하지 못했습니다. 네트워크 연결과 배포 주소를 확인해 주세요.'
        : error.message || '메시지를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
  } finally {
    button.disabled = false;
    input.focus();
  }
});
