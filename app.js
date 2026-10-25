const form = document.querySelector('#chat-form');
const input = document.querySelector('#message');
const messages = document.querySelector('#messages');
const status = document.querySelector('#status');
const button = form.querySelector('button');

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
