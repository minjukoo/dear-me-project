// Image animation and browser TTS only; no additional API or audio upload.
(() => {
    const $ = (id) => document.getElementById(id);
    const assets = {
        male: { normal: 'male_normal.jpg', mouth: 'male_mouth.png', smile: 'male_smile.png', hello: 'male_hello.jpg' },
        female: { normal: 'female_normal.jpg', mouth: 'female_mouth.jpg', smile: 'female_smile.jpg', hello: 'female_hello.jpg' },
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
    let currentUtterance = null;
    let speaking = false;
    let frame = 'normal';

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
    }
    function setFrame(next) { frame = next; render(); }
    function clearTimers() {
        clearInterval(mouthTimer);
        clearTimeout(startupTimer);
        mouthTimer = null;
        startupTimer = null;
    }
    function stop() {
        token++;
        clearTimers();
        if (speaking && synth) synth.cancel();
        speaking = false;
        currentUtterance = null;
        setFrame('normal');
        $('play-letter-btn').hidden = false;
        $('stop-letter-btn').hidden = true;
        $('character-select').disabled = false;
    }
    function finish(message = '편지를 모두 읽었어요.') {
        clearTimers();
        speaking = false;
        currentUtterance = null;
        const smile = assets[character] && cache.get(assets[character].smile);
        setFrame(smile?.state === 'ready' ? 'smile' : 'hello');
        $('player-status').textContent = message;
        $('stop-letter-btn').hidden = true;
        $('play-letter-btn').hidden = true;
        $('result-actions').hidden = false;
        $('character-select').disabled = false;
    }
    function chooseCharacter(value) {
        character = assets[value] ? value : '';
        if (character) Object.values(assets[character]).forEach(preload);
        setFrame('normal');
        $('play-letter-btn').disabled = !character && supported;
    }
    function prepare(data) {
        stop();
        result = data;
        $('result-actions').hidden = supported;
        $('character-choice').hidden = data.gender === 'male' || data.gender === 'female';
        $('character-select').value = assets[data.gender] ? data.gender : '';
        chooseCharacter(data.gender);
        $('letter-subtitle').textContent = '재생하기를 누르면 편지를 읽어 드려요.';
        $('player-status').textContent = supported
            ? '기기의 음성으로 읽어요. 이미지가 없어도 음성과 답장 전문을 이용할 수 있어요.'
            : '이 브라우저는 음성 재생을 지원하지 않아요. 답장 전문을 읽거나 편지지를 내려받아 주세요.';
        $('play-letter-btn').hidden = !supported;
    }
    function play() {
        if (!result || result.safetyType !== 'normal' || !supported || !character || speaking) return;
        stop();
        const run = token;
        // One utterance per sentence keeps subtitles aligned even without boundary events.
        const sentences = result.reply.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/gu)?.map(s => s.trim()).filter(Boolean) || [result.reply];
        const voice = synth.getVoices().find(v => v.lang.toLowerCase().startsWith('ko'));
        speaking = true;
        $('result-actions').hidden = true;
        $('play-letter-btn').hidden = true;
        $('stop-letter-btn').hidden = false;
        $('character-select').disabled = true;
        $('player-status').textContent = '음성을 준비하고 있어요…';
        function read(index) {
            if (run !== token) return;
            if (index >= sentences.length) { finish(); return; }
            const utterance = new SpeechSynthesisUtterance(sentences[index]);
            currentUtterance = utterance; // Keep a reference while the browser speaks.
            utterance.lang = 'ko-KR';
            utterance.rate = 0.95;
            if (voice) utterance.voice = voice;
            utterance.onstart = () => {
                if (run !== token) return;
                clearTimers();
                $('player-status').textContent = '미래의 내가 편지를 읽고 있어요.';
                $('letter-subtitle').textContent = sentences[index];
                if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    mouthTimer = setInterval(() => setFrame(frame === 'mouth' ? 'normal' : 'mouth'), 250);
                }
            };
            utterance.onend = () => {
                if (run !== token) return;
                clearTimers();
                setFrame('normal');
                read(index + 1);
            };
            utterance.onerror = () => {
                if (run !== token) return;
                stop();
                finish('음성을 재생하지 못했어요. 다시 재생하거나 답장 전문을 읽어 주세요.');
            };
            startupTimer = setTimeout(() => {
                if (run !== token) return;
                stop();
                finish('음성 재생을 시작하지 못했어요. 기기의 음성 설정을 확인하거나 다시 재생해 주세요.');
            }, 12000);
            try { synth.speak(utterance); }
            catch { utterance.onerror(); }
        }
        read(0);
    }
    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function download() {
        if (!result) return;
        const title = `${result.age}살의 ${result.nickname}에게`;
        const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>body{margin:40px auto;padding:32px;max-width:700px;color:#333;background:#faf8f1;font-family:system-ui,sans-serif;line-height:1.9}h1{font-size:24px}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{background:white;margin:0}}</style><h1>${escapeHTML(title)}</h1><p>${escapeHTML(result.reply)}</p></html>`;
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'dear-me-letter.html';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    $('play-letter-btn').addEventListener('click', play);
    $('replay-letter-btn').addEventListener('click', play);
    $('stop-letter-btn').addEventListener('click', () => { stop(); finish('재생을 멈췄어요. 다시 재생할 수 있어요.'); });
    $('character-select').addEventListener('change', event => chooseCharacter(event.target.value));
    $('download-letter-btn').addEventListener('click', download);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && speaking) { stop(); finish('화면을 벗어나 재생을 멈췄어요. 다시 재생할 수 있어요.'); }
    });
    window.addEventListener('pagehide', stop);
    window.DearMePlayer = { prepare, stop };
})();
