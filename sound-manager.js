// Use the same native media playback path as TTS; unlock it on the first gesture.
(() => {
    const tracks = {
        website: { url: '/website_bgm.mp3', volume: .45 },
        letter: { url: '/letter_bgm.mp3', volume: .12 },
        loading: { url: '/loading_bgm.mp3', volume: .45 },
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
    let loadingExit = false;
    const fades = new Map();
    function cancelFade(audio) {
        cancelAnimationFrame(fades.get(audio));
        fades.delete(audio);
    }
    function fade(audio, target, pauseAtEnd = false, duration = 2600) {
        cancelFade(audio);
        const initial = audio.volume;
        const started = performance.now();
        function step(now) {
            const progress = Math.max(0, Math.min(1, (now - started) / duration));
            const eased = progress * progress * (3 - 2 * progress);
            audio.volume = initial + (target - initial) * eased;
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
            const progress = Math.max(0, Math.min(1, (now - started) / duration));
            element.volume = initial * (1 - progress);
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    function fadeDuration() { return desiredTrack() === 'loading' ? 400 : 2600; }
    function desiredTrack() {
        if (!unlocked || document.hidden || leaving) return null;
        const id = document.querySelector('.screen.active')?.id;
        if (id === 'player-screen') return 'letter';
        if (id === 'loading-screen') return 'loading';
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
    function report(error, source, mediaCode = bgm.error?.code) {
        lastError = { source, name: error?.name || 'MediaError', mediaCode: mediaCode || null };
        console.warn('dearme.audio', lastError);
        window.DearMeDiagnostics?.report('media.error', { code: 'MEDIA_PLAYBACK_ERROR', media: source, mediaCode: lastError.mediaCode });
    }
    function beginLoadingExit() {
        loadingExit = true;
        revision++;
        pendingName = null;
        fade(players.loading, 0, true, 1200);
    }
    function endLoadingExit() { loadingExit = false; sync(); }
    for (const audio of Object.values(players)) {
        audio.addEventListener('error', () => report(audio.error, 'bgm', audio.error?.code));
    }
    async function sync() {
        if (loadingExit && !document.hidden && !leaving
            && document.querySelector('.screen.active')?.id === 'loading-screen') return;
        const wanted = desiredTrack();
        if (wanted && wanted === currentName && (!bgm.paused || pendingName === wanted)) {
            bgm.muted = false;
            // Keep both the playhead and an in-progress fade across screen changes.
            if (!fades.has(bgm) && bgm.volume !== tracks[wanted].volume) fade(bgm, tracks[wanted].volume, false, fadeDuration());
            return;
        }
        const run = ++revision;
        if (!wanted) { stopCurrent(); return; }
        bgm = players[wanted];
        cancelFade(bgm);
        // Keep a single BGM audible: mixed video soundtracks already contain music.
        for (const audio of Object.values(players)) {
            if (audio === bgm) continue;
            cancelFade(audio);
            audio.pause();
            audio.volume = 0;
        }
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
            fade(bgm, tracks[wanted].volume, false, fadeDuration());
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
        document.querySelectorAll('video').forEach(other => {
            if (other !== element) other.pause();
        });
        revision++;
        stopCurrent();
        const isBridge = element.id === 'link-video';
        if (isBridge) players.loading.currentTime = 0;
        element.muted = isBridge;
        element.defaultMuted = isBridge;
        element.volume = isBridge ? 0 : 1;
        try { await element.play(); }
        catch (error) {
            if (error.name !== 'NotAllowedError') { report(error, element.id, element.error?.code); throw error; }
            // Preserve the requested no-extra-button fallback on restrictive devices.
            report(error, element.id, element.error?.code);
            element.muted = true;
            await element.play();
        }
    }
    for (const name of ['playing', 'pause', 'ended', 'error']) {
        document.addEventListener(name, event => {
            if (event.target instanceof HTMLVideoElement) {
                if (name === 'error') report(event.target.error, event.target.id, event.target.error?.code);
                sync();
            }
        }, true);
    }
    // Recover permission on an existing click/key interaction, without a new control.
    function recover() {
        if (!unlocked) return;
        if (desiredTrack() && bgm.paused && !pendingName && !bgm.error) sync();
        document.querySelectorAll('.screen.active video').forEach(video => {
            if (video.id !== 'link-video' && !video.paused && !video.ended && video.muted) { video.muted = false; }
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
        unlock, playVideo, sync, fadeVideoOut, beginLoadingExit, endLoadingExit,
        getState: () => ({ unlocked, track: !bgm.paused ? currentName : null, paused: bgm.paused, muted: bgm.muted, volume: bgm.volume, readyState: bgm.readyState, position: bgm.currentTime, source: bgm.currentSrc, layers: Object.entries(players).filter(([, audio]) => !audio.paused && audio.volume > 0).map(([name]) => name), lastError }),
    };
})();
