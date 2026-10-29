// Use the same native media playback path as TTS; unlock it on the first gesture.
(() => {
    const tracks = {
        website: { url: '/website_bgm.mp3', volume: .45 },
        letter: { url: '/letter_bgm.mp3', volume: .12 },
    };
    const players = Object.fromEntries(Object.entries(tracks).map(([name, track]) => {
        const audio = new Audio(track.url);
        audio.preload = 'auto';
        audio.loop = true;
        return [name, audio];
    }));
    let bgm = players.website;
    let unlocked = false;
    let currentName = null;
    let pendingName = null;
    let revision = 0;
    let leaving = false;
    let lastError = null;
    const fades = new Map();
    function cancelFade(audio) {
        cancelAnimationFrame(fades.get(audio));
        fades.delete(audio);
    }
    function fade(audio, target, pauseAtEnd = false) {
        cancelFade(audio);
        const initial = audio.volume;
        const started = performance.now();
        function step(now) {
            const progress = Math.min(1, (now - started) / 900);
            audio.volume = initial + (target - initial) * progress;
            if (progress < 1) fades.set(audio, requestAnimationFrame(step));
            else {
                fades.delete(audio);
                if (pauseAtEnd) audio.pause();
            }
        }
        fades.set(audio, requestAnimationFrame(step));
    }
    function fadeVideoOut(element, duration = 600) {
        const initial = element.volume;
        const started = performance.now();
        function step(now) {
            const progress = Math.min(1, (now - started) / duration);
            element.volume = initial * (1 - progress);
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    function desiredTrack() {
        if (!unlocked || document.hidden || leaving) return null;
        const id = document.querySelector('.screen.active')?.id;
        if (id === 'player-screen') return 'letter';
        if (id === 'loading-screen') {
            const link = document.getElementById('link-video');
            const bridging = link && !link.paused && !link.ended;
            const nearEnd = link && Number.isFinite(link.duration) && link.duration - link.currentTime <= 1;
            return bridging && !nearEnd ? null : 'website';
        }
        return ['start-screen', 'setup-screen', 'letter-screen', 'character-select-screen', 'ending-screen', 'result-screen'].includes(id) ? 'website' : null;
    }
    function stopCurrent() {
        for (const audio of Object.values(players)) {
            cancelFade(audio);
            audio.pause();
            audio.volume = 0;
        }
        pendingName = null;
    }
    function report(error, source) {
        lastError = { source, name: error?.name || 'MediaError', mediaCode: bgm.error?.code || null };
        console.warn('dearme.audio', lastError);
    }
    async function sync() {
        const wanted = desiredTrack();
        if (wanted && wanted === currentName && (!bgm.paused || pendingName === wanted)) {
            bgm.muted = false;
            // Keep both the playhead and an in-progress fade across screen changes.
            if (!fades.has(bgm) && bgm.volume !== tracks[wanted].volume) fade(bgm, tracks[wanted].volume);
            return;
        }
        const run = ++revision;
        if (!wanted) { stopCurrent(); return; }
        const outgoing = bgm;
        bgm = players[wanted];
        cancelFade(bgm);
        if (outgoing !== bgm && !outgoing.paused) fade(outgoing, 0, true);
        currentName = wanted;
        bgm.muted = false;
        bgm.volume = 0;
        bgm.loop = true;
        pendingName = wanted;
        try {
            await bgm.play();
            if (run !== revision || wanted !== desiredTrack()) return;
            pendingName = null;
            lastError = null;
            fade(bgm, tracks[wanted].volume);
        } catch (error) {
            if (run !== revision) return;
            pendingName = null;
            report(error, 'bgm');
        }
    }
    function unlock() {
        if (unlocked) { sync(); return; }
        unlocked = true;
        // Prime the persistent media element inside the actual click. No Web Audio
        // context and no asynchronous full-screen request precede this call.
        for (const audio of Object.values(players)) {
            audio.volume = 0;
            audio.muted = false;
            audio.play().then(() => {
                if (players[desiredTrack()] !== audio) { cancelFade(audio); audio.pause(); }
                sync();
            }).catch(error => {
                if (error.name !== 'AbortError') report(error, 'bgm-unlock');
                sync();
            });
        }
    }
    async function playVideo(element) {
        element.muted = false;
        element.defaultMuted = false;
        element.volume = 1;
        try { await element.play(); }
        catch (error) {
            if (error.name !== 'NotAllowedError') throw error;
            // Preserve the requested no-extra-button fallback on restrictive devices.
            report(error, element.id);
            element.muted = true;
            await element.play();
        }
    }
    // Blend the bridge soundtrack into the waiting music before the picture changes.
    document.addEventListener('timeupdate', event => {
        const element = event.target;
        if (!(element instanceof HTMLVideoElement) || !['send-video', 'link-video'].includes(element.id)) return;
        if (Number.isFinite(element.duration) && element.duration > 0) {
            const tail = element.id === 'link-video' ? 1 : .45;
            element.volume = Math.max(0, Math.min(1, element.currentTime / .25, (element.duration - element.currentTime) / tail));
        }
        if (element.id === 'link-video' && element.closest('.screen.active')) sync();
    }, true);
    for (const name of ['playing', 'pause', 'ended', 'error']) {
        document.addEventListener(name, event => {
            if (event.target instanceof HTMLVideoElement) sync();
        }, true);
    }
    // Recover permission on an existing click/key interaction, without a new control.
    function recover() {
        if (!unlocked) return;
        if (desiredTrack() && bgm.paused && !pendingName && !bgm.error) sync();
        document.querySelectorAll('.screen.active video').forEach(video => {
            if (!video.paused && !video.ended && video.muted) { video.muted = false; video.volume = 1; }
        });
    }
    document.addEventListener('pointerdown', recover, true);
    document.addEventListener('keydown', recover, true);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', () => {
        leaving = true;
        revision++;
        stopCurrent();
        document.querySelectorAll('video').forEach(video => video.pause());
    });
    window.addEventListener('pageshow', () => { leaving = false; sync(); });
    window.DearMeSound = {
        unlock, playVideo, sync, fadeVideoOut,
        getState: () => ({ unlocked, track: !bgm.paused ? currentName : null, paused: bgm.paused, muted: bgm.muted, volume: bgm.volume, readyState: bgm.readyState, source: bgm.currentSrc, lastError }),
    };
})();
