// Frame loading and subtitle length must never change the scene's geometry.
(() => {
    const portrait = window.matchMedia('(max-width: 1024px) and (orientation: portrait)');
    const stage = document.getElementById('character-stage');
    const image = document.getElementById('character-image');
    const caption = document.getElementById('letter-subtitle');
    function sync() {
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!w || !h) return;
        const width = portrait.matches ? w : Math.max(w, h * 16 / 9);
        const height = width * 9 / 16;
        const left = (w - width) / 2, top = (h - height) / 2;
        Object.assign(image.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
        // Match the bar baked into the supplied 16:9 images; clamp when cropped.
        const cw = Math.min(width * .76, w - 24);
        const ch = Math.min(Math.max(height * .095, 28), h * .25);
        Object.assign(caption.style, {
            left: `${Math.max(12, Math.min(w - cw - 12, left + width * .12))}px`,
            top: `${Math.max(12, Math.min(h - ch - 16, top + height * .85))}px`,
            width: `${cw}px`, height: `${ch}px`,
            fontSize: `${Math.max(11, Math.min(24, width * .0135))}px`,
        });
    }
    new ResizeObserver(sync).observe(stage);
    portrait.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    window.DearMeLayout = { sync };
})();
