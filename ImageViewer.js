// ==UserScript==
// @name         Image Fullscreen Toggle v1.28
// @namespace    http://example.com/
// @version      1.28
// @description  Click any image on chatgpt.com or grok.com to zoom+fullscreen; Esc or click closes overlay; ←/→/Space/Meta/Alt/buttons to navigate; transparent nav buttons; Scroll button exits fullscreen and scrolls to image location; unique image navigation excluding avatars; opt-in on chatgpt.com and grok.com, disabled on /library pages; exclude avatars and generated images on click, but include generated images in navigation.
// @match        *://chatgpt.com/*
// @match        *://*.chatgpt.com/*
// @match        *://grok.com/*
// @match        *://*.grok.com/*
// @exclude      *://chatgpt.com/library*
// @exclude      *://*.chatgpt.com/library*
// @exclude      *://grok.com/library*
// @exclude      *://*.grok.com/library*
// @grant        none
// @run-at       document-start
//
// Source: https://chatgpt.com/c/6827d896-1b44-8004-b7f3-80ce87de8778
// ==/UserScript==

(function() {
    'use strict';

    let overlay = null;
    let imgs = [];
    let currentIndex = -1;
    let overlayImage = null;

    // Check if image should be skipped from navigation (avatars, etc.)
    function shouldSkipImage(img) {
        const alt = img.getAttribute('alt');
        // Skip avatars: ChatGPT (alt="User") and Grok (alt="pfp")
        return alt === 'User' || alt === 'pfp';
    }

    // Exclude certain images and generated-image blocks on initial click
    function isExcludedImage(img) {
        if (shouldSkipImage(img)) return true;
        if (img.closest('div.flex.flex-col.gap-2')) return true;
        return false;
    }

    function clearOverlay() {
        if (!overlay) return;
        overlay.removeEventListener('click', hideFullscreen);
        overlay.remove();
        overlay = null;
    }

    function hideFullscreen() {
        const doc = document;
        const exitFn = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
        if (exitFn) exitFn.call(doc);
        clearOverlay();
    }

    function scrollToImage() {
        const imgEl = imgs[currentIndex];
        hideFullscreen();
        setTimeout(() => imgEl?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }

    function navigate(delta) {
        currentIndex = (currentIndex + delta + imgs.length) % imgs.length;
        overlayImage.src = imgs[currentIndex].src;
    }

    function showFullscreen(img) {
        if (isExcludedImage(img)) return;
        // Build unique image list by src, skipping certain images, include all others
        const allImgs = Array.from(document.querySelectorAll('img'));
        const seen = new Set();
        imgs = [];
        for (const imgEl of allImgs) {
            if (shouldSkipImage(imgEl)) continue;
            const src = imgEl.src;
            if (!seen.has(src)) {
                seen.add(src);
                imgs.push(imgEl);
            }
        }
        currentIndex = imgs.indexOf(img);
        if (currentIndex < 0) currentIndex = 0;

        // Enter browser fullscreen
        const docEl = document.documentElement;
        const requestFn = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
        requestFn?.call(docEl);

        // Create overlay
        overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: 0, left: 0,
            width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2147483647, cursor: 'zoom-out'
        });

        // Display image
        overlayImage = img.cloneNode();
        Object.assign(overlayImage.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
        overlay.appendChild(overlayImage);

        // Navigation buttons
        const createNav = (symbol, handler) => {
            const btn = document.createElement('div');
            Object.assign(btn.style, {
                position: 'absolute', top: 0, bottom: 0,
                width: '10%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'transparent', color: 'rgba(255,255,255,0.3)',
                fontSize: '3rem', cursor: 'pointer', userSelect: 'none', zIndex: 2147483648
            });
            btn.textContent = symbol;
            btn.addEventListener('click', e => { e.stopPropagation(); handler(); });
            overlay.appendChild(btn);
            return btn;
        };
        const navLeft = createNav('<', () => navigate(-1)); navLeft.style.left = '0';
        const navRight = createNav('>', () => navigate(1)); navRight.style.right = '0';

        // Scroll button
        const scrollBtn = document.createElement('div');
        Object.assign(scrollBtn.style, {
            position: 'absolute', top: '10px', right: '10px',
            width: '3rem', height: '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'transparent', color: 'rgba(255,255,255,0.3)',
            fontSize: '2rem', cursor: 'pointer', userSelect: 'none', zIndex: 2147483648
        });
        scrollBtn.textContent = '⇨'; scrollBtn.title = 'Scroll to image';
        scrollBtn.addEventListener('click', e => { e.stopPropagation(); scrollToImage(); });
        overlay.appendChild(scrollBtn);

        // Close overlay on click
        overlay.addEventListener('click', hideFullscreen);
        document.body.appendChild(overlay);
    }

    // Intercept left-click and dragstart on non-excluded images
    ['click', 'dragstart'].forEach(evt => document.addEventListener(evt, e => {
        if (!overlay && e.target.tagName === 'IMG' && !isExcludedImage(e.target) && e.button === 0) {
            e.preventDefault(); e.stopPropagation();
        }
    }, true));

    // Open on left-click for non-excluded images
    document.addEventListener('click', e => {
        if (!overlay && e.button === 0 && e.target.tagName === 'IMG' && !isExcludedImage(e.target)) {
            showFullscreen(e.target);
        }
    }, true);

    // Keyboard controls
    document.addEventListener('keydown', e => {
        if (!overlay) return;
        if (e.key === 'Escape') { e.preventDefault(); hideFullscreen(); return; }
        if (['ArrowRight', ' ', 'Spacebar'].includes(e.key)) { e.preventDefault(); navigate(1); }
        else if (['ArrowLeft', 'Meta', 'Alt'].includes(e.key)) { e.preventDefault(); navigate(-1); }
    });

    // Clear overlay on fullscreen exit
    ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => {
        if (overlay && !document.fullscreenElement && !document.webkitFullscreenElement &&
            !document.mozFullScreenElement && !document.msFullscreenElement) clearOverlay();
    }));
})();
