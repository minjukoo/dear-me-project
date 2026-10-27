// Image animation and browser TTS only; no additional API or audio upload.
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
    let nextTimer = null;
    let currentUtterance = null;
    let speaking = false;
    let frame = 'normal';
    let backgroundPromise = null;
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
        mouthTimer = startupTimer = nextTimer = null;
    }
    function stop() {
        token++;
        clearTimers();
        if (speaking && synth) synth.cancel();
        speaking = false;
        currentUtterance = null;
        setFrame('normal');
    }
    function finish(message = '') {
        clearTimers();
        speaking = false;
        currentUtterance = null;
        const run = token;
        const smile = assets[character] && cache.get(assets[character].smile);
        setFrame(smile?.state === 'ready' ? 'smile' : 'hello');
        nextTimer = setTimeout(() => {
            if (run !== token) return;
            $('ending-status').textContent = message;
            navigate('ending-screen', '#ending-title');
        }, 900);
    }
    function chooseCharacter(value) {
        character = assets[value] ? value : '';
        if (character) Object.values(assets[character]).forEach(preload);
        setFrame('normal');
        $('character-next-btn').disabled = !character;
    }
    function prepare(data) {
        stop();
        result = data;
        loadBackground().catch(() => {});
        chooseCharacter(data.gender);
        if (character) play();
        else {
            $('character-select').value = '';
            navigate('character-select-screen', '#character-choice-title');
        }
    }
    function play() {
        if (!result || result.safetyType !== 'normal' || !character || speaking) return;
        stop();
        const run = token;
        const sentences = result.reply.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/gu)?.map(s => s.trim()).filter(Boolean) || [result.reply];
        const voice = supported && synth.getVoices().find(v => v.lang.toLowerCase().startsWith('ko'));
        speaking = true;
        navigate('player-screen', '#player-title');
        $('letter-subtitle').textContent = '';
        $('player-status').textContent = supported ? '편지를 읽고 있어요.' : '음성이 지원되지 않아 자막으로 편지를 전해요.';
        function animateMouth() {
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                mouthTimer = setInterval(() => setFrame(frame === 'mouth' ? 'normal' : 'mouth'), 250);
            }
        }
        function read(index) {
            if (run !== token) return;
            if (index >= sentences.length) { finish(supported ? '' : '음성이 지원되지 않아 자막으로 편지를 전했어요.'); return; }
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
        read(0);
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
    function loadBackground() {
        if (!backgroundPromise) {
            backgroundPromise = fetch('/start.png').then(response => {
                if (!response.ok) throw new Error('background unavailable');
                return response.blob();
            }).then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            })).catch(error => { backgroundPromise = null; throw error; });
        }
        return backgroundPromise;
    }
    async function download() {
        if (!result) return;
        const savedResult = result;
        const button = $('download-letter-btn');
        button.disabled = true;
        button.textContent = '편지지 준비 중…';
        try {
            const background = await loadBackground();
            const title = `${savedResult.age}살의 ${savedResult.nickname}에게`;
            const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>*{box-sizing:border-box}body{margin:0;padding:48px 20px;min-height:100vh;color:#333;background:#ecebf5 url('${background}') center/cover fixed no-repeat;font-family:system-ui,sans-serif;line-height:1.9}main{margin:auto;padding:clamp(24px,5vw,48px);max-width:740px;background:rgba(255,255,255,.94);border-radius:20px;box-shadow:0 12px 40px #28243b22}h1{font-size:24px}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{padding:0;background:white}main{box-shadow:none;max-width:none}}</style></head><body><main><h1>${escapeHTML(title)}</h1><p>${escapeHTML(savedResult.reply)}</p></main></body></html>`;
            saveFile(html, 'text/html;charset=utf-8', 'dear-me-letter.html');
        } catch {
            $('storage-status').textContent = '배경을 불러오지 못했어요. 다시 다운로드하거나 텍스트로 저장해 주세요.';
        } finally {
            button.disabled = false;
            button.textContent = '편지지 다운받기';
        }
    }
    $('character-select').addEventListener('change', event => chooseCharacter(event.target.value));
    $('character-next-btn').addEventListener('click', play);
    $('replay-letter-btn').addEventListener('click', play);
    function receiveLetter() {
        if (!result || result.safetyType !== 'normal') return;
        stop();
        navigate('result-screen', '#reply-title');
    }
    $('receive-letter-btn').addEventListener('click', receiveLetter);
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
    window.DearMePlayer = { prepare, stop };
})();
