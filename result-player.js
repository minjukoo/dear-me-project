// Existing scene/character animation with a server-audio playback adapter.
(() => {
    const $ = (id) => document.getElementById(id);
    const assets = {
        male: { normal: 'male_normal.png', mouth: 'male_mouth.png', smile: 'male_smile.png', hello: 'male_hello.png' },
        female: { normal: 'female_normal.png', mouth: 'female_mouth.png', smile: 'female_smile.png', hello: 'female_hello.png' },
    };
    const synth = window.speechSynthesis;
    const supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
    const image = $('character-image');
    const cache = new Map();
    let result = null;
    let character = '';
    let token = 0;
    let mouthTimer = null;
    let startupTimer = null;
    let gatewayDeadlineTimer = null;
    let nextTimer = null;
    let currentUtterance = null;
    let currentAudio = null;
    let cancelAudioPreparation = null;
    let speaking = false;
    let frame = 'normal';
    let stationeryPromise = null;
    let loadingTransition = null;
    function navigate(id, heading) {
        window.dispatchEvent(new CustomEvent('dearme:screen', { detail: { id, heading } }));
    }
    function preload(filename) {
        if (cache.has(filename)) return cache.get(filename);
        const entry = { state: 'pending', image: new Image() };
        cache.set(filename, entry);
        entry.image.onload = () => { entry.state = 'ready'; render(); };
        entry.image.onerror = () => { entry.state = 'missing'; render(); };
        entry.image.src = `/${filename}`;
        return entry;
    }
    function render() {
        const set = assets[character];
        const entry = set && cache.get(set[frame]);
        const fallback = set && cache.get(set.normal);
        const source = entry?.state === 'ready' ? entry : fallback?.state === 'ready' ? fallback : null;
        image.hidden = !source;
        $('character-placeholder').hidden = !!source;
        if (source && image.getAttribute('src') !== source.image.getAttribute('src')) image.src = source.image.src;
        image.classList.toggle('character-finished', frame === 'smile' || frame === 'hello');
        window.DearMeLayout.sync();
    }
    function setFrame(next) { frame = next; render(); }
    function clearTimers() {
        clearInterval(mouthTimer);
        clearTimeout(startupTimer);
        clearTimeout(nextTimer);
        clearTimeout(gatewayDeadlineTimer);
        mouthTimer = startupTimer = nextTimer = gatewayDeadlineTimer = null;
    }
    function stop() {
        token++;
        if (loadingTransition) {
            loadingTransition.abort();
            loadingTransition = null;
            $('loading-screen').classList.remove('loading-exit');
            window.DearMeSound.endLoadingExit();
        }
        clearTimers();
        if (cancelAudioPreparation) cancelAudioPreparation();
        if (currentAudio) { currentAudio.pause(); currentAudio.removeAttribute('src'); currentAudio.load(); currentAudio = null; }
        $('tts-error-panel').hidden = true;
        if (speaking && synth) synth.cancel();
        speaking = false;
        currentUtterance = null;
        setFrame('normal');
    }
    function finish(message = '', hold = 900, pose = 'smile') {
        clearTimers();
        speaking = false;
        currentUtterance = null;
        const run = token;
        const preferred = assets[character] && cache.get(assets[character][pose]);
        setFrame(preferred?.state === 'ready' ? pose : 'hello');
        nextTimer = setTimeout(() => {
            if (run !== token) return;
            $('ending-status').textContent = message;
            navigate('ending-screen', '#ending-title');
        }, hold);
    }
    function chooseCharacter(value) {
        character = assets[value] ? value : '';
        if (character) Object.values(assets[character]).forEach(preload);
        setFrame('normal');
        $('character-next-btn').disabled = !character;
    }
    let resolveCharacter = null;
    function requestCharacter() {
        stop();
        chooseCharacter('');
        $('character-select').value = '';
        navigate('character-select-screen', '#character-choice-title');
        return new Promise(resolve => { resolveCharacter = resolve; });
    }
    function prepare(data) {
        stop();
        result = data;
        loadStationery().catch(() => {});
        chooseCharacter(data.gender);
        if (character) play();
        else {
            $('character-select').value = '';
            navigate('character-select-screen', '#character-choice-title');
        }
    }
    function play(retry = false) {
        if (!result || result.safetyType !== 'normal' || !character || speaking) return;
        stop();
        if (window.DearMeTTS) {
            $('loading-screen').classList.add('clock-waiting');
            $('link-video').classList.remove('link-visible');
            navigate('loading-screen', '#loading-title');
        }
        const run = token;
        const sentences = result.reply.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/gu)?.map(s => s.trim()).filter(Boolean) || [result.reply];
        const voice = supported && synth.getVoices().find(v => v.lang.toLowerCase().startsWith('ko'));
        speaking = true;
        if (!window.DearMeTTS) navigate('player-screen', '#player-title');
        $('letter-subtitle').textContent = '';
        $('player-status').textContent = supported ? '편지를 읽고 있어요.' : '음성이 지원되지 않아 자막으로 편지를 전해요.';
        async function revealPlayer() {
            if (run !== token) return false;
            if (!$('loading-screen').classList.contains('active')) return true;
            // Reuse one transition if an audio failure arrives while fading out.
            if (loadingTransition) return loadingTransition.done;
            const controller = new AbortController();
            loadingTransition = controller;
            const wait = ms => new Promise(resolve => {
                const onAbort = () => { clearTimeout(timer); resolve(false); };
                const timer = setTimeout(() => {
                    controller.signal.removeEventListener('abort', onAbort);
                    resolve(true);
                }, ms);
                controller.signal.addEventListener('abort', onAbort, { once: true });
            });
            controller.done = (async () => {
                $('loading-screen').classList.add('loading-exit');
                window.DearMeSound.beginLoadingExit();
                if (!await wait(1200) || run !== token) return false;
                if (!await wait(1000) || run !== token) return false;
                navigate('player-screen', '#player-title');
                $('loading-screen').classList.remove('loading-exit');
                loadingTransition = null;
                window.DearMeSound.endLoadingExit();
                return true;
            })();
            return controller.done;
        }
        function animateMouth() {
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                mouthTimer = setInterval(() => setFrame(frame === 'mouth' ? 'normal' : 'mouth'), 250);
            }
        }
        function goodbye() {
            if (run !== token) return;
            clearTimers();
            setFrame('hello');
            $('letter-subtitle').textContent = '그럼 안녕.';
            if (!supported) {
                finish('음성이 지원되지 않아 자막으로 편지를 전했어요.', 3500, 'hello');
                return;
            }
            const utterance = new SpeechSynthesisUtterance('그럼 안녕.');
            currentUtterance = utterance;
            utterance.lang = 'ko-KR';
            utterance.rate = 0.9;
            if (voice) utterance.voice = voice;
            utterance.onstart = () => {
                if (run !== token || currentUtterance !== utterance) return;
                clearTimers();
                setFrame('hello');
            };
            utterance.onend = () => {
                if (run !== token || currentUtterance !== utterance) return;
                finish('', 2800, 'hello');
            };
            utterance.onerror = () => {
                if (run !== token || currentUtterance !== utterance) return;
                stop();
                $('letter-subtitle').textContent = '그럼 안녕.';
                finish('', 2800, 'hello');
            };
            startupTimer = setTimeout(() => {
                if (run !== token || currentUtterance !== utterance) return;
                stop();
                $('letter-subtitle').textContent = '그럼 안녕.';
                finish('', 2800, 'hello');
            }, 12000);
            try { synth.speak(utterance); } catch { utterance.onerror(); }
        }
        function read(index) {
            if (run !== token) return;
            if (index >= sentences.length) { goodbye(); return; }
            if (!supported) {
                $('letter-subtitle').textContent = sentences[index];
                animateMouth();
                nextTimer = setTimeout(() => { clearTimers(); setFrame('normal'); read(index + 1); }, Math.max(1800, sentences[index].length * 100));
                return;
            }
            const utterance = new SpeechSynthesisUtterance(sentences[index]);
            currentUtterance = utterance;
            utterance.lang = 'ko-KR';
            utterance.rate = 0.95;
            if (voice) utterance.voice = voice;
            utterance.onstart = () => {
                if (run !== token || currentUtterance !== utterance) return;
                clearTimers();
                $('letter-subtitle').textContent = sentences[index];
                animateMouth();
            };
            utterance.onend = () => {
                if (run !== token || currentUtterance !== utterance) return;
                clearTimers();
                setFrame('normal');
                read(index + 1);
            };
            utterance.onerror = () => {
                if (run !== token || currentUtterance !== utterance) return;
                stop();
                finish('자동 음성을 재생하지 못했어요. 다시 재생하거나 편지 받기로 전문을 읽어 주세요.');
            };
            startupTimer = setTimeout(() => {
                if (run !== token) return;
                stop();
                finish('음성을 시작하지 못했어요. 다시 재생하거나 편지 받기로 전문을 읽어 주세요.');
            }, 12000);
            try { synth.speak(utterance); }
            catch { utterance.onerror(); }
        }
        async function readGateway() {
            let gatewayAbandoned = false;
            const fail = async () => {
                if (run !== token || gatewayAbandoned) return;
                gatewayAbandoned = true;
                clearTimers();
                if (cancelAudioPreparation) cancelAudioPreparation();
                if (currentAudio) {
                    const audio = currentAudio;
                    currentAudio = null;
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();
                }
                $('tts-error-panel').hidden = true;
                setFrame('normal');
                if (!await revealPlayer() || run !== token) return;
                $('player-status').textContent = supported
                    ? '기기의 기본 한국어 음성으로 편지를 읽어요.'
                    : '기본 음성을 지원하지 않아 자막으로 편지를 전해요.';
                // Keep existing browser speech, subtitles, lip sync and goodbye behavior.
                read(0);
            };
            const script = window.DearMeTTS.script(result.reply);
            gatewayDeadlineTimer = setTimeout(fail, window.DearMeTTS.remaining(script, character));
            try {
                const asset = await window.DearMeTTS.get(window.DearMeTTS.script(result.reply), character, { retry: retry === true });
                if (run !== token || gatewayAbandoned) return;
                const audio = new Audio(asset.url);
                currentAudio = audio;
                const cues = [...sentences, '그럼 안녕.'];
                const weights = cues.map(text => Math.max(1, text.length));
                const total = weights.reduce((sum, n) => sum + n, 0);
                let lastCue = -1;
                const updateCue = () => {
                    if (run !== token || gatewayAbandoned || currentAudio !== audio) return;
                    const position = Math.min(1, audio.currentTime / asset.durationSeconds) * total;
                    let sum = 0, index = 0;
                    while (index < weights.length - 1 && sum + weights[index] <= position) sum += weights[index++];
                    if (index === lastCue) return;
                    lastCue = index;
                    $('letter-subtitle').textContent = cues[index];
                    if (index === cues.length - 1) { clearInterval(mouthTimer); setFrame('hello'); }
                };
                audio.onplaying = () => {
                    if (run !== token || gatewayAbandoned || currentAudio !== audio) return;
                    clearTimers();
                    updateCue();
                    if (lastCue < cues.length - 1) animateMouth();
                    nextTimer = setTimeout(() => fail(Object.assign(new Error('음성 재생이 중단됐어요. 다시 재생하거나 편지를 받아 주세요.'), { retryable: true })), (asset.durationSeconds + 15) * 1000);
                };
                audio.onpause = audio.onwaiting = () => {
                    if (run !== token || gatewayAbandoned || currentAudio !== audio) return;
                    clearInterval(mouthTimer);
                    if (lastCue < cues.length - 1) setFrame('normal');
                };
                audio.ontimeupdate = updateCue;
                audio.onended = () => {
                    if (run !== token || gatewayAbandoned || currentAudio !== audio) return;
                    currentAudio = null;
                    $('letter-subtitle').textContent = '그럼 안녕.';
                    finish('', 2800, 'hello');
                };
                await new Promise((resolve, reject) => {
                    let settled = false;
                    const settle = error => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(startupTimer);
                        startupTimer = null;
                        audio.removeEventListener('canplay', ready);
                        audio.removeEventListener('error', failed);
                        cancelAudioPreparation = null;
                        if (error) reject(error); else resolve();
                    };
                    const ready = () => settle();
                    const failed = () => settle(Object.assign(new Error('음성 파일을 불러오지 못했어요. 다시 시도해 주세요.'), { retryable: true }));
                    cancelAudioPreparation = () => settle(new DOMException('Cancelled', 'AbortError'));
                    audio.addEventListener('canplay', ready);
                    audio.addEventListener('error', failed);
                    startupTimer = setTimeout(() => settle(Object.assign(new Error('음성 파일 준비 시간이 초과됐어요.'), { retryable: true })), 15000);
                    audio.preload = 'auto';
                    audio.load();
                    if (audio.readyState >= 3) ready();
                });
                if (run !== token || gatewayAbandoned || currentAudio !== audio) return;
                if (!Number.isFinite(audio.duration) || Math.abs(audio.duration - asset.durationSeconds) > .2) {
                    throw Object.assign(new Error('음성 파일의 실제 길이가 응답과 달라요. 응답 규격을 확인해 주세요.'), { retryable: false });
                }
                clearTimeout(gatewayDeadlineTimer);
                gatewayDeadlineTimer = null;
                $('player-screen').append($('tts-error-panel'));
                if (!await revealPlayer() || run !== token || gatewayAbandoned) return;
                audio.onerror = () => fail(Object.assign(new Error('음성 파일을 재생하지 못했어요. 다시 재생하거나 편지를 받아 주세요.'), { retryable: true }));
                startupTimer = setTimeout(() => fail(Object.assign(new Error('음성 파일 재생을 시작하지 못했어요. 다시 시도해 주세요.'), { retryable: true })), 15000);
                await audio.play();
            } catch (error) { fail(error); }
        }
        if (window.DearMeTTS) readGateway();
        else read(0); // Retain the existing browser-speech integration as the legacy path.
    }
    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function saveFile(content, type, filename) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function loadStationery() {
        if (!stationeryPromise) {
            stationeryPromise = fetch('/letter_style.png').then(response => {
                if (!response.ok) throw new Error('stationery unavailable');
                return response.blob();
            }).then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            })).catch(error => { stationeryPromise = null; throw error; });
        }
        return stationeryPromise;
    }
    async function download() {
        if (!result) return;
        const savedResult = result;
        const button = $('download-letter-btn');
        button.disabled = true;
        button.textContent = '편지지 준비 중…';
        try {
            const stationery = await loadStationery();
            const title = `${savedResult.age}살의 ${savedResult.nickname}에게`;
            const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px 12px;color:#49372b;background:#fff;font-family:'Apple SD Gothic Neo',system-ui,sans-serif}
main{display:flex;flex-direction:column;width:100%;max-width:820px;aspect-ratio:1107/1421;margin:auto;padding:clamp(90px,18vw,155px) clamp(34px,9vw,100px) clamp(55px,10vw,80px);background:#faf2e5 url('${stationery}') center/100% 100% no-repeat}
h1,footer{font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-style:italic}h1{font-size:clamp(25px,4vw,36px);margin:0 0 28px}p{flex:1;white-space:pre-wrap;overflow-wrap:anywhere;font-size:clamp(14px,2.2vw,18px);line-height:1.95;margin:0 0 32px}footer{text-align:right;font-size:clamp(23px,3.5vw,30px)}
@media print{body{padding:0}main{max-width:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><main aria-label="나에게 도착한 편지"><h1>Dear Me</h1><p>${escapeHTML(savedResult.reply)}</p><footer>From Me</footer></main></body></html>`;
            saveFile(html, 'text/html;charset=utf-8', 'dear-me-letter.html');
        } catch {
            $('storage-status').textContent = '편지지를 불러오지 못했어요. 다시 다운로드하거나 텍스트로 저장해 주세요.';
        } finally {
            button.disabled = false;
            button.textContent = '편지지 다운받기';
        }
    }
    $('tts-retry-btn').addEventListener('click', () => play(true));
    $('character-select').addEventListener('change', event => chooseCharacter(event.target.value));
    $('character-next-btn').addEventListener('click', () => {
        if (!character) return;
        if (resolveCharacter) {
            const resolve = resolveCharacter;
            resolveCharacter = null;
            resolve(character);
        } else play();
    });
    $('replay-letter-btn').addEventListener('click', play);
    function receiveLetter() {
        if (!result || result.safetyType !== 'normal') return;
        stop();
        navigate('result-screen', '#reply-title');
    }
    $('receive-letter-btn').addEventListener('click', receiveLetter);
    $('tts-receive-btn').addEventListener('click', receiveLetter);
    $('skip-letter-btn').addEventListener('click', receiveLetter);
    $('download-text-btn').addEventListener('click', () => {
        if (result) saveFile(result.reply, 'text/plain;charset=utf-8', 'dear-me-letter.txt');
    });
    $('download-letter-btn').addEventListener('click', download);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && speaking) {
            stop();
            finish('화면을 벗어나 재생을 멈췄어요. 다시 재생할 수 있어요.');
        }
    });
    window.addEventListener('pagehide', stop);
    window.DearMePlayer = { prepare, stop, requestCharacter };
})();
