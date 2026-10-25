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
    const response = await fetch('/api/chatkhu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '답변을 받지 못했습니다.');
    if (typeof data.reply !== 'string') throw new Error('응답 형식이 올바르지 않습니다.');
    addMessage(data.reply, 'assistant');
    input.value = '';
    status.textContent = '';
  } catch (error) {
    status.textContent = error.name === 'TimeoutError'
      ? '응답이 늦어지고 있어요. 다시 시도해 주세요.'
      : '메시지를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
  } finally {
    button.disabled = false;
    input.focus();
  }
});
