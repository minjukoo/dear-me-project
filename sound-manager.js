// A single user-unlocked audio context supplies BGM; video/TTS keep their own audio.
(() => {
    const tracks = {
        website: { url: '/website_bgm.mp3', volume: 0.3 },
        letter: { url: '/letter_bgm.mp3', volume: 0.28 },
    };
    const buffers = new Map();
    let context = null;
    let unlocked = false;
    let current = null;
    let revision = 0;
    let leaving = false;
    function desiredTrack() {
        if (!unlocked || document.hidden || leaving) return null;
        const id = document.querySelector('.screen.active')?.id;
        if (id === 'letter-screen') return 'letter';
        if (id === 'loading-screen') {
            const link = document.getElementById('link-video');
            if (link && !link.paused && !link.ended) return null;
            return 'website';
        }
        return ['start-screen', 'setup-screen', 'character-select-screen', 'ending-screen', 'result-screen'].includes(id) ? 'website' : null;
    }
    function load(name) {
        if (!buffers.has(name)) {
            buffers.set(name, fetch(tracks[name].url).then(response => {
                if (!response.ok) throw new Error('BGM unavailable');
                return response.arrayBuffer();
            }).then(data => context.decodeAudioData(data)).catch(error => {
                buffers.delete(name);
                throw error;
            }));
        }
        return buffers.get(name);
    }
    function stopCurrent() {
        if (!current) return;
        // Stop immediately before a video's audio or TTS to avoid overlapping tracks.
        current.gain.gain.cancelScheduledValues(context.currentTime);
        current.gain.gain.setValueAtTime(0, context.currentTime);
        try { current.source.stop(); } catch { /* Already ended. */ }
        current.source.disconnect();
        current.gain.disconnect();
        current = null;
    }
    async function sync() {
        const wanted = desiredTrack();
        if (current?.name === wanted) return;
        const run = ++revision;
        stopCurrent();
        if (!wanted || !context || context.state !== 'running') return;
        try {
            const buffer = await load(wanted);
            if (run !== revision || wanted !== desiredTrack() || context.state !== 'running') return;
            const source = context.createBufferSource();
            const gain = context.createGain();
            source.buffer = buffer;
            source.loop = true;
            source.connect(gain);
            gain.connect(context.destination);
            gain.gain.setValueAtTime(0, context.currentTime);
            gain.gain.linearRampToValueAtTime(tracks[wanted].volume, context.currentTime + .45);
            current = { name: wanted, source, gain };
            source.start();
        } catch { /* A missing/blocked BGM must not interrupt the visual workflow. */ }
    }
    function unlock() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!context) {
            try { context = new AudioContext(); }
            catch { return; }
        }
        // resume() is called directly during the click, not after any fetch/await.
        context.resume().then(() => {
            unlocked = context.state === 'running';
            for (const name of Object.keys(tracks)) load(name).catch(() => {});
            sync();
        }).catch(() => {});
    }
    async function playVideo(element) {
        element.muted = false;
        element.volume = .85;
        try { await element.play(); }
        catch (error) {
            if (error.name !== 'NotAllowedError') throw error;
            // No extra sound button: a restrictive device can continue silently.
            element.muted = true;
            await element.play();
        }
    }
    for (const name of ['playing', 'pause', 'ended', 'error']) {
        document.addEventListener(name, event => {
            if (event.target instanceof HTMLVideoElement) sync();
        }, true);
    }
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && unlocked && context && context.state !== 'running') context.resume().then(sync).catch(() => {});
        sync();
    });
    window.addEventListener('pagehide', () => {
        leaving = true;
        revision++;
        stopCurrent();
        document.querySelectorAll('video').forEach(video => video.pause());
    });
    window.addEventListener('pageshow', () => { leaving = false; sync(); });
    window.DearMeSound = { unlock, playVideo, sync, getState: () => ({ unlocked, track: current?.name || null, context: context?.state || 'unavailable' }) };
})();
