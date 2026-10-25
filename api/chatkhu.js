// Vercel Node.js Function. No external API or credentials are needed for this demo.
module.exports = function handler(req, res) {
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

  return res.status(200).json({
    reply: '이야기를 나눠 줘서 고마워요. 오늘의 마음을 한 단어로 표현한다면 무엇인가요? 그 마음이 들었던 순간을 조금 더 적어 보세요.',
    mode: 'demo',
  });
};
