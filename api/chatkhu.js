// Vercel Node.js Function: credentials stay on the server.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: '올바른 JSON을 보내 주세요.' }); }
  }
  const message = body && body.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
    return res.status(400).json({ error: '1~2000자의 메시지를 보내 주세요.' });
  }

  const apiKey = process.env.CHATKHU_API_KEY;
  const model = process.env.CHATKHU_MODEL;
  if (!apiKey || !model) {
    return res.status(503).json({ error: '채팅 서비스 설정이 필요합니다.' });
  }

  try {
    const response = await fetch(
      'https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: message.trim() }],
          stream: false,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    // Never forward upstream error bodies: they may contain sensitive details.
    if (!response.ok) {
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429
          ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
          : '채팅 서비스에서 응답을 받지 못했습니다.',
      });
    }
    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return res.status(502).json({ error: '채팅 서비스의 응답 형식이 올바르지 않습니다.' });
    }
    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(error.name === 'TimeoutError' ? 504 : 502).json({
      error: error.name === 'TimeoutError'
        ? '응답 시간이 초과되었습니다. 다시 시도해 주세요.'
        : '채팅 서비스에 연결하지 못했습니다.',
    });
  }
};
