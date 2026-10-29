// Per-tab in-memory audio cache: no credentials and no persisted personal speech.
(() => {
    const cache = new Map();
    const maxAttempts = 3;
    const preparationLimitMs = 60000;
    function failure(message, code, retryable = false, attempts = 0) {
        return Object.assign(new Error(message), { code, retryable, attempts });
    }
    function info(entry, gender) {
        return { clientRequestId: entry?.clientRequestId, requestId: entry?.requestId, gender,
            attempts: entry?.attempts || 0, elapsedMs: entry?.startedAt ? Date.now() - entry.startedAt : 0,
            stage: entry?.stage || 'request', httpStatus: entry?.httpStatus, upstreamStatus: entry?.upstreamStatus };
    }
    const report = (event, data) => window.DearMeDiagnostics?.report(event, data);
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
        entry.clientRequestId = globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
        entry.requestId = undefined;
        entry.httpStatus = entry.upstreamStatus = undefined;
        entry.stage = 'request';
        report('tts.client_request', info(entry, gender));
        entry.pending = (async () => {
            try {
                const response = await fetch('/api/tts', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, gender, clientRequestId: entry.clientRequestId }), signal: AbortSignal.timeout(preparationLimitMs),
                });
                entry.requestId = response.headers.get('x-request-id') || undefined;
                entry.httpStatus = response.status;
                entry.stage = 'body';
                if (!response.ok) {
                    let data;
                    try { data = await response.json(); } catch { data = {}; }
                    entry.requestId = data.requestId || entry.requestId;
                    entry.upstreamStatus = data.upstreamStatus;
                    const message = data.code === 'MISSING_TTS_KEY'
                        ? '서버 음성 서비스가 아직 준비되지 않았어요. 건너뛰고 편지를 받을 수 있어요.'
                        : data.error || `음성을 받지 못했어요 (HTTP ${response.status}).`;
                    throw failure(message, data.code || 'TTS_HTTP_ERROR', data.retryable === true, entry.attempts);
                }
                if (!response.headers.get('content-type')?.includes('audio/wav')) throw failure('지원하지 않는 음성 응답이에요.', 'INVALID_AUDIO');
                const duration = Number(response.headers.get('x-audio-duration'));
                const blob = await response.blob();
                if (!Number.isFinite(duration) || duration <= 0 || !blob.size || blob.size > 4 * 1024 * 1024) throw failure('음성 길이 또는 파일을 확인하지 못했어요.', 'INVALID_AUDIO');
                entry.data = { url: URL.createObjectURL(blob), durationSeconds: duration, voice: response.headers.get('x-tts-voice'), requestId: entry.requestId, clientRequestId: entry.clientRequestId };
                entry.stage = 'ready';
                report('tts.client_ready', { ...info(entry, gender), durationSeconds: duration, voice: entry.data.voice });
                entry.error = null;
                // Bound memory without discarding in-flight requests.
                for (const [oldKey, old] of cache) {
                    if (cache.size <= 6) break;
                    if (oldKey !== key && !old.pending) { if (old.data) URL.revokeObjectURL(old.data.url); cache.delete(oldKey); }
                }
                return entry.data;
            } catch (error) {
                if (typeof error.code !== 'string') {
                    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
                    error = failure(timedOut ? '음성 생성 대기 시간이 초과됐어요.' : '음성 서비스에 연결하지 못했어요.', timedOut ? 'TTS_CLIENT_TIMEOUT' : 'TTS_NETWORK_ERROR', true, entry.attempts);
                }
                Object.assign(error, info(entry, gender));
                report('tts.client_error', { ...info(entry, gender), code: error.code });
                entry.stage = 'failed';
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
    window.DearMeTTS = { get, remaining, info: (text, gender) => info(cache.get(JSON.stringify([gender, text])), gender), maxAttempts, script: reply => `${reply.trim()}\n그럼 안녕.` };
})();
