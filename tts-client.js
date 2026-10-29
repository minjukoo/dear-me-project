// Per-tab in-memory audio cache: no credentials and no persisted personal speech.
(() => {
    const cache = new Map();
    const maxAttempts = 3;
    const preparationLimitMs = 30000;
    function failure(message, code, retryable = false, attempts = 0) {
        return Object.assign(new Error(message), { code, retryable, attempts });
    }
    async function get(text, gender, { retry = false } = {}) {
        if (!['male', 'female'].includes(gender) || typeof text !== 'string' || !text.trim()) throw failure('캐릭터와 답장을 확인해 주세요.', 'INVALID_INPUT');
        const key = JSON.stringify([gender, text]);
        let entry = cache.get(key);
        if (!entry) { entry = { attempts: 0, data: null, error: null, pending: null }; cache.set(key, entry); }
        if (entry.data) return entry.data;
        if (entry.pending) return entry.pending;
        if (entry.error && (!retry || !entry.error.retryable || entry.attempts >= maxAttempts)) throw entry.error;
        entry.attempts++;
        entry.startedAt = Date.now();
        entry.pending = (async () => {
            try {
                const response = await fetch('/api/tts', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, gender }), signal: AbortSignal.timeout(preparationLimitMs),
                });
                if (!response.ok) {
                    let data;
                    try { data = await response.json(); } catch { data = {}; }
                    const message = data.code === 'MISSING_TTS_KEY'
                        ? '서버 음성 서비스가 아직 준비되지 않았어요. 건너뛰고 편지를 받을 수 있어요.'
                        : data.error || `음성을 받지 못했어요 (HTTP ${response.status}).`;
                    throw failure(message, data.code || 'TTS_HTTP_ERROR', data.retryable === true, entry.attempts);
                }
                if (!response.headers.get('content-type')?.includes('audio/wav')) throw failure('지원하지 않는 음성 응답이에요.', 'INVALID_AUDIO');
                const duration = Number(response.headers.get('x-audio-duration'));
                const blob = await response.blob();
                if (!Number.isFinite(duration) || duration <= 0 || !blob.size || blob.size > 4 * 1024 * 1024) throw failure('음성 길이 또는 파일을 확인하지 못했어요.', 'INVALID_AUDIO');
                entry.data = { url: URL.createObjectURL(blob), durationSeconds: duration, voice: response.headers.get('x-tts-voice') };
                entry.error = null;
                // Bound memory without discarding in-flight requests.
                for (const [oldKey, old] of cache) {
                    if (cache.size <= 6) break;
                    if (oldKey !== key && !old.pending) { if (old.data) URL.revokeObjectURL(old.data.url); cache.delete(oldKey); }
                }
                return entry.data;
            } catch (error) {
                if (!error.code) error = failure(error.name === 'TimeoutError' ? '음성 생성 대기 시간이 초과됐어요.' : '음성 서비스에 연결하지 못했어요.', 'TTS_NETWORK_ERROR', true, entry.attempts);
                error.attempts = entry.attempts;
                entry.error = error;
                throw error;
            } finally { entry.pending = null; }
        })();
        return entry.pending;
    }
    function remaining(text, gender) {
        const entry = cache.get(JSON.stringify([gender, text]));
        if (!entry || entry.data || !entry.startedAt) return preparationLimitMs;
        return Math.max(0, preparationLimitMs - (Date.now() - entry.startedAt));
    }
    window.DearMeTTS = { get, remaining, maxAttempts, script: reply => `${reply.trim()}\n그럼 안녕.` };
})();
