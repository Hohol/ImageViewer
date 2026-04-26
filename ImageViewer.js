// ==UserScript==
// @name         ImageViewer
// @namespace    http://example.com/
// @version      1.88
// @description  Improves image and video UI on ChatGPT, Gemini, and Grok.
// @match        *://chatgpt.com/*
// @match        *://*.chatgpt.com/*
// @match        *://grok.com/*
// @match        *://*.grok.com/*
// @match        *://gemini.google.com/*
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

    // Wait for DOM to be ready before checking
    function init() {
        // Don't run on pages that are just a single image or video (Open in New Tab)
        if (document.body.children.length === 1) {
            const onlyChild = document.body.children[0];
            if (onlyChild.tagName === 'IMG') {
                return;
            }
            if (onlyChild.tagName === 'VIDEO') {
                // Make video loop on video-only pages
                onlyChild.loop = true;
                return;
            }
        }

    let overlay = null;
    let imgs = [];
    let currentIndex = -1;
    let overlayImage = null;

    function isGrokHost() {
        const h = location.hostname;
        return h === 'grok.com' || h.endsWith('.grok.com');
    }

    function isGeminiHost() {
        return location.hostname === 'gemini.google.com';
    }

    /** Gemini inline AI results: blob on-page, or CDN (lh3.googleusercontent.com / ggpht) with same markup. */
    function isGeminiOptInResultSrc(src) {
        if (!src) return false;
        if (src.startsWith('blob:https://gemini.google.com/')) return true;
        if (!/^https?:/i.test(src)) return false;
        try {
            const h = new URL(src).hostname;
            return h.endsWith('googleusercontent.com') || h.endsWith('ggpht.com');
        } catch (e) {
            return false;
        }
    }

    // Gemini: only inline AI-generated results (opt-in), not uploads / UI / etc.
    function isGeminiOptInImage(img) {
        if (!img || img.tagName !== 'IMG' || !isGeminiHost()) return false;
        const src = img.getAttribute('src') || img.src || '';
        if (!isGeminiOptInResultSrc(src)) return false;
        const cls = img.getAttribute('class') || '';
        if (!/\bimage\b/.test(cls) || !/\bloaded\b/.test(cls)) return false;
        const alt = img.getAttribute('alt') || '';
        if (!/AI\s+generated/i.test(alt)) return false;
        return true;
    }

    // Grok: only main chat generated images (opt-in), not thumbnails / chrome / etc.
    function isGrokOptInImage(img) {
        if (img.closest('[class*="group/grok-image"]')) return true;
        // Imagine / large inline card: img.col-start-1.row-start-1 inside div.grid under rounded-2xl group card
        const grid = img.closest('div.grid');
        if (grid && img.classList.contains('col-start-1') && img.classList.contains('row-start-1')) {
            const card = grid.parentElement;
            if (card && card.classList.contains('group') && card.classList.contains('rounded-2xl')) {
                return true;
            }
        }
        return false;
    }

    // Grok: chat cards use object-cover + max-height so portrait images crop top/bottom
    if (isGrokHost() && !document.getElementById('iv-grok-portrait-fix')) {
        const s = document.createElement('style');
        s.id = 'iv-grok-portrait-fix';
        s.textContent = `
            [class*="group/grok-image"] img { object-fit: contain !important; }
            div.grid > img.col-start-1.row-start-1.object-cover { object-fit: contain !important; }
        `;
        document.head.appendChild(s);
    }

    // Check if image should be skipped from navigation (avatars, previews, etc.)
    function shouldSkipImage(img) {
        if (isGrokHost() && !isGrokOptInImage(img)) return true;
        if (isGeminiHost() && !isGeminiOptInImage(img)) return true;
        const alt = img.getAttribute('alt');
        // Skip avatars: ChatGPT (alt="User") and Grok (alt="pfp")
        if (alt === 'User' || alt === 'pfp') return true;
        // Grok grid thumbnails (e.g. alt="Thumbnail 1")
        if (alt && /^Thumbnail\b/i.test(alt)) return true;
        // Grok compact selectable grid cards (same cards as click exclude below)
        if (img.closest('[class*="compact-card"]')) return true;
        // Skip preview images (Grok: /preview-image or .../preview_image.jpg)
        if (img.src.endsWith('/preview-image')) return true;
        if (img.src.includes('/preview_image')) return true;
        // Skip nearly invisible images (loading/transitioning placeholders)
        const opacity = parseFloat(img.style.opacity);
        if (!isNaN(opacity) && opacity < 0.5) return true;
        // Skip blurred background images (decorative backdrops)
        const parent = img.parentElement;
        if (parent && parent.classList.contains('blur-2xl')) return true;
        return false;
    }

    // Exclude certain images and generated-image blocks on initial click
    function isExcludedImage(img) {
        if (shouldSkipImage(img)) return true;
        if (img.closest('div.flex.flex-col.gap-2')) {
            const grokOk = isGrokHost() && isGrokOptInImage(img);
            const geminiOk = isGeminiHost() && isGeminiOptInImage(img);
            if (!grokOk && !geminiOk) return true;
        }
        // Skip thumbnail images in Favorites button
        if (img.closest('button[aria-label="Favorites"]')) return true;
        // Skip masonry grid thumbnails (Grok's image gallery)
        if (img.closest('[role="listitem"]')) return true;
        // Skip Gemini uploaded image preview buttons
        if (img.closest('button.preview-image-button')) return true;
        // Skip images in Grok's "Which image do you prefer?" feedback overlay
        if (img.closest('.backdrop-blur-md')) return true;
        return false;
    }

    function clearOverlay() {
        if (!overlay) return;
        overlay.removeEventListener('click', hideFullscreen);
        overlay.remove();
        overlay = null;
    }

    // BROWSER BUG WORKAROUND: When user right-clicks and uses context menu (e.g., "Copy image"
    // or "Copy video frame") while in fullscreen, the browser decouples the Fullscreen API
    // state from the actual browser window fullscreen state. The API reports we're not in
    // fullscreen (fullscreenElement is null), but the browser window remains visually fullscreen.
    // To fix this, we re-enter fullscreen via the API to re-sync the states, then immediately
    // exit, which properly exits both API and window fullscreen.
    function exitFullscreenWithWorkaround(elementForReentry) {
        const doc = document;
        const exitFn = doc.exitFullscreen || doc.webkitExitFullscreen || 
                      doc.mozCancelFullScreen || doc.msExitFullscreen;
        
        if (!exitFn) return Promise.resolve();
        
        const result = exitFn.call(doc);
        
        // Check after delay if we're visually stuck in fullscreen
        setTimeout(() => {
            const stillFs = doc.fullscreenElement || doc.webkitFullscreenElement;
            const isVisuallyFs = window.innerHeight >= screen.height - 50;
            
            if (stillFs && exitFn) {
                exitFn.call(doc);
            }
            // If visually fullscreen but API says no, re-enter and exit to re-sync
            if (isVisuallyFs && !stillFs) {
                const el = elementForReentry || document.documentElement;
                const requestFn = el.requestFullscreen || el.webkitRequestFullscreen || 
                                 el.mozRequestFullScreen || el.msRequestFullscreen;
                if (requestFn) {
                    requestFn.call(el).then(() => exitFn.call(doc)).catch(() => {});
                }
            }
        }, 100);
        
        return result;
    }

    function hideFullscreen() {
        const doc = document;
        const isFullscreen = doc.fullscreenElement || doc.webkitFullscreenElement || 
                            doc.mozFullScreenElement || doc.msFullscreenElement;
        
        const result = exitFullscreenWithWorkaround();
        if (result && result.then) {
            result.catch(() => clearOverlay());
        }
        
        if (!isFullscreen) {
        clearOverlay();
        }
    }

    function scrollToImage() {
        const imgEl = imgs[currentIndex];
        hideFullscreen();
        setTimeout(() => imgEl?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }

    // Convert Google image URL to full-size version
    function getFullSizeGoogleUrl(src) {
        if (src.includes('googleusercontent.com') || src.includes('ggpht.com')) {
            // Remove size parameters like =s1024-rj or =w500-h400 to get original size
            return src.replace(/=[swh]\d+(-\w+)?$/i, '=s0');
        }
        return src;
    }

    // Display an image in the overlay with progressive loading (low-quality first, then high-quality)
    function displayImageInOverlay(imgEl) {
        const lowQualitySrc = imgEl.src;
        const fullSizeSrc = getFullSizeGoogleUrl(lowQualitySrc);
        const expectedIndex = currentIndex;
        
        // Reset aspect-ratio to prevent inherited constraints
        overlayImage.style.aspectRatio = 'auto';
        
        // Show low-quality immediately, then swap to high-quality when loaded
        if (fullSizeSrc !== lowQualitySrc) {
            overlayImage.src = lowQualitySrc;
            const preloader = new Image();
            preloader.onload = () => {
                // Only update if we're still on the same image and overlay exists
                if (currentIndex === expectedIndex && overlayImage) {
                    overlayImage.src = fullSizeSrc;
                }
            };
            preloader.src = fullSizeSrc;
        } else {
            overlayImage.src = lowQualitySrc;
        }
    }

    function navigate(delta) {
        const next = currentIndex + delta;
        if (next < 0 || next >= imgs.length) return;
        currentIndex = next;
        displayImageInOverlay(imgs[currentIndex]);
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
        
        // Find index by src, not by element reference
        currentIndex = imgs.findIndex(imgEl => imgEl.src === img.src);
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

        // Create overlay image element
        overlayImage = img.cloneNode();
        
        // Remove all classes/attributes that might have size restrictions
        overlayImage.removeAttribute('class');
        overlayImage.removeAttribute('_ngcontent-ng-c1355997682');
        overlayImage.removeAttribute('loading');
        
        // Set styles to stretch image to fill screen while maintaining aspect ratio
        Object.assign(overlayImage.style, { 
            maxWidth: '100%', 
            maxHeight: '100%', 
            width: '100%',
            height: '100%',
            objectFit: 'contain'
        });
        
        // Display the image with progressive loading
        displayImageInOverlay(img);
        
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

    // Clear overlay on fullscreen exit (with browser bug workaround)
    ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => {
        if (overlay && !document.fullscreenElement && !document.webkitFullscreenElement &&
            !document.mozFullScreenElement && !document.msFullscreenElement) {
            clearOverlay();
            
            // Apply browser bug workaround for images (same as videos)
            setTimeout(() => {
                const stillFs = document.fullscreenElement || document.webkitFullscreenElement;
                const isVisuallyFs = window.innerHeight >= screen.height - 50;
                
                if (isVisuallyFs && !stillFs) {
                    const docEl = document.documentElement;
                    const requestFn = docEl.requestFullscreen || docEl.webkitRequestFullscreen || 
                                     docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
                    const exitFn = document.exitFullscreen || document.webkitExitFullscreen || 
                                  document.mozCancelFullScreen || document.msExitFullscreen;
                    if (requestFn && exitFn) {
                        requestFn.call(docEl).then(() => exitFn.call(document)).catch(() => {});
                    }
                }
            }, 100);
        }
    }));

    // === VIDEO FULLSCREEN FUNCTIONALITY ===
    
    // Shared volume state across all videos (persisted in localStorage)
    const STORAGE_KEY = 'imageViewerSharedVolume';
    let sharedVolume = (() => {
        try {
            const v = parseFloat(localStorage.getItem(STORAGE_KEY));
            return !isNaN(v) && v >= 0 && v <= 1 ? v : 1.0;
        } catch (e) { return 1.0; }
    })();
    
    // Volume overlay indicator
    let volumeOverlay = null;
    let volumeHideTimeout = null;
    
    function showVolumeOverlay(volume) {
        if (!volumeOverlay) {
            volumeOverlay = document.createElement('div');
            // Popover API puts the element in the browser's top layer,
            // making it visible even over fullscreen elements
            volumeOverlay.setAttribute('popover', 'manual');
            Object.assign(volumeOverlay.style, {
                position: 'fixed',
                inset: 'auto',
                bottom: '60px',
                left: '50%',
                transform: 'translateX(-50%)',
                margin: '0',
                border: 'none',
                zIndex: '2147483647',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                color: 'white',
                fontSize: '14px',
                fontFamily: 'sans-serif',
                transition: 'opacity 0.3s',
                pointerEvents: 'none',
                userSelect: 'none',
                overflow: 'visible'
            });
            
            const barBg = document.createElement('div');
            Object.assign(barBg.style, {
                width: '120px',
                height: '4px',
                borderRadius: '2px',
                backgroundColor: 'rgba(255, 255, 255, 0.25)'
            });
            
            const barFill = document.createElement('div');
            Object.assign(barFill.style, {
                height: '100%',
                borderRadius: '2px',
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                transition: 'width 0.1s'
            });
            barBg.appendChild(barFill);
            
            const label = document.createElement('span');
            volumeOverlay._barFill = barFill;
            volumeOverlay._label = label;
            
            volumeOverlay.appendChild(label);
            volumeOverlay.appendChild(barBg);
            document.body.appendChild(volumeOverlay);
        }
        
        const pct = Math.round(volume * 100);
        volumeOverlay._barFill.style.width = pct + '%';
        volumeOverlay._label.textContent = pct + '%';
        
        try { volumeOverlay.showPopover(); } catch(e) {}
        volumeOverlay.style.opacity = '1';
        
        clearTimeout(volumeHideTimeout);
        volumeHideTimeout = setTimeout(() => {
            if (volumeOverlay) {
                volumeOverlay.style.opacity = '0';
                setTimeout(() => {
                    try { volumeOverlay.hidePopover(); } catch(e) {}
                }, 300);
            }
        }, 1500);
    }
    
    function isPostPage() {
        return location.pathname.startsWith('/imagine/post/');
    }

    function isGrokImagineSavedPage() {
        return (
            isGrokHost() &&
            (location.pathname === '/imagine/saved' || location.pathname.startsWith('/imagine/saved/'))
        );
    }

    const IV_GROK_SAVED_KEPT_KEY = 'ivGrokImagineSavedKeptIds';
    const IV_GROK_SAVED_UNKEPT_FILTER_KEY = 'ivGrokImagineSavedShowUnkeptOnly';
    const IV_GROK_SAVED_FILTER_BTN_ID = 'iv-grok-saved-kept-filter';

    function grokSavedLoadKeptSet() {
        try {
            const raw = localStorage.getItem(IV_GROK_SAVED_KEPT_KEY);
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return new Set();
            return new Set(arr.map((x) => String(x).toLowerCase()));
        } catch (e) {
            return new Set();
        }
    }

    function grokSavedStoreKeptSet(set) {
        try {
            localStorage.setItem(IV_GROK_SAVED_KEPT_KEY, JSON.stringify([...set].sort()));
        } catch (e2) {}
    }

    function grokSavedLoadUnkeptOnlyFilter() {
        try {
            return localStorage.getItem(IV_GROK_SAVED_UNKEPT_FILTER_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function grokSavedStoreUnkeptOnlyFilter(on) {
        try {
            localStorage.setItem(IV_GROK_SAVED_UNKEPT_FILTER_KEY, on ? '1' : '0');
        } catch (e) {}
    }

    /** Recently deleted media ids (same as grid / API ids); TTL + max size so localStorage stays small. */
    const IV_GROK_RECENT_DELETED_KEY = 'ivGrokRecentlyDeletedMedia';
    const IV_GROK_RECENT_DELETED_TTL_MS = 10 * 60 * 1000;
    const IV_GROK_RECENT_DELETED_MAX_ENTRIES = 100;

    function grokRecentlyDeletedParseRaw() {
        try {
            const raw = localStorage.getItem(IV_GROK_RECENT_DELETED_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function grokRecentlyDeletedPruneEntries(arr) {
        const now = Date.now();
        const ttl = IV_GROK_RECENT_DELETED_TTL_MS;
        const fresh = [];
        for (let i = 0; i < arr.length; i++) {
            const e = arr[i];
            if (!e || !e.id || typeof e.t !== 'number') continue;
            if (now - e.t > ttl) continue;
            fresh.push({ id: String(e.id).toLowerCase(), t: e.t });
        }
        const byId = new Map();
        for (let j = 0; j < fresh.length; j++) {
            const e = fresh[j];
            const prev = byId.get(e.id);
            if (!prev || e.t > prev.t) byId.set(e.id, e);
        }
        let out = [...byId.values()];
        out.sort((a, b) => b.t - a.t);
        if (out.length > IV_GROK_RECENT_DELETED_MAX_ENTRIES) {
            out = out.slice(0, IV_GROK_RECENT_DELETED_MAX_ENTRIES);
        }
        return out;
    }

    function grokRecentlyDeletedPersistIfChanged(before, pruned) {
        if (JSON.stringify(before) === JSON.stringify(pruned)) return;
        try {
            if (pruned.length === 0) {
                localStorage.removeItem(IV_GROK_RECENT_DELETED_KEY);
            } else {
                localStorage.setItem(IV_GROK_RECENT_DELETED_KEY, JSON.stringify(pruned));
            }
        } catch (e2) {}
    }

    function grokRecentlyDeletedLoadSet() {
        const raw = grokRecentlyDeletedParseRaw();
        const pruned = grokRecentlyDeletedPruneEntries(raw);
        grokRecentlyDeletedPersistIfChanged(raw, pruned);
        return new Set(pruned.map((e) => e.id));
    }

    function grokRecentlyDeletedAddIds(idList) {
        if (!idList || !idList.length) return;
        const raw = grokRecentlyDeletedParseRaw();
        const now = Date.now();
        const next = raw.slice();
        for (let i = 0; i < idList.length; i++) {
            const id = String(idList[i] || '')
                .trim()
                .toLowerCase();
            if (!id) continue;
            next.push({ id: id, t: now });
        }
        const pruned = grokRecentlyDeletedPruneEntries(next);
        try {
            if (pruned.length === 0) {
                localStorage.removeItem(IV_GROK_RECENT_DELETED_KEY);
            } else {
                localStorage.setItem(IV_GROK_RECENT_DELETED_KEY, JSON.stringify(pruned));
            }
        } catch (e3) {}
    }

    function grokSavedMediaIdFromCard(card) {
        if (!card) return null;
        const img = card.querySelector('img[src]');
        const fromImg = imaginePostIdFromImgElement(img);
        if (fromImg) return fromImg;
        const vid = card.querySelector('video');
        return imaginePostIdFromVideoElement(vid);
    }

    function grokSavedGetGridCards() {
        const cards = [];
        const seen = new Set();
        document.querySelectorAll('div.grid.w-full.select-none').forEach((grid) => {
            grid.querySelectorAll(':scope > div').forEach((cell) => {
                if (!cell.querySelector) return;
                if (!cell.querySelector('img[src]') && !cell.querySelector('video')) return;
                if (seen.has(cell)) return;
                seen.add(cell);
                cards.push(cell);
            });
        });
        return cards;
    }

    let grokSavedKeepSyncScheduled = false;
    function scheduleGrokImagineSavedKeepSync() {
        if (!isGrokHost() || grokSavedKeepSyncScheduled) return;
        grokSavedKeepSyncScheduled = true;
        requestAnimationFrame(() => {
            grokSavedKeepSyncScheduled = false;
            syncGrokImagineSavedKeepUi();
        });
    }

    function syncGrokImagineSavedKeepUi() {
        const filterExisting = document.getElementById(IV_GROK_SAVED_FILTER_BTN_ID);
        if (!isGrokImagineSavedPage()) {
            if (filterExisting) filterExisting.remove();
            document.querySelectorAll('[data-iv-grok-keep-btn]').forEach((b) => b.remove());
            document.querySelectorAll('[data-iv-grok-saved-card]').forEach((el) => {
                el.style.display = '';
                delete el.dataset.ivGrokSavedCard;
            });
            return;
        }

        const keptSet = grokSavedLoadKeptSet();
        const unkeptOnly = grokSavedLoadUnkeptOnlyFilter();
        const recentDeleted = grokRecentlyDeletedLoadSet();

        let filterBtn = filterExisting;
        if (!filterBtn) {
            filterBtn = document.createElement('button');
            filterBtn.id = IV_GROK_SAVED_FILTER_BTN_ID;
            filterBtn.type = 'button';
            Object.assign(filterBtn.style, {
                position: 'fixed',
                top: '12px',
                right: '16px',
                zIndex: '2147483630',
                padding: '6px 12px',
                borderRadius: '9999px',
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(24,24,27,0.92)',
                color: '#fafafa',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                boxShadow: '0 2px 10px rgba(0,0,0,0.35)'
            });
            filterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                grokSavedStoreUnkeptOnlyFilter(!grokSavedLoadUnkeptOnlyFilter());
                scheduleGrokImagineSavedKeepSync();
            });
            document.body.appendChild(filterBtn);
        }
        filterBtn.textContent = unkeptOnly ? 'Show all' : 'Unkept only';
        filterBtn.title = unkeptOnly
            ? 'Show every tile again.'
            : 'Hide tiles you marked Keep. Kept tiles stay hidden until you turn this off.';

        const cards = grokSavedGetGridCards();
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            card.dataset.ivGrokSavedCard = '1';
            const mediaId = grokSavedMediaIdFromCard(card);

            if (unkeptOnly) {
                if (mediaId && keptSet.has(mediaId)) {
                    card.style.display = 'none';
                } else {
                    card.style.display = '';
                }
            } else {
                card.style.display = '';
            }
            if (mediaId && recentDeleted.has(mediaId)) {
                card.style.display = 'none';
            }

            if (!mediaId) continue;

            let kbtn = card.querySelector('[data-iv-grok-keep-btn]');
            if (!kbtn) {
                kbtn = document.createElement('button');
                kbtn.type = 'button';
                kbtn.dataset.ivGrokKeepBtn = '1';
                Object.assign(kbtn.style, {
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    zIndex: '25',
                    fontSize: '11px',
                    fontWeight: '600',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.35)',
                    color: '#fff',
                    cursor: 'pointer',
                    lineHeight: '1.2',
                    pointerEvents: 'auto',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.4)'
                });
                kbtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const set = grokSavedLoadKeptSet();
                    const mid = grokSavedMediaIdFromCard(card);
                    if (!mid) return;
                    if (set.has(mid)) {
                        set.delete(mid);
                    } else {
                        set.add(mid);
                    }
                    grokSavedStoreKeptSet(set);
                    scheduleGrokImagineSavedKeepSync();
                });
                card.appendChild(kbtn);
            }

            const isKept = keptSet.has(mediaId);
            kbtn.textContent = isKept ? 'Unkeep' : 'Keep';
            kbtn.title = isKept
                ? 'Remove this item from your local kept list.'
                : 'Remember this item in this browser (localStorage).';
            kbtn.style.background = isKept ? 'rgba(22,101,52,0.9)' : 'rgba(0,0,0,0.55)';
            kbtn.style.borderColor = isKept ? 'rgba(134,239,172,0.55)' : 'rgba(255,255,255,0.35)';
        }
    }

    const IV_GROK_DELETE_ALL_BTN_ID = 'iv-grok-delete-all-media';
    const IV_GROK_DELETE_SELECTED_BTN_ID = 'iv-grok-delete-selected-media';
    const IV_GROK_DELETE_EXCEPT_BTN_ID = 'iv-grok-delete-except-first-and-selected';
    const IV_GROK_POST_KEEP_BTN_ID = 'iv-grok-imagine-post-keep';
    const IV_GROK_UI_DELETE_ALL = 'Delete all';
    const IV_GROK_UI_DELETE_CHOSEN = 'Delete chosen';
    /** Shorter than “delete all except chosen”: keeps first (page order) + current strip selection. */
    const IV_GROK_UI_DELETE_OTHERS = 'Delete others';
    const IV_GROK_UI_CONFIRM = 'Confirm';
    /** First tap arms the delete button; second tap runs delete. Auto-cancels after this many ms. */
    const IV_GROK_DELETE_ARM_MS = 10000;
    /** true: DevTools Console logs a full scan when you click the trash (cancel confirm is OK). Set false after debugging. */
    const IV_GROK_DELETE_MEDIA_DEBUG = false;
    /** true: logs layout when it changes, pointer hits in the × control area, and each click / delete step. Grok’s own console errors (CSP, GTM, i18next, etc.) are unrelated. */
    const IV_GROK_DELETE_SELECTED_DEBUG = false;
    const GROK_ASSET_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

    /** UUID in /imagine/post/<uuid> — same id as grid thumbnails for that asset. */
    function imaginePostSlugMediaIdFromPath() {
        if (!isPostPage()) return null;
        const m = location.pathname.match(new RegExp('^/imagine/post/(' + GROK_ASSET_UUID + ')(?:/|$)', 'i'));
        return m ? m[1].toLowerCase() : null;
    }

    function ivLogGrokSelectedDebug(message, detail) {
        if (!IV_GROK_DELETE_SELECTED_DEBUG) return;
        if (detail !== undefined) {
            console.log('[Image Viewer] Grok selected-delete: ' + message, detail);
        } else {
            console.log('[Image Viewer] Grok selected-delete: ' + message);
        }
    }

    let ivGrokSelectedPointerDebugLast = 0;
    document.addEventListener(
        'pointerdown',
        (e) => {
            if (!IV_GROK_DELETE_SELECTED_DEBUG || !isGrokHost() || !isPostPage()) return;
            const btn = document.getElementById(IV_GROK_DELETE_SELECTED_BTN_ID);
            if (!btn) return;
            const r = btn.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
            const now = Date.now();
            if (now - ivGrokSelectedPointerDebugLast < 1500) return;
            ivGrokSelectedPointerDebugLast = now;
            let top = null;
            let depth = 0;
            try {
                top = document.elementFromPoint(e.clientX, e.clientY);
                depth = document.elementsFromPoint(e.clientX, e.clientY).length;
            } catch (e5) {}
            ivLogGrokSelectedDebug('pointerdown inside × bounds (see hitsOurButton)', {
                disabled: btn.disabled,
                topTag: top ? top.tagName : null,
                topId: top && top.id,
                hitsOurButton: top === btn || !!(top && btn.contains(top)),
                elementsFromPointDepth: depth
            });
        },
        true
    );

    function getImaginePostRoot() {
        const hr = document.getElementById('imagine-post-page-content');
        if (hr) {
            const article = hr.closest('article');
            if (article) return article;
        }
        const strip = document.querySelector('[data-filmstrip-scroll="true"]');
        return strip ? strip.closest('article') : null;
    }

    function extractGrokStorageMediaIdFromUrl(url) {
        if (!url || typeof url !== 'string' || url.indexOf('blob:') === 0) return null;
        try {
            const path = new URL(url, location.href).pathname;
            let gen = path.match(new RegExp('/generated/(' + GROK_ASSET_UUID + ')(?:/|$)', 'i'));
            if (!gen) gen = path.match(new RegExp('/generated/(' + GROK_ASSET_UUID + ')\\.(?:m3u8|mp4|webm)$', 'i'));
            if (gen) return gen[1].toLowerCase();
            const uploaded = path.match(new RegExp('/users/(' + GROK_ASSET_UUID + ')/(' + GROK_ASSET_UUID + ')/content', 'i'));
            if (uploaded) return uploaded[2].toLowerCase();
            // Imagine post filmstrip: thumbs/videos often use imagine-public.x.ai (not only share-images/).
            const shareVidThumb = path.match(new RegExp('/imagine-public/share-videos/(' + GROK_ASSET_UUID + ')_thumbnail\\.', 'i'));
            if (shareVidThumb) return shareVidThumb[1].toLowerCase();
            const shareVidFile = path.match(new RegExp('/imagine-public/share-videos/(' + GROK_ASSET_UUID + ')\\.(?:mp4|webm|mov|m4v)$', 'i'));
            if (shareVidFile) return shareVidFile[1].toLowerCase();
            const shareImg = path.match(new RegExp('/imagine-public/share-images/(' + GROK_ASSET_UUID + ')\\.', 'i'));
            if (shareImg) return shareImg[1].toLowerCase();
            const imagineImg = path.match(new RegExp('/imagine-public/images/(' + GROK_ASSET_UUID + ')\\.', 'i'));
            if (imagineImg) return imagineImg[1].toLowerCase();
            return null;
        } catch (e) {
            return null;
        }
    }

    function imaginePostIdFromImgElement(img) {
        if (!img) return null;
        const src = img.getAttribute('src');
        if (src) {
            const a = extractGrokStorageMediaIdFromUrl(src);
            if (a) return a;
        }
        const ss = img.getAttribute('srcset');
        if (ss) {
            const first = ss.split(',')[0].trim().split(/\s+/)[0];
            if (first) {
                const b = extractGrokStorageMediaIdFromUrl(first);
                if (b) return b;
            }
        }
        return null;
    }

    function imaginePostIdFromVideoElement(video) {
        if (!video) return null;
        const tryUrl = (u) => (u && typeof u === 'string' ? extractGrokStorageMediaIdFromUrl(u) : null);
        let id = tryUrl(video.getAttribute('poster')) || tryUrl(video.getAttribute('src'));
        if (id) return id;
        if (video.attributes) {
            for (let i = 0; i < video.attributes.length; i++) {
                const v = video.attributes[i].value;
                if (v && (v.indexOf('https://') !== -1 || v.indexOf('http://') !== -1)) {
                    id = tryUrl(v);
                    if (id) return id;
                }
            }
        }
        const sources = video.querySelectorAll('source[src]');
        for (let j = 0; j < sources.length; j++) {
            id = tryUrl(sources[j].getAttribute('src'));
            if (id) return id;
        }
        try {
            const cs = video.currentSrc;
            if (cs && cs.indexOf('blob:') !== 0) {
                id = tryUrl(cs);
                if (id) return id;
            }
        } catch (e) {}
        return null;
    }

    /** Media id for the filmstrip / hero slide the UI shows as selected. */
    function getImaginePostSelectedMediaId(root) {
        if (!root) return null;
        const selectedBtn = root.querySelector('button[data-filmstrip-item="true"][tabindex="0"]');
        if (selectedBtn) {
            const id = imaginePostIdFromImgElement(selectedBtn.querySelector('img'));
            if (id) return id;
        }
        const ringBtn = root.querySelector('button[data-filmstrip-item="true"][class*="ring-white"]');
        if (ringBtn) {
            const id = imaginePostIdFromImgElement(ringBtn.querySelector('img'));
            if (id) return id;
        }
        const mainGrid = root.querySelector('div.group.rounded-2xl div.grid');
        if (mainGrid) {
            const heroImg = mainGrid.querySelector('img.col-start-1.row-start-1') || mainGrid.querySelector('img[src]');
            const fromImg = imaginePostIdFromImgElement(heroImg);
            if (fromImg) return fromImg;
            const vid = mainGrid.querySelector('video');
            const fromVid = imaginePostIdFromVideoElement(vid);
            if (fromVid) return fromVid;
        }
        return null;
    }

    function hideImaginePostDomForDeletedMediaId(root, mediaId) {
        if (!root || !mediaId) return;
        const norm = String(mediaId).toLowerCase();
        const hideEl = (el) => {
            if (el && el.style) el.style.display = 'none';
        };
        root.querySelectorAll('button[data-filmstrip-item="true"]').forEach((btn) => {
            const id = imaginePostIdFromImgElement(btn.querySelector('img'));
            if (id === norm) {
                const wrap = btn.closest('.snap-center') || btn.closest('[class*="snap-center"]');
                hideEl(wrap || btn);
            }
        });
    }

    function collectImaginePostMediaIdsInDomOrder(root, debugRecords) {
        const ordered = [];
        const seen = new Set();
        if (!root || root.nodeType !== 1) return ordered;
        function consider(url, note) {
            if (!url || typeof url !== 'string') return;
            const id = extractGrokStorageMediaIdFromUrl(url);
            if (debugRecords) {
                let pathname = '';
                try {
                    pathname = new URL(url, location.href).pathname;
                } catch (e2) {
                    pathname = '(invalid URL)';
                }
                debugRecords.push({
                    note: note || '?',
                    url: url.length > 500 ? url.slice(0, 500) + '\u2026' : url,
                    pathname: pathname,
                    extractedId: id || null,
                    duplicateId: !!(id && seen.has(id)),
                    parserMissed: !id
                });
            }
            if (!id || seen.has(id)) return;
            seen.add(id);
            ordered.push(id);
        }
        function considerSrcsetForCollect(srcset, notePrefix) {
            if (!srcset) return;
            srcset.split(',').forEach((part, i) => {
                const url = part.trim().split(/\s+/)[0];
                consider(url, notePrefix + '[' + i + ']');
            });
        }
        function visitMediaNode(el) {
            const tag = el.tagName;
            if (tag === 'IMG') {
                consider(el.getAttribute('src'), 'img.src');
                considerSrcsetForCollect(el.getAttribute('srcset'), 'img.srcset');
                return;
            }
            if (tag === 'SOURCE') {
                consider(el.getAttribute('src'), 'source.src');
                return;
            }
            if (tag === 'VIDEO') {
                consider(el.getAttribute('src'), 'video.src');
                consider(el.getAttribute('poster'), 'video.poster');
                if (el.attributes) {
                    for (let i = 0; i < el.attributes.length; i++) {
                        const a = el.attributes[i];
                        const v = a.value;
                        if (v && (v.indexOf('https://') !== -1 || v.indexOf('http://') !== -1)) {
                            consider(v, 'video.attr:' + a.name);
                        }
                    }
                }
                el.querySelectorAll('source').forEach((s, j) => consider(s.getAttribute('src'), 'video>source[' + j + ']'));
                try {
                    const cs = el.currentSrc;
                    if (cs && cs.indexOf('blob:') !== 0) consider(cs, 'video.currentSrc');
                } catch (e) {}
            }
        }
        function walk(node) {
            if (!node) return;
            if (node.nodeType === 1) {
                const el = node;
                const tag = el.tagName;
                if (tag === 'IMG' || tag === 'VIDEO' || tag === 'SOURCE') visitMediaNode(el);
                for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
                if (el.shadowRoot) walk(el.shadowRoot);
            }
        }
        walk(root);
        return ordered;
    }

    /** DOM-first id is deleted last (post anchor), rest first — order may matter for Grok. */
    function imaginePostMediaIdsForDelete(allIds) {
        if (allIds.length <= 1) return allIds.slice();
        return allIds.slice(1).concat(allIds[0]);
    }

    function deleteGrokMediaPostOne(id) {
        return fetch('https://grok.com/rest/media/post/delete', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/json',
                'accept': '*/*',
                'x-xai-request-id': typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
            },
            body: JSON.stringify({ id })
        }).then((res) => ({ ok: res.ok, status: res.status }));
    }

    function teardownGrokDeleteSelectedButton(sbtn) {
        if (!sbtn || typeof sbtn._ivGrokTeardown !== 'function') return;
        try {
            sbtn._ivGrokTeardown();
        } catch (e) {}
        sbtn._ivGrokTeardown = null;
    }

    /** Fixed position just left of filmstrip (body host avoids overflow clipping / no hit targets). */
    function mountGrokDeleteSelectedButton(root, sbtn) {
        if (!root || !sbtn) return;
        if (sbtn.parentElement !== document.body || document.body.lastElementChild !== sbtn) {
            document.body.appendChild(sbtn);
        }
        const strip = root.querySelector('[data-filmstrip-scroll="true"]');
        const gap = 10;
        const br0 = sbtn.getBoundingClientRect();
        const btnW = Math.max(40, Math.ceil(br0.width) || sbtn.offsetWidth || 120);
        const btnH = Math.max(36, Math.ceil(br0.height) || sbtn.offsetHeight || 36);
        if (strip) {
            const r = strip.getBoundingClientRect();
            const left = Math.max(8, Math.round(r.left - btnW - gap));
            const top = Math.round(r.top + r.height / 2 - btnH / 2);
            Object.assign(sbtn.style, {
                position: 'fixed',
                left: left + 'px',
                top: top + 'px',
                right: 'auto',
                bottom: 'auto',
                transform: 'none',
                zIndex: '2147483647',
                pointerEvents: 'auto'
            });
            if (IV_GROK_DELETE_SELECTED_DEBUG) {
                const snap = ['strip', Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), left, top].join(',');
                if (snap !== sbtn._ivGrokMountDebugSnap) {
                    sbtn._ivGrokMountDebugSnap = snap;
                    const br = sbtn.getBoundingClientRect();
                    const cx = Math.round(br.left + br.width / 2);
                    const cy = Math.round(br.top + br.height / 2);
                    let hit = null;
                    try {
                        hit = document.elementFromPoint(cx, cy);
                    } catch (e4) {}
                    ivLogGrokSelectedDebug('mount (strip path)', {
                        stripRect: { left: r.left, top: r.top, width: r.width, height: r.height },
                        buttonCss: { left: sbtn.style.left, top: sbtn.style.top },
                        buttonRect: { left: br.left, top: br.top, width: br.width, height: br.height },
                        center: { cx: cx, cy: cy },
                        elementFromPoint: hit
                            ? { tag: hit.tagName, id: hit.id, class: (hit.className && String(hit.className).slice(0, 120)) || '' }
                            : null,
                        hitIsOurButton: hit === sbtn,
                        disabled: sbtn.disabled,
                        pointerEvents: getComputedStyle(sbtn).pointerEvents
                    });
                }
            }
            if (!sbtn._ivGrokLayoutBound) {
                sbtn._ivGrokLayoutBound = true;
                const onLayout = () => {
                    if (sbtn._ivGrokLayoutRaf != null) cancelAnimationFrame(sbtn._ivGrokLayoutRaf);
                    sbtn._ivGrokLayoutRaf = requestAnimationFrame(() => {
                        sbtn._ivGrokLayoutRaf = null;
                        const art = getImaginePostRoot();
                        const sb = document.getElementById(IV_GROK_DELETE_SELECTED_BTN_ID);
                        if (art && sb) mountGrokDeleteSelectedButton(art, sb);
                    });
                };
                window.addEventListener('resize', onLayout);
                window.addEventListener('scroll', onLayout, true);
                sbtn._ivGrokTeardown = () => {
                    window.removeEventListener('resize', onLayout);
                    window.removeEventListener('scroll', onLayout, true);
                    if (sbtn._ivGrokLayoutRaf != null) cancelAnimationFrame(sbtn._ivGrokLayoutRaf);
                    sbtn._ivGrokLayoutRaf = null;
                    delete sbtn._ivGrokLayoutBound;
                };
            }
        } else {
            Object.assign(sbtn.style, {
                position: 'fixed',
                bottom: '144px',
                right: '16px',
                top: 'auto',
                left: 'auto',
                transform: 'none',
                zIndex: '2147483647',
                pointerEvents: 'auto'
            });
            if (IV_GROK_DELETE_SELECTED_DEBUG && sbtn._ivGrokMountDebugSnap !== 'fallback') {
                sbtn._ivGrokMountDebugSnap = 'fallback';
                ivLogGrokSelectedDebug('mount (fallback corner — no filmstrip node)', { path: location.pathname });
            }
        }
    }

    let imagineDeleteBtnSyncScheduled = false;
    function scheduleImaginePostDeleteButtonsSync() {
        if (!isGrokHost() || imagineDeleteBtnSyncScheduled) return;
        imagineDeleteBtnSyncScheduled = true;
        requestAnimationFrame(() => {
            imagineDeleteBtnSyncScheduled = false;
            syncImaginePostDeleteButtons();
        });
    }

    function syncImaginePostDeleteButtons() {
        const allExisting = document.getElementById(IV_GROK_DELETE_ALL_BTN_ID);
        const selExisting = document.getElementById(IV_GROK_DELETE_SELECTED_BTN_ID);
        const exceptExisting = document.getElementById(IV_GROK_DELETE_EXCEPT_BTN_ID);
        const keepExisting = document.getElementById(IV_GROK_POST_KEEP_BTN_ID);
        if (!isGrokHost() || !isPostPage()) {
            if (allExisting) allExisting.remove();
            teardownGrokDeleteSelectedButton(selExisting);
            if (selExisting) selExisting.remove();
            if (exceptExisting) exceptExisting.remove();
            if (keepExisting) keepExisting.remove();
            return;
        }

        const postSlugId = imaginePostSlugMediaIdFromPath();
        let keepBtn = keepExisting;
        if (!postSlugId) {
            if (keepBtn) keepBtn.remove();
        } else {
            if (!keepBtn) {
                keepBtn = document.createElement('button');
                keepBtn.id = IV_GROK_POST_KEEP_BTN_ID;
                keepBtn.type = 'button';
                Object.assign(keepBtn.style, {
                    position: 'fixed',
                    bottom: '148px',
                    right: '16px',
                    zIndex: '2147483640',
                    fontSize: '12px',
                    fontWeight: '600',
                    padding: '6px 12px',
                    borderRadius: '9999px',
                    border: '1px solid rgba(255,255,255,0.35)',
                    color: '#fff',
                    cursor: 'pointer',
                    lineHeight: '1.2',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.35)'
                });
                keepBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = imaginePostSlugMediaIdFromPath();
                    if (!id) return;
                    const set = grokSavedLoadKeptSet();
                    if (set.has(id)) {
                        set.delete(id);
                    } else {
                        set.add(id);
                    }
                    grokSavedStoreKeptSet(set);
                    scheduleImaginePostDeleteButtonsSync();
                    scheduleGrokImagineSavedKeepSync();
                });
            }
            const kset = grokSavedLoadKeptSet();
            const postKept = kset.has(postSlugId);
            keepBtn.textContent = postKept ? 'Unkeep' : 'Keep';
            keepBtn.title = postKept
                ? 'Remove this post from your local kept list (same list as Imagine → Saved grid).'
                : 'Keep this post in this browser; id matches the URL slug and saved-grid tiles.';
            keepBtn.style.background = postKept ? 'rgba(22,101,52,0.9)' : 'rgba(24,24,27,0.92)';
            keepBtn.style.borderColor = postKept ? 'rgba(134,239,172,0.55)' : 'rgba(255,255,255,0.35)';
            if (!keepBtn.parentElement) document.body.appendChild(keepBtn);
        }

        const article = getImaginePostRoot();
        if (!article) {
            if (allExisting) allExisting.remove();
            teardownGrokDeleteSelectedButton(selExisting);
            if (selExisting) selExisting.remove();
            if (exceptExisting) exceptExisting.remove();
            return;
        }
        let btn = allExisting;
        if (!btn) {
            btn = document.createElement('button');
            btn.id = IV_GROK_DELETE_ALL_BTN_ID;
            btn.type = 'button';
            const grokDeleteIdleTitle =
                IV_GROK_UI_DELETE_ALL +
                ': remove every media item in this post from Grok storage. Tap twice (second tap shows Confirm). Cannot be undone.';
            btn.title = grokDeleteIdleTitle;
            btn.textContent = IV_GROK_UI_DELETE_ALL;
            Object.assign(btn.style, {
                position: 'fixed',
                bottom: '96px',
                right: '16px',
                zIndex: '2147483640',
                width: 'auto',
                maxWidth: 'min(220px, calc(100vw - 32px))',
                minHeight: '36px',
                padding: '8px 14px',
                borderRadius: '9999px',
                border: '1px solid rgba(248,113,113,0.55)',
                background: 'rgba(24,24,27,0.92)',
                color: '#f87171',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                lineHeight: '1.2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                whiteSpace: 'nowrap'
            });
            function grokDeleteAllDisarm() {
                clearTimeout(btn._ivGrokArmTid);
                btn._ivGrokArmTid = null;
                delete btn.dataset.ivGrokArmed;
                btn.textContent = IV_GROK_UI_DELETE_ALL;
                btn.title = grokDeleteIdleTitle;
                btn.style.background = 'rgba(24,24,27,0.92)';
                btn.style.borderColor = 'rgba(248,113,113,0.55)';
                btn.style.color = '#f87171';
            }
            function grokDeleteAllArm(itemCount) {
                btn.dataset.ivGrokArmed = '1';
                btn.textContent = IV_GROK_UI_CONFIRM;
                btn.title =
                    'Click again to delete all ' +
                    itemCount +
                    ' media item(s) now. First item (page order) is removed last. Wait ' +
                    Math.round(IV_GROK_DELETE_ARM_MS / 1000) +
                    's to cancel.';
                btn.style.background = 'rgba(127,29,29,0.96)';
                btn.style.borderColor = 'rgba(252,165,165,0.95)';
                btn.style.color = '#fecaca';
                clearTimeout(btn._ivGrokArmTid);
                btn._ivGrokArmTid = setTimeout(grokDeleteAllDisarm, IV_GROK_DELETE_ARM_MS);
            }
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const root = getImaginePostRoot();
                if (!root) return;
                const debugRecords = IV_GROK_DELETE_MEDIA_DEBUG ? [] : null;
                const allIds = collectImaginePostMediaIdsInDomOrder(root, debugRecords);
                if (IV_GROK_DELETE_MEDIA_DEBUG) {
                    let filmstripButtons = 0;
                    try {
                        filmstripButtons = root.querySelectorAll('button[data-filmstrip-item="true"]').length;
                    } catch (e3) {}
                    console.log('[Image Viewer] Grok delete-all media scan', {
                        path: location.pathname,
                        filmstripButtonCount: filmstripButtons,
                        imgWithSrcInPost: root.querySelectorAll('img[src]').length,
                        videoInPost: root.querySelectorAll('video').length,
                        uniqueExtractedIds: allIds.slice(),
                        records: debugRecords || [],
                        hint: 'If filmstripButtonCount > uniqueExtractedIds.length, two slides may share one id, or a URL shape is not parsed (parserMissed).'
                    });
                }
                if (!allIds.length) {
                    alert('Image Viewer: No media IDs found in this post.');
                    grokDeleteAllDisarm();
                    return;
                }
                if (btn.dataset.ivGrokArmed !== '1') {
                    grokDeleteAllArm(allIds.length);
                    return;
                }
                grokDeleteAllDisarm();
                const ids = imaginePostMediaIdsForDelete(allIds);
                btn.disabled = true;
                const failures = [];
                const deletedOk = [];
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i];
                    btn.textContent = String(i + 1) + '/' + ids.length;
                    try {
                        const r = await deleteGrokMediaPostOne(id);
                        if (!r.ok) failures.push(id + ' (HTTP ' + r.status + ')');
                        else deletedOk.push(id);
                    } catch (err) {
                        failures.push(id + ' (network error)');
                    }
                }
                if (deletedOk.length) {
                    grokRecentlyDeletedAddIds(deletedOk);
                    scheduleGrokImagineSavedKeepSync();
                }
                btn.disabled = false;
                grokDeleteAllDisarm();
                if (failures.length) {
                    const head = failures.slice(0, 12).join('\n');
                    alert('Image Viewer: Some deletes failed:\n' + head + (failures.length > 12 ? '\n…' : ''));
                } else {
                    history.back();
                }
            });
        }
        if (!btn.parentElement) document.body.appendChild(btn);

        let exBtn = exceptExisting;
        if (!exBtn) {
            exBtn = document.createElement('button');
            exBtn.id = IV_GROK_DELETE_EXCEPT_BTN_ID;
            exBtn.type = 'button';
            const exceptIdleTitle =
                IV_GROK_UI_DELETE_OTHERS +
                ': delete all media in this post except the first (page order) and the strip item you have selected. Tap twice (second tap shows Confirm). Cannot be undone.';
            exBtn.title = exceptIdleTitle;
            exBtn.textContent = IV_GROK_UI_DELETE_OTHERS;
            Object.assign(exBtn.style, {
                position: 'fixed',
                bottom: '44px',
                right: '16px',
                zIndex: '2147483640',
                width: 'auto',
                maxWidth: 'min(220px, calc(100vw - 32px))',
                minHeight: '36px',
                padding: '8px 14px',
                borderRadius: '9999px',
                border: '1px solid rgba(167,139,250,0.75)',
                background: 'rgba(24,24,27,0.92)',
                color: '#c4b5fd',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                lineHeight: '1.2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                whiteSpace: 'nowrap'
            });
            function grokDeleteExceptDisarm() {
                clearTimeout(exBtn._ivGrokExceptArmTid);
                exBtn._ivGrokExceptArmTid = null;
                delete exBtn.dataset.ivGrokArmed;
                delete exBtn._ivGrokExceptPendingIds;
                exBtn.textContent = IV_GROK_UI_DELETE_OTHERS;
                exBtn.title = exceptIdleTitle;
                exBtn.style.background = 'rgba(24,24,27,0.92)';
                exBtn.style.borderColor = 'rgba(167,139,250,0.75)';
                exBtn.style.color = '#c4b5fd';
            }
            function grokDeleteExceptArm(deleteCount) {
                exBtn.dataset.ivGrokArmed = '1';
                exBtn.textContent = IV_GROK_UI_CONFIRM;
                exBtn.title =
                    'Click again to delete ' +
                    deleteCount +
                    ' media item(s) now (first + chosen stay). Wait ' +
                    Math.round(IV_GROK_DELETE_ARM_MS / 1000) +
                    's to cancel.';
                exBtn.style.background = 'rgba(76,29,149,0.96)';
                exBtn.style.borderColor = 'rgba(196,181,253,0.95)';
                exBtn.style.color = '#ede9fe';
                clearTimeout(exBtn._ivGrokExceptArmTid);
                exBtn._ivGrokExceptArmTid = setTimeout(grokDeleteExceptDisarm, IV_GROK_DELETE_ARM_MS);
            }
            exBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const root = getImaginePostRoot();
                if (!root) return;
                if (exBtn.dataset.ivGrokArmed === '1') {
                    const pending = exBtn._ivGrokExceptPendingIds ? exBtn._ivGrokExceptPendingIds.slice() : null;
                    grokDeleteExceptDisarm();
                    if (!pending || !pending.length) {
                        alert('Image Viewer: Armed trim lost its list; try again.');
                        return;
                    }
                    exBtn.disabled = true;
                    const failures = [];
                    const deletedOk = [];
                    for (let i = 0; i < pending.length; i++) {
                        const id = pending[i];
                        exBtn.textContent = String(i + 1) + '/' + pending.length;
                        try {
                            const r = await deleteGrokMediaPostOne(id);
                            if (!r.ok) failures.push(id + ' (HTTP ' + r.status + ')');
                            else deletedOk.push(id);
                        } catch (err) {
                            failures.push(id + ' (network error)');
                        }
                    }
                    if (deletedOk.length) {
                        grokRecentlyDeletedAddIds(deletedOk);
                        scheduleGrokImagineSavedKeepSync();
                        for (let k = 0; k < deletedOk.length; k++) {
                            hideImaginePostDomForDeletedMediaId(root, deletedOk[k]);
                        }
                    }
                    exBtn.disabled = false;
                    grokDeleteExceptDisarm();
                    if (failures.length) {
                        const head = failures.slice(0, 12).join('\n');
                        alert('Image Viewer: Some deletes failed:\n' + head + (failures.length > 12 ? '\n…' : ''));
                    }
                    return;
                }
                const debugRecords = IV_GROK_DELETE_MEDIA_DEBUG ? [] : null;
                const allIds = collectImaginePostMediaIdsInDomOrder(root, debugRecords);
                if (!allIds.length) {
                    alert('Image Viewer: No media IDs found in this post.');
                    grokDeleteExceptDisarm();
                    return;
                }
                const firstId = allIds[0];
                const selId = getImaginePostSelectedMediaId(root);
                if (!selId) {
                    alert('Image Viewer: Could not detect a media id for the selected item (filmstrip / main preview).');
                    grokDeleteExceptDisarm();
                    return;
                }
                const keep = new Set([firstId, selId]);
                const toDeleteOrdered = allIds.filter((id) => !keep.has(id));
                if (!toDeleteOrdered.length) {
                    alert('Image Viewer: Nothing to delete; only the first item and current selection would remain.');
                    grokDeleteExceptDisarm();
                    return;
                }
                exBtn._ivGrokExceptPendingIds = imaginePostMediaIdsForDelete(toDeleteOrdered);
                grokDeleteExceptArm(exBtn._ivGrokExceptPendingIds.length);
            });
        }
        if (!exBtn.parentElement) document.body.appendChild(exBtn);

        let sbtn = selExisting;
        if (!sbtn) {
            sbtn = document.createElement('button');
            sbtn.id = IV_GROK_DELETE_SELECTED_BTN_ID;
            sbtn.type = 'button';
            const selIdleTitle =
                IV_GROK_UI_DELETE_CHOSEN +
                ': remove only the strip / preview item that is selected now. Tap twice (second tap shows Confirm). Cannot be undone.';
            sbtn.title = selIdleTitle;
            sbtn.textContent = IV_GROK_UI_DELETE_CHOSEN;
            Object.assign(sbtn.style, {
                width: 'auto',
                maxWidth: 'min(220px, calc(100vw - 32px))',
                minHeight: '36px',
                padding: '8px 14px',
                borderRadius: '9999px',
                border: '1px solid rgba(251,191,36,0.7)',
                background: 'rgba(24,24,27,0.92)',
                color: '#fbbf24',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                lineHeight: '1.2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                whiteSpace: 'nowrap'
            });
            function grokDeleteSelectedDisarm() {
                clearTimeout(sbtn._ivGrokSelArmTid);
                sbtn._ivGrokSelArmTid = null;
                delete sbtn.dataset.ivGrokSelArmed;
                delete sbtn.dataset.ivGrokPendingDeleteId;
                sbtn.textContent = IV_GROK_UI_DELETE_CHOSEN;
                sbtn.title = selIdleTitle;
                sbtn.style.background = 'rgba(24,24,27,0.92)';
                sbtn.style.borderColor = 'rgba(251,191,36,0.7)';
                sbtn.style.color = '#fbbf24';
            }
            function grokDeleteSelectedArm() {
                sbtn.dataset.ivGrokSelArmed = '1';
                sbtn.textContent = IV_GROK_UI_CONFIRM;
                sbtn.title =
                    'Click again to delete the chosen media item now. Wait ' +
                    Math.round(IV_GROK_DELETE_ARM_MS / 1000) +
                    's to cancel.';
                sbtn.style.background = 'rgba(120,53,15,0.96)';
                sbtn.style.borderColor = 'rgba(253,224,71,0.95)';
                sbtn.style.color = '#fef9c3';
                clearTimeout(sbtn._ivGrokSelArmTid);
                sbtn._ivGrokSelArmTid = setTimeout(grokDeleteSelectedDisarm, IV_GROK_DELETE_ARM_MS);
            }
            sbtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                ivLogGrokSelectedDebug('click', {
                    disabled: sbtn.disabled,
                    armed: sbtn.dataset.ivGrokSelArmed === '1',
                    pendingId: sbtn.dataset.ivGrokPendingDeleteId || null,
                    targetTag: e.target && e.target.tagName
                });
                const root = getImaginePostRoot();
                if (!root) {
                    ivLogGrokSelectedDebug('abort: no post root (getImaginePostRoot returned null)');
                    return;
                }
                if (sbtn.dataset.ivGrokSelArmed === '1') {
                    const idToDelete = sbtn.dataset.ivGrokPendingDeleteId;
                    grokDeleteSelectedDisarm();
                    if (!idToDelete) {
                        ivLogGrokSelectedDebug('armed branch: missing pending id');
                        alert('Image Viewer: Armed delete lost its id; try again.');
                        return;
                    }
                    ivLogGrokSelectedDebug('armed branch: deleting', { idToDelete: idToDelete });
                    sbtn.disabled = true;
                    sbtn.textContent = '\u2026';
                    let ok = false;
                    let status = 0;
                    try {
                        const r = await deleteGrokMediaPostOne(idToDelete);
                        ok = r.ok;
                        status = r.status;
                    } catch (err) {
                        ok = false;
                        ivLogGrokSelectedDebug('fetch threw', { message: err && err.message });
                    }
                    ivLogGrokSelectedDebug('delete request finished', { ok: ok, status: status });
                    sbtn.disabled = false;
                    grokDeleteSelectedDisarm();
                    if (!ok) {
                        alert('Image Viewer: Delete failed (HTTP ' + status + ').');
                    } else {
                        grokRecentlyDeletedAddIds([idToDelete]);
                        scheduleGrokImagineSavedKeepSync();
                        hideImaginePostDomForDeletedMediaId(root, idToDelete);
                    }
                    return;
                }
                const mediaId = getImaginePostSelectedMediaId(root);
                ivLogGrokSelectedDebug('first tap: resolved media id', { mediaId: mediaId || null });
                if (!mediaId) {
                    alert('Image Viewer: Could not detect a media id for the selected item (filmstrip / main preview).');
                    grokDeleteSelectedDisarm();
                    return;
                }
                sbtn.dataset.ivGrokPendingDeleteId = mediaId;
                grokDeleteSelectedArm();
            });
        }
        mountGrokDeleteSelectedButton(article, sbtn);
    }

    // Apply shared volume to a single video
    function applySharedVolume(video) {
        video.volume = sharedVolume;
        video.muted = false;
    }
    
    // Apply shared volume to all videos on the page
    function applySharedVolumeToAll() {
        document.querySelectorAll('video').forEach(applySharedVolume);
    }
    
    // Toggle fullscreen for video element
    function toggleVideoFullscreen(video) {
        const doc = document;
        const isFullscreen = doc.fullscreenElement || doc.webkitFullscreenElement || 
                           doc.mozFullScreenElement || doc.msFullscreenElement;
        
        if (isFullscreen) {
            // Exit fullscreen (pass video element for re-entry workaround)
            exitFullscreenWithWorkaround(video);
        } else {
            // Enter fullscreen
            const requestFn = video.requestFullscreen || video.webkitRequestFullscreen || 
                            video.mozRequestFullScreen || video.msRequestFullscreen;
            if (requestFn) requestFn.call(video);
        }
    }
    
    // Create fullscreen button for a video
    function createFullscreenButton(video) {
        // Check if button already exists
        if (video.dataset.hasFullscreenButton) return;
        video.dataset.hasFullscreenButton = 'true';
        
        const button = document.createElement('button');
        button.innerHTML = '⛶'; // Fullscreen icon
        button.title = 'Fullscreen (Alt+F)';
        Object.assign(button.style, {
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            width: '40px',
            height: '40px',
            backgroundColor: 'rgba(0,0,0,0.6)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '20px',
            cursor: 'pointer',
            zIndex: 2147483647,
            opacity: '0',
            transition: 'opacity 0.2s, background-color 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });
        
        // Show button on video hover
        const videoContainer = video.parentElement;
        if (!videoContainer.style.position || videoContainer.style.position === 'static') {
            videoContainer.style.position = 'relative';
        }
        
        const showButton = () => button.style.opacity = '1';
        const hideButton = () => button.style.opacity = '0';
        
        videoContainer.addEventListener('mouseenter', showButton);
        videoContainer.addEventListener('mouseleave', hideButton);
        
        // Button hover effect
        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = 'rgba(0,0,0,0.8)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'rgba(0,0,0,0.6)';
        });
        
        // Click handler
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            // Use the same logic as Alt+F - find first video
            const firstVideo = document.querySelector('video');
            if (firstVideo) {
                toggleVideoFullscreen(firstVideo);
            }
        });
        
        videoContainer.appendChild(button);
    }
    
    // Add fullscreen buttons to all videos on the page
    function addFullscreenButtonsToVideos() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => createFullscreenButton(video));
    }
    
    // Clear loop when the looped video's source changes (SPA navigation reuses same element)
    let loopVideoSrc = null;
    document.addEventListener('loadstart', (e) => {
        if (e.target.tagName === 'VIDEO' && loopVideo && e.target === loopVideo) {
            const newSrc = e.target.src || e.target.currentSrc;
            if (loopVideoSrc && newSrc !== loopVideoSrc) clearLoop();
        }
    }, true);
    
    // Watch for new videos being added to the page
    const videoObserver = new MutationObserver((mutations) => {
        addFullscreenButtonsToVideos();
        scheduleImaginePostDeleteButtonsSync();
        scheduleGrokImagineSavedKeepSync();
        // Apply shared volume to any newly added videos (only on post pages)
        if (isPostPage()) {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.tagName === 'VIDEO') {
                        applySharedVolume(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('video').forEach(applySharedVolume);
                    }
                }
            }
        }
    });
    
    // Start observing when DOM is ready
    if (document.body) {
        addFullscreenButtonsToVideos();
        scheduleImaginePostDeleteButtonsSync();
        scheduleGrokImagineSavedKeepSync();
        if (isPostPage()) applySharedVolumeToAll();
        videoObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            addFullscreenButtonsToVideos();
            scheduleImaginePostDeleteButtonsSync();
            scheduleGrokImagineSavedKeepSync();
            if (isPostPage()) applySharedVolumeToAll();
            videoObserver.observe(document.body, { childList: true, subtree: true });
        });
    }

    window.addEventListener('popstate', () => {
        scheduleImaginePostDeleteButtonsSync();
        scheduleGrokImagineSavedKeepSync();
    });
    
    // Track which video is in fullscreen for workaround
    let lastFullscreenVideo = null;
    
    // Apply styles to videos when entering fullscreen
    ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => {
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement ||
                                 document.mozFullScreenElement || document.msFullscreenElement;
        
        if (fullscreenElement && fullscreenElement.tagName === 'VIDEO') {
            // Just entered fullscreen with a video - apply styles
            const video = fullscreenElement;
            lastFullscreenVideo = video; // Track for workaround
            
            // Clear loop if switching to a different video
            if (loopVideo && loopVideo !== video) clearLoop();
            
            // Add keydown listener directly to video element (in case events don't bubble)
            video.addEventListener('keydown', handleVideoKeydown, true);
            
            // Hide native controls in fullscreen, but show when cursor is near bottom
            video._originalControls = video.controls;
            video.controls = false;
            if (!document.getElementById('iv-hide-controls')) {
                const style = document.createElement('style');
                style.id = 'iv-hide-controls';
                style.textContent = `
                    video::-webkit-media-controls { display: none !important; opacity: 0 !important; }
                    video::-webkit-media-controls-enclosure { display: none !important; }
                    video::-webkit-media-controls-panel { display: none !important; }
                `;
                document.head.appendChild(style);
            }
            
            video._cursorHideTimer = null;
            video._onMouseMove = (e) => {
                const nearBottom = e.clientY > window.innerHeight * 0.85;
                const hideStyle = document.getElementById('iv-hide-controls');
                if (nearBottom) {
                    video.controls = true;
                    if (hideStyle) hideStyle.disabled = true;
                } else {
                    video.controls = false;
                    if (hideStyle) hideStyle.disabled = false;
                    video.blur();
                }
                
                document.body.style.cursor = '';
                clearTimeout(video._cursorHideTimer);
                video._cursorHideTimer = setTimeout(() => {
                    if (document.fullscreenElement === video) {
                        document.body.style.cursor = 'none';
                    }
                }, 2000);
            };
            document.addEventListener('mousemove', video._onMouseMove);
            
            // Store original styles if not already stored
            if (!video.dataset.originalStyle) {
                video.dataset.originalStyle = video.style.cssText;
                video.dataset.originalClass = video.className;
            }
            
            // Remove classes and apply fullscreen styles
            video.className = '';
            Object.assign(video.style, {
                visibility: 'visible',
                objectFit: 'contain',
                width: '100%',
                height: '100%',
                maxWidth: '100vw',
                maxHeight: '100vh',
                display: 'block',
                backgroundColor: 'black',
                outline: 'none'  // Remove focus outline
            });
        } else if (!fullscreenElement) {
            // Exited fullscreen - restore original styles and remove listeners
            const videos = document.querySelectorAll('video[data-original-style]');
            videos.forEach(video => {
                video.removeEventListener('keydown', handleVideoKeydown, true);
                video.controls = video._originalControls || false;
                delete video._originalControls;
                if (video._onMouseMove) {
                    document.removeEventListener('mousemove', video._onMouseMove);
                    clearTimeout(video._cursorHideTimer);
                    document.body.style.cursor = '';
                    delete video._onMouseMove;
                    delete video._cursorHideTimer;
                }
                const hideStyle = document.getElementById('iv-hide-controls');
                if (hideStyle) hideStyle.remove();
                video.style.cssText = video.dataset.originalStyle;
                if (video.dataset.originalClass) {
                    video.className = video.dataset.originalClass;
                }
                delete video.dataset.originalStyle;
                delete video.dataset.originalClass;
            });
            
            // Apply browser bug workaround for videos (same bug as with images)
            if (lastFullscreenVideo) {
                const videoForWorkaround = lastFullscreenVideo;
                setTimeout(() => {
                    const stillFs = document.fullscreenElement || document.webkitFullscreenElement;
                    const isVisuallyFs = window.innerHeight >= screen.height - 50;
                    
                    if (isVisuallyFs && !stillFs) {
                        const requestFn = videoForWorkaround.requestFullscreen || videoForWorkaround.webkitRequestFullscreen || 
                                         videoForWorkaround.mozRequestFullScreen || videoForWorkaround.msRequestFullscreen;
                        const exitFn = document.exitFullscreen || document.webkitExitFullscreen || 
                                      document.mozCancelFullScreen || document.msExitFullscreen;
                        if (requestFn && exitFn) {
                            requestFn.call(videoForWorkaround).then(() => exitFn.call(document)).catch(() => {});
                        }
                    }
                }, 100);
                lastFullscreenVideo = null;
            }
        }
    }));

    // Find the target video for keyboard controls
    // In fullscreen: use the fullscreen video element
    // Otherwise: use the first video on the page, but only if not typing in a text field
    function getTargetVideo(e) {
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement ||
                                 document.mozFullScreenElement || document.msFullscreenElement;
        
        if (fullscreenElement && fullscreenElement.tagName === 'VIDEO') {
            return fullscreenElement;
        }
        
        const isTyping = e.target.matches('input, textarea, [contenteditable="true"]') || 
                         e.target.closest('[contenteditable="true"]') ||
                         e.target.getAttribute('role') === 'textbox';
        if (!isTyping) {
            return document.querySelector('video');
        }
        
        return null;
    }

    // Loop region state
    let loopIn = null;
    let loopOut = null;
    let loopVideo = null;
    let loopRafId = null;
    let loopOriginalLoop = null;
    
    function loopRafCheck() {
        if (!loopVideo) return;
        const start = loopIn !== null ? loopIn : 0;
        const end = loopOut !== null ? loopOut : loopVideo.duration;
        if (loopVideo.currentTime >= end || loopVideo.currentTime < start) {
            loopVideo.currentTime = start;
            if (loopVideo.paused) {
                loopVideo.play().catch(() => {});
            }
        }
        loopRafId = requestAnimationFrame(loopRafCheck);
    }
    
    function stopLooping() {
        if (loopRafId !== null) {
            cancelAnimationFrame(loopRafId);
            loopRafId = null;
        }
        if (loopVideo && loopOriginalLoop !== null) {
            loopVideo.loop = loopOriginalLoop;
            loopOriginalLoop = null;
        }
    }
    
    function startLooping(video) {
        stopLooping();
        loopVideo = video;
        loopVideoSrc = video.src || video.currentSrc;
        loopOriginalLoop = video.loop;
        video.loop = false;
        loopRafId = requestAnimationFrame(loopRafCheck);
    }
    
    function clearLoop() {
        stopLooping();
        loopIn = null;
        loopOut = null;
        loopVideo = null;
        loopVideoSrc = null;
    }

    // Handler for video keyboard controls
    function handleVideoKeydown(e) {
        // F or / to toggle video fullscreen
        if (e.code === 'KeyF' || e.code === 'Slash') {
            const video = getTargetVideo(e);
            if (video) {
                e.preventDefault();
                e.stopImmediatePropagation();
                toggleVideoFullscreen(video);
            }
            return;
        }
        
        // Spacebar to pause/unpause video
        if (e.code === 'Space') {
            const video = getTargetVideo(e);
            if (video) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (video.paused) {
                    video.play().catch(err => console.error('Video play failed:', err));
                } else {
                    video.pause();
                }
            }
            return;
        }
        
        // I to set loop in-point
        if (e.code === 'KeyI') {
            const video = getTargetVideo(e);
            if (video) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (loopVideo !== video) clearLoop();
                loopIn = video.currentTime;
                if (loopOut !== null && loopIn >= loopOut) loopOut = null;
                startLooping(video);
            }
            return;
        }
        
        // O to set loop out-point
        if (e.code === 'KeyO') {
            const video = getTargetVideo(e);
            if (video) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (loopVideo !== video) clearLoop();
                loopOut = video.currentTime;
                if (loopIn !== null && loopOut <= loopIn) loopIn = null;
                startLooping(video);
                const start = loopIn !== null ? loopIn : 0;
                video.currentTime = start;
            }
            return;
        }
        
        // Backspace to clear loop
        if (e.code === 'Backspace') {
            if (loopIn !== null || loopOut !== null) {
                e.preventDefault();
                e.stopImmediatePropagation();
                clearLoop();
            }
            return;
        }
        
        // Left/Right arrows to seek (skip when image overlay is open)
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            if (!overlay) {
                const video = getTargetVideo(e);
                if (video) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const delta = e.code === 'ArrowLeft' ? -1 : 1;
                    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
                }
            }
            return;
        }
        
        // Up/Down arrows to change volume (synced across all videos only on post pages)
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            const video = getTargetVideo(e);
            if (video) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const vol = Math.round(video.volume * 100) / 100;
                const step = e.code === 'ArrowUp'
                    ? (vol < 10 / 100 ? 0.02 : 0.1)
                    : (vol <= 10 / 100 ? 0.02 : 0.1);
                const delta = e.code === 'ArrowUp' ? step : -step;
                sharedVolume = Math.round(Math.max(0, Math.min(1, vol + delta)) * 100) / 100;
                try { localStorage.setItem(STORAGE_KEY, String(sharedVolume)); } catch (e) {}
                if (isPostPage()) {
                    applySharedVolumeToAll();
                } else {
                    video.volume = sharedVolume;
                    video.muted = false;
                }
                showVolumeOverlay(sharedVolume);
            }
        }
    }
    
    // Listen on both window and document in capture phase
    window.addEventListener('keydown', handleVideoKeydown, true);
    document.addEventListener('keydown', handleVideoKeydown, true);
    } // End of init()
    
    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
