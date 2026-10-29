// Bounded, best-effort telemetry: never send messages, names, URLs, stacks or secrets.
(() => {
    let sent = 0;
    const fields = ['event', 'code', 'stage', 'requestId', 'clientRequestId', 'elapsedMs', 'remainingMs', 'attempts', 'httpStatus', 'upstreamStatus', 'durationSeconds', 'mediaCode', 'gender', 'voice', 'fallback', 'media', 'browserCode', 'script', 'line'];
    function report(event, details = {}) {
        const record = { event };
        for (const key of fields) if (key !== 'event' && ['string', 'number'].includes(typeof details[key])) record[key] = details[key];
        if (event === 'chat.input_blocked' && Array.isArray(details.prohibitedTerms)) {
            record.prohibitedTerms = [...new Set(details.prohibitedTerms)].filter(term => window.DearMeModeration?.terms.includes(term));
        }
        const level = /error$/.test(event) ? 'error' : ['tts.fallback', 'chat.input_blocked'].includes(event) ? 'warn' : 'info';
        console[level]('dearme.diagnostics', record);
        if (sent >= 40) return;
        sent++;
        // No retries: a logging outage must never block playback or cause a loop.
        fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record), keepalive: true }).catch(() => {});
    }
    window.addEventListener('error', event => {
        if (event instanceof ErrorEvent) {
            const script = (event.filename || '').split('/').pop().split('?')[0];
            report('client.error', { code: 'JS_RUNTIME_ERROR', script: ['app.js', 'result-player.js', 'tts-client.js', 'sound-manager.js', 'media-layout.js', 'diagnostics.js'].includes(script) ? script : undefined, line: event.lineno });
        }
    });
    window.addEventListener('unhandledrejection', () => report('client.error', { code: 'UNHANDLED_REJECTION' }));
    window.DearMeDiagnostics = { report };
})();
