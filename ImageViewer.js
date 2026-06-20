// ==UserScript==
// @name         ImageViewer
// @namespace    http://example.com/
// @version      2.23
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
    /** false: fit to viewport; true: natural pixels + scroll. Remembered for this page session. */
    let overlayFitNative = false;
    let overlayScrollKeys = new Set();
    let overlayScrollDir = 0;
    let overlayScrollRaf = null;
    let overlayScrollLastTs = 0;
    const OVERLAY_SCROLL_PX_PER_SEC = 720;
    /** Native-mode scroll per gallery img src (restored when navigating back). */
    const overlayNativeScrollBySrc = new Map();

    function overlayNativeScrollKey(imgEl) {
        return imgEl?.src || '';
    }

    function saveOverlayNativeScrollForCurrent() {
        if (!overlay || !overlayFitNative || currentIndex < 0 || !imgs[currentIndex]) return;
        const key = overlayNativeScrollKey(imgs[currentIndex]);
        if (!key) return;
        overlayNativeScrollBySrc.set(key, {
            top: overlay.scrollTop,
            left: overlay.scrollLeft,
        });
    }

    function restoreOverlayNativeScrollForImgEl(imgEl) {
        if (!overlay || !overlayFitNative) return;
        const key = overlayNativeScrollKey(imgEl);
        const pos = overlayNativeScrollBySrc.get(key);
        const apply = () => {
            if (!overlay || !overlayFitNative || !imgs[currentIndex]) return;
            if (overlayNativeScrollKey(imgs[currentIndex]) !== key) return;
            overlay.scrollTop = pos ? pos.top : 0;
            overlay.scrollLeft = pos ? pos.left : 0;
        };
        requestAnimationFrame(() => requestAnimationFrame(apply));
    }

    function stopOverlayArrowScroll() {
        overlayScrollKeys.clear();
        overlayScrollDir = 0;
        overlayScrollLastTs = 0;
        if (overlayScrollRaf !== null) {
            cancelAnimationFrame(overlayScrollRaf);
            overlayScrollRaf = null;
        }
    }

    function syncOverlayScrollDir() {
        overlayScrollDir = overlayScrollKeys.has('ArrowDown')
            ? 1
            : overlayScrollKeys.has('ArrowUp')
              ? -1
              : 0;
    }

    function overlayScrollTick(ts) {
        if (!overlay || !overlayFitNative || overlayScrollDir === 0) {
            stopOverlayArrowScroll();
            return;
        }
        if (overlay.scrollHeight <= overlay.clientHeight + 1) {
            stopOverlayArrowScroll();
            return;
        }
        if (!overlayScrollLastTs) overlayScrollLastTs = ts;
        const dt = Math.min(0.05, (ts - overlayScrollLastTs) / 1000);
        overlayScrollLastTs = ts;
        const maxTop = overlay.scrollHeight - overlay.clientHeight;
        overlay.scrollTop = Math.max(
            0,
            Math.min(maxTop, overlay.scrollTop + overlayScrollDir * OVERLAY_SCROLL_PX_PER_SEC * dt),
        );
        overlayScrollRaf = requestAnimationFrame(overlayScrollTick);
    }

    function onOverlayArrowKeyDown(key) {
        overlayScrollKeys.add(key);
        syncOverlayScrollDir();
        if (overlayScrollDir && overlayScrollRaf === null) {
            overlayScrollLastTs = 0;
            overlayScrollRaf = requestAnimationFrame(overlayScrollTick);
        }
    }

    const IV_CURSOR_HIDE_MS = 2000;
    let ivCursorHideTimer = null;
    let ivCursorHideOnMove = null;
    let ivCursorHideIsActive = null;
    let ivCursorHideOnShow = null;
    let ivCursorHideOnHide = null;

    function stopCursorAutoHide() {
        if (ivCursorHideOnMove) {
            document.removeEventListener('mousemove', ivCursorHideOnMove);
            ivCursorHideOnMove = null;
        }
        clearTimeout(ivCursorHideTimer);
        ivCursorHideTimer = null;
        ivCursorHideIsActive = null;
        ivCursorHideOnShow = null;
        ivCursorHideOnHide = null;
        document.body.style.cursor = '';
    }

    function bumpCursorAutoHide() {
        if (!ivCursorHideIsActive) return;
        document.body.style.cursor = '';
        ivCursorHideOnShow?.();
        clearTimeout(ivCursorHideTimer);
        ivCursorHideTimer = setTimeout(() => {
            if (ivCursorHideIsActive && ivCursorHideIsActive()) {
                document.body.style.cursor = 'none';
                ivCursorHideOnHide?.();
            }
        }, IV_CURSOR_HIDE_MS);
    }

    /** @param {boolean} [attachMoveListener] false when caller registers mousemove (e.g. video controls) */
    function startCursorAutoHide(isActive, hooks, attachMoveListener = true) {
        stopCursorAutoHide();
        ivCursorHideIsActive = isActive;
        ivCursorHideOnShow = hooks?.onShow || null;
        ivCursorHideOnHide = hooks?.onHide || null;
        ivCursorHideOnHide?.();
        document.body.style.cursor = 'none';
        if (attachMoveListener) {
            ivCursorHideOnMove = () => bumpCursorAutoHide();
            document.addEventListener('mousemove', ivCursorHideOnMove);
        }
    }

    function overlayCursorWhenVisible() {
        return overlayFitNative ? 'default' : 'zoom-out';
    }

    /** true: DevTools console logs each step of copy-to-clipboard (C in image fullscreen). Set false normally. */
    const IV_FULLSCREEN_CLIPBOARD_DEBUG = false;

    function ivLogFullscreenClipboard(message, detail) {
        if (!IV_FULLSCREEN_CLIPBOARD_DEBUG) return;
        if (detail !== undefined) {
            console.log('[ImageViewer] clipboard', message, detail);
        } else {
            console.log('[ImageViewer] clipboard', message);
        }
    }

    function isGrokHost() {
        const h = location.hostname;
        return h === 'grok.com' || h.endsWith('.grok.com');
    }

    function isGeminiHost() {
        return location.hostname === 'gemini.google.com';
    }

    function viewerImageSrcForNewTab(img) {
        return img.currentSrc || img.getAttribute('src') || img.src || '';
    }

    function isViewerOpenInTabImageSrc(src) {
        if (!src) return false;
        return /^https?:/i.test(src) || src.startsWith('blob:');
    }

    function viewerImageFromEventTarget(target) {
        let el = target;
        if (!el || !el.nodeType) return null;
        if (el.nodeType !== 1) el = el.parentElement;
        if (!el) return null;
        if (el.tagName !== 'IMG') el = el.closest('img');
        if (!el || el.tagName !== 'IMG' || isExcludedImage(el)) return null;
        return isViewerOpenInTabImageSrc(viewerImageSrcForNewTab(el)) ? el : null;
    }

    let ivLastPointerX = -1;
    let ivLastPointerY = -1;

    function viewerImageFromPointer() {
        if (ivLastPointerX < 0 || ivLastPointerY < 0) return null;
        return viewerImageFromEventTarget(document.elementFromPoint(ivLastPointerX, ivLastPointerY));
    }

    const imageInlineTabBlobCache = new Map();
    const IMAGE_INLINE_TAB_BLOB_CACHE_MAX = 16;

    function viewerImgMatchesUrl(img, url) {
        return viewerImageSrcForNewTab(img) === url;
    }

    function cacheImageInlineTabBlobUrl(url, objectUrl) {
        const prev = imageInlineTabBlobCache.get(url);
        if (prev) URL.revokeObjectURL(prev);
        imageInlineTabBlobCache.set(url, objectUrl);
        while (imageInlineTabBlobCache.size > IMAGE_INLINE_TAB_BLOB_CACHE_MAX) {
            const oldest = imageInlineTabBlobCache.keys().next().value;
            URL.revokeObjectURL(imageInlineTabBlobCache.get(oldest));
            imageInlineTabBlobCache.delete(oldest);
        }
    }

    function openImageInlineLoadingTab() {
        const html =
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Image</title>' +
            '<style>html,body{margin:0;height:100%;background:#111;color:#888;' +
            'display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif}</style>' +
            '</head><body>Loading image…</body></html>';
        const data = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        return window.open(data, '_blank');
    }

    function navigateImageInlineTab(tab, href) {
        if (!tab || tab.closed) {
            window.open(href, '_blank');
            return;
        }
        try {
            tab.location.replace(href);
        } catch (e) {
            try {
                tab.location.href = href;
            } catch (e2) {
                window.open(href, '_blank');
                try {
                    tab.close();
                } catch (e3) {}
            }
        }
    }

    function assignImageInlineTabBlob(tab, url, blob) {
        let mime = (blob.type || '').toLowerCase();
        if (!/^image\//.test(mime)) mime = 'image/jpeg';
        const imageBlob = blob.type === mime ? blob : new Blob([blob], { type: mime });
        const objUrl = URL.createObjectURL(imageBlob);
        cacheImageInlineTabBlobUrl(url, objUrl);
        navigateImageInlineTab(tab, objUrl);
    }

    async function blobFromLoadedViewerImage(img) {
        try {
            if (img.decode && typeof img.decode === 'function') {
                await img.decode().catch(() => {});
            }
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (!w || !h || w < 64 || h < 64) return null;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0);
            return await new Promise((resolve) => {
                canvas.toBlob((b) => resolve(b && b.size ? b : null), 'image/jpeg', 0.92);
            });
        } catch (e) {
            return null;
        }
    }

    async function openImageInNewTabInline(img) {
        const url = viewerImageSrcForNewTab(img);
        if (!url) return;

        const cached = imageInlineTabBlobCache.get(url);
        if (cached) {
            window.open(cached, '_blank');
            return;
        }

        if (url.startsWith('blob:')) {
            window.open(url, '_blank');
            return;
        }

        const tab = openImageInlineLoadingTab();
        const blobReady = (b) => b && b.size > 0;

        try {
            let blob = null;
            if (img.complete && viewerImgMatchesUrl(img, url)) {
                const fromPage = blobFromLoadedViewerImage(img);
                const fromNetwork = fetch(url, { credentials: 'include' }).then((res) => {
                    if (!res.ok) throw new Error('fetch failed');
                    return res.blob();
                });
                blob = await Promise.race([
                    fromPage.then((b) => (blobReady(b) ? b : Promise.reject())),
                    fromNetwork.then((b) => (blobReady(b) ? b : Promise.reject())),
                ]).catch(() => null);
            }
            if (!blob) {
                const res = await fetch(url, { credentials: 'include' });
                if (!res.ok) throw new Error('fetch failed');
                blob = await res.blob();
            }
            assignImageInlineTabBlob(tab, url, blob);
        } catch (err) {
            navigateImageInlineTab(tab, url);
        }
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

    /**
     * Gemini image lightbox (back button + filename title). Angular host attrs change; these classes are stable.
     * The large img often lacks chat-inline class "image" and alt "AI generated".
     */
    function isGeminiImageViewerDialogImage(img) {
        if (!img || img.tagName !== 'IMG') return false;
        const dialog = img.closest(
            '[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container, .mat-dialog-container',
        );
        if (!dialog) return false;
        return !!dialog.querySelector('.arrow-back-container') && !!dialog.querySelector('.image-title');
    }

    /** Gemini inline AI chat results: blob/CDN + main image class + AI alt. No longer requires class "loaded" so low-res / swap placeholders match before decode finishes. */
    function isGeminiOptInImage(img) {
        if (!img || img.tagName !== 'IMG' || !isGeminiHost()) return false;
        const src = img.getAttribute('src') || img.src || '';
        if (!isGeminiOptInResultSrc(src)) return false;
        if (isGeminiImageViewerDialogImage(img)) return true;
        const cls = img.getAttribute('class') || '';
        if (!/\bimage\b/.test(cls)) return false;
        const alt = img.getAttribute('alt') || '';
        if (!/AI\s+generated/i.test(alt)) return false;
        return true;
    }

    // Grok: only main chat generated images (opt-in), not thumbnails / chrome / etc.
    function isGrokOptInImage(img) {
        if (img.closest('[class*="group/grok-image"]')) return true;
        const grid = img.closest('div.grid');
        if (!grid || !img.classList.contains('col-start-1') || !img.classList.contains('row-start-1')) {
            return false;
        }
        // Legacy Imagine card: div.group.rounded-2xl wrapper
        const card = grid.parentElement;
        if (card && card.classList.contains('group') && card.classList.contains('rounded-2xl')) {
            return true;
        }
        // Imagine post hero (2025+ layout): main > article > … > div.grid > img
        if (img.closest('article') && img.closest('main') && !img.closest('[data-filmstrip-item]')) {
            return true;
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
        stopOverlayArrowScroll();
        stopCursorAutoHide();
        overlayNativeScrollBySrc.clear();
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

    /** PNG blob from pixels already decoded on the img (avoids fetch(blob:) — Gemini CSP blocks connect-src to blob URLs). */
    async function clipboardPngBlobFromImageElement(img) {
        try {
            if (img.decode && typeof img.decode === 'function') {
                await img.decode().catch(() => {});
            }
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (!w || !h) return null;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0);
            return await new Promise((resolve) => {
                canvas.toBlob((b) => resolve(b || null), 'image/png');
            });
        } catch (e) {
            ivLogFullscreenClipboard('canvas→blob threw', { name: e && e.name, message: e && e.message });
            return null;
        }
    }

    /** Chromium clipboard image write often accepts image/png only; re-encode JPEG/WebP fetch results. */
    async function imageBlobToPngBlob(blob) {
        if (!blob || !blob.size) return null;
        const t = (blob.type || '').toLowerCase();
        if (t === 'image/png') return blob;
        try {
            if (typeof createImageBitmap === 'function') {
                const bmp = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bmp.width;
                canvas.height = bmp.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;
                ctx.drawImage(bmp, 0, 0);
                if (typeof bmp.close === 'function') bmp.close();
                return await new Promise((resolve) => {
                    canvas.toBlob((b) => resolve(b || null), 'image/png');
                });
            }
        } catch (e) {
            ivLogFullscreenClipboard('imageBlobToPngBlob threw', { name: e && e.name, message: e && e.message });
        }
        return null;
    }

    /** Copy the image currently shown in the fullscreen overlay (same pipeline as fetch → PNG for Chromium). */
    async function copyFullscreenOverlayImageToClipboard(imgEl) {
        ivLogFullscreenClipboard('start', {
            isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : null,
            hasClipboardWrite: !!(navigator.clipboard && navigator.clipboard.write),
            hasClipboardItem: typeof ClipboardItem !== 'undefined'
        });
        if (!imgEl || typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
            ivLogFullscreenClipboard('abort: clipboard API missing');
            showViewerToast('Copy not supported');
            return;
        }
        const rawUrl = imgEl.currentSrc || imgEl.getAttribute('src') || imgEl.src || '';
        if (!rawUrl) {
            ivLogFullscreenClipboard('abort: no URL on img');
            showViewerToast('Copy failed');
            return;
        }
        showViewerToast('Copying image…', 30000);
        const url = getFullSizeGoogleUrl(rawUrl);
        ivLogFullscreenClipboard('urls', { raw: rawUrl.length > 200 ? rawUrl.slice(0, 200) + '\u2026' : rawUrl, resolved: url.length > 200 ? url.slice(0, 200) + '\u2026' : url });
        let blob = null;
        let mime = 'image/png';

        if (url.startsWith('blob:')) {
            blob = await clipboardPngBlobFromImageElement(imgEl);
            ivLogFullscreenClipboard('strategy blob URL', { via: 'canvas (fetch blocked by page CSP)', size: blob ? blob.size : 0 });
        } else {
            try {
                let res = await fetch(url, { mode: 'cors', credentials: 'include', cache: 'no-store' });
                ivLogFullscreenClipboard('fetch include', { ok: res.ok, status: res.status, type: res.type });
                if (!res.ok) {
                    res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
                    ivLogFullscreenClipboard('fetch omit', { ok: res.ok, status: res.status, type: res.type });
                }
                if (res.ok) blob = await res.blob();
            } catch (e) {
                ivLogFullscreenClipboard('fetch threw', { name: e && e.name, message: e && e.message });
            }
            if (!blob || blob.size === 0) {
                blob = await clipboardPngBlobFromImageElement(imgEl);
                ivLogFullscreenClipboard('strategy after fetch failed', { via: 'canvas fallback', size: blob ? blob.size : 0 });
            } else {
                mime = blob.type && /^image\//i.test(blob.type) ? blob.type : 'image/png';
            }
        }

        if (!blob || blob.size === 0) {
            ivLogFullscreenClipboard('abort: no blob', { blob: !!blob, size: blob ? blob.size : 0 });
            showViewerToast('Copy failed');
            return;
        }
        if (mime !== 'image/png') {
            const png = await imageBlobToPngBlob(blob);
            if (png && png.size) {
                ivLogFullscreenClipboard('re-encoded for clipboard', { from: mime, to: 'image/png', size: png.size });
                blob = png;
                mime = 'image/png';
            } else {
                const fromEl = await clipboardPngBlobFromImageElement(imgEl);
                if (fromEl && fromEl.size) {
                    ivLogFullscreenClipboard('re-encode failed; used canvas from img', { size: fromEl.size });
                    blob = fromEl;
                    mime = 'image/png';
                }
            }
        }
        ivLogFullscreenClipboard('blob', { size: blob.size, mime: mime });
        try {
            await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
            ivLogFullscreenClipboard('clipboard.write OK');
            showViewerToast('Image copied to clipboard');
        } catch (e) {
            ivLogFullscreenClipboard('clipboard.write failed', { name: e && e.name, message: e && e.message });
            showViewerToast('Copy failed');
        }
    }

    function applyOverlayImageFitMode() {
        if (!overlay || !overlayImage) return;
        const overlayCursor =
            document.body.style.cursor === 'none' ? 'none' : overlayCursorWhenVisible();
        if (overlayFitNative) {
            overlay.classList.add('iv-overlay-native');
            Object.assign(overlay.style, {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                overflow: 'auto',
                cursor: overlayCursor
            });
            const w = overlayImage.naturalWidth;
            const h = overlayImage.naturalHeight;
            const centerHorizontally = !!(w && overlay.clientWidth > w);
            if (w && h) {
                Object.assign(overlayImage.style, {
                    maxWidth: 'none',
                    maxHeight: 'none',
                    width: `${w}px`,
                    height: `${h}px`,
                    objectFit: 'none',
                    flexShrink: '0',
                    marginLeft: centerHorizontally ? 'auto' : '0',
                    marginRight: centerHorizontally ? 'auto' : '0',
                });
            } else {
                Object.assign(overlayImage.style, {
                    maxWidth: 'none',
                    maxHeight: 'none',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'none',
                    flexShrink: '0',
                    marginLeft: '0',
                    marginRight: '0',
                });
            }
        } else {
            overlay.classList.remove('iv-overlay-native');
            Object.assign(overlay.style, {
                display: 'flex',
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: overlayCursor
            });
            Object.assign(overlayImage.style, {
                maxWidth: '100%',
                maxHeight: '100%',
                width: '100%',
                height: '100%',
                objectFit: 'contain'
            });
        }
    }

    function mountOverlayImageElement(img) {
        if (overlayImage && overlayImage.parentNode === overlay) {
            overlay.replaceChild(img, overlayImage);
        } else if (overlay) {
            overlay.insertBefore(img, overlay.firstChild);
        }
        overlayImage = img;
    }

    // Display an image in the overlay with progressive loading (low-quality first, then high-quality)
    function displayImageInOverlay(imgEl) {
        if (overlay && !overlayFitNative) {
            overlay.scrollTop = 0;
            overlay.scrollLeft = 0;
        }
        const lowQualitySrc = imgEl.currentSrc || imgEl.src;
        const fullSizeSrc = getFullSizeGoogleUrl(lowQualitySrc);
        const expectedIndex = currentIndex;

        // Fresh <img> so the browser does not keep painting the previous picture while the next loads.
        const img = document.createElement('img');
        img.style.aspectRatio = 'auto';

        const onSrcSettled = () => {
            if (currentIndex !== expectedIndex || overlayImage !== img) return;
            applyOverlayImageFitMode();
            restoreOverlayNativeScrollForImgEl(imgEl);
        };
        img.addEventListener('load', onSrcSettled);

        mountOverlayImageElement(img);

        const assignSrc = (src) => {
            if (currentIndex !== expectedIndex || overlayImage !== img) return;
            img.src = src;
            if (img.complete) onSrcSettled();
        };

        // Page thumbnail already decoded — show it immediately (often same URL, memory cache).
        if (fullSizeSrc !== lowQualitySrc) {
            assignSrc(lowQualitySrc);
            const preloader = new Image();
            preloader.onload = () => {
                if (currentIndex === expectedIndex && overlayImage === img) {
                    assignSrc(fullSizeSrc);
                }
            };
            preloader.src = fullSizeSrc;
        } else {
            assignSrc(lowQualitySrc);
        }

        if (!img.complete) onSrcSettled();
    }

    function navigate(delta) {
        const next = currentIndex + delta;
        if (next < 0 || next >= imgs.length) return;
        saveOverlayNativeScrollForCurrent();
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

        if (!document.getElementById('iv-image-fullscreen-chrome')) {
            const s = document.createElement('style');
            s.id = 'iv-image-fullscreen-chrome';
            s.textContent =
                'html:fullscreen,html:-webkit-full-screen,html:-moz-full-screen{outline:none!important;box-shadow:none!important}' +
                '.iv-overlay-native{scrollbar-width:none;-ms-overflow-style:none}' +
                '.iv-overlay-native::-webkit-scrollbar{display:none}';
            document.head.appendChild(s);
        }

        // Create overlay
        overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: 0, left: 0,
            width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2147483647, cursor: 'zoom-out'
        });

        displayImageInOverlay(img);
        applyOverlayImageFitMode();

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
        startCursorAutoHide(() => !!overlay, {
            onShow: () => {
                if (overlay) overlay.style.cursor = overlayCursorWhenVisible();
            },
            onHide: () => {
                if (overlay) overlay.style.cursor = 'none';
            },
        });
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

    document.addEventListener('mousemove', (e) => {
        ivLastPointerX = e.clientX;
        ivLastPointerY = e.clientY;
    }, true);

    // Open image in new tab inline (T / middle-click); fetch→blob bypasses Content-Disposition: attachment
    document.addEventListener('auxclick', e => {
        if (e.button !== 1) return;
        let img = viewerImageFromEventTarget(e.target);
        if (!img && overlay && overlayImage) {
            const hit = document.elementFromPoint(e.clientX, e.clientY);
            if (hit === overlayImage || (hit && overlayImage.contains(hit))) img = overlayImage;
        }
        if (!img) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        void openImageInNewTabInline(img);
    }, true);

    // Keyboard controls (capture: must run before bubble and before focused textarea consumes keys)
    document.addEventListener('keydown', e => {
        if (viewerHotkeysModalBlocksKeydown(e)) return;
        if (!overlay) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            hideFullscreen();
            return;
        }
        if (
            (e.key === 'c' || e.key === 'C') &&
            !e.ctrlKey && !e.metaKey && !e.altKey
        ) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (overlayImage) void copyFullscreenOverlayImageToClipboard(overlayImage);
            return;
        }
        if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (overlayImage && isViewerOpenInTabImageSrc(viewerImageSrcForNewTab(overlayImage))) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void openImageInNewTabInline(overlayImage);
            }
            return;
        }
        if (e.code === 'Period' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (overlayFitNative) saveOverlayNativeScrollForCurrent();
            overlayFitNative = !overlayFitNative;
            applyOverlayImageFitMode();
            if (overlayFitNative && imgs[currentIndex]) {
                restoreOverlayNativeScrollForImgEl(imgs[currentIndex]);
            } else {
                stopOverlayArrowScroll();
            }
            return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (overlayFitNative && overlay.scrollHeight > overlay.clientHeight + 1) {
                e.preventDefault();
                e.stopImmediatePropagation();
                onOverlayArrowKeyDown(e.key);
                return;
            }
        }
        if (['ArrowRight', ' ', 'Spacebar'].includes(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            navigate(1);
        } else if (['ArrowLeft', 'Meta', 'Alt'].includes(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            navigate(-1);
        }
    }, true);

    document.addEventListener('keyup', e => {
        if (!overlay) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (!overlayScrollKeys.delete(e.key)) return;
        syncOverlayScrollDir();
        if (!overlayScrollDir) stopOverlayArrowScroll();
    }, true);

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

    let viewerToastEl = null;
    let viewerToastHideTimer = null;

    function showViewerToast(message, holdMs = 2000) {
        if (!viewerToastEl) {
            viewerToastEl = document.createElement('div');
            viewerToastEl.setAttribute('popover', 'manual');
            Object.assign(viewerToastEl.style, {
                position: 'fixed',
                inset: 'auto',
                bottom: '60px',
                left: '50%',
                transform: 'translateX(-50%)',
                margin: '0',
                border: 'none',
                zIndex: '2147483647',
                padding: '8px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                color: 'white',
                fontSize: '14px',
                fontFamily: 'sans-serif',
                transition: 'opacity 0.3s',
                pointerEvents: 'none',
                userSelect: 'none',
                whiteSpace: 'nowrap',
            });
            document.body.appendChild(viewerToastEl);
        }
        viewerToastEl.textContent = message;
        try {
            viewerToastEl.showPopover();
        } catch (e) {}
        viewerToastEl.style.opacity = '1';
        clearTimeout(viewerToastHideTimer);
        viewerToastHideTimer = setTimeout(() => {
            if (viewerToastEl) {
                viewerToastEl.style.opacity = '0';
                setTimeout(() => {
                    try {
                        viewerToastEl.hidePopover();
                    } catch (e) {}
                }, 300);
            }
        }, holdMs);
    }

    let viewerHotkeysModalEl = null;
    let viewerHotkeysModalDismissSuppressUntil = 0;

    const VIEWER_HOTKEY_SECTIONS = [
        {
            title: 'General',
            items: [
                ['H', 'Show keyboard shortcuts'],
                ['F or /', 'Fullscreen image or video (exit image fullscreen)'],
                ['T', 'Open image in new tab (page or fullscreen)'],
                ['C', 'Copy image to clipboard (page or fullscreen)'],
            ],
        },
        {
            title: 'Video',
            items: [
                ['Space', 'Play / pause'],
                ['L', 'Toggle loop'],
                ['I', 'Set loop in-point'],
                ['O', 'Set loop out-point'],
                ['Backspace', 'Clear loop points'],
                ['E', 'Export loop region (MP4 or WebM)'],
                ['←  →', 'Seek ±1 second'],
                ['↑  ↓', 'Volume up / down'],
            ],
        },
        {
            title: 'Image fullscreen',
            items: [
                ['Esc', 'Close'],
                ['.', 'Toggle fit screen / native resolution'],
                ['→  Space', 'Next image'],
                ['←  ⌘  Alt', 'Previous image'],
                ['↑  ↓', 'Scroll (native resolution mode)'],
            ],
        },
    ];

    function viewerHotkeysModalBlocksKeydown(e) {
        if (viewerHotkeysModalEl) {
            e.preventDefault();
            e.stopImmediatePropagation();
            dismissViewerHotkeysModal();
            return true;
        }
        return performance.now() < viewerHotkeysModalDismissSuppressUntil;
    }

    function hideViewerHotkeysModal() {
        if (viewerHotkeysModalEl) viewerHotkeysModalEl.remove();
        viewerHotkeysModalEl = null;
    }

    function dismissViewerHotkeysModal() {
        hideViewerHotkeysModal();
        viewerHotkeysModalDismissSuppressUntil = performance.now() + 50;
    }

    function showViewerHotkeysModal() {
        hideViewerHotkeysModal();
        const root = document.createElement('div');
        root.id = 'iv-hotkeys-modal';
        Object.assign(root.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(0,0,0,0.65)',
            boxSizing: 'border-box',
        });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            maxWidth: '520px',
            width: '100%',
            maxHeight: 'min(80vh, 640px)',
            overflow: 'auto',
            padding: '20px 24px',
            borderRadius: '14px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(24,24,27,0.98)',
            color: '#fafafa',
            fontFamily: 'system-ui,-apple-system,sans-serif',
            fontSize: '13px',
            lineHeight: '1.45',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        });

        const title = document.createElement('div');
        title.textContent = 'ImageViewer shortcuts';
        Object.assign(title.style, {
            fontSize: '16px',
            fontWeight: '700',
            marginBottom: '14px',
        });
        panel.appendChild(title);

        for (let si = 0; si < VIEWER_HOTKEY_SECTIONS.length; si++) {
            const section = VIEWER_HOTKEY_SECTIONS[si];
            const heading = document.createElement('div');
            heading.textContent = section.title;
            Object.assign(heading.style, {
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.55)',
                marginTop: si === 0 ? '0' : '14px',
                marginBottom: '8px',
            });
            panel.appendChild(heading);

            for (let ii = 0; ii < section.items.length; ii++) {
                const [keys, desc] = section.items[ii];
                const row = document.createElement('div');
                Object.assign(row.style, {
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '12px',
                    marginBottom: '6px',
                });

                const keyEl = document.createElement('span');
                keyEl.textContent = keys;
                Object.assign(keyEl.style, {
                    flex: '0 0 108px',
                    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#e4e4e7',
                });

                const descEl = document.createElement('span');
                descEl.textContent = desc;
                Object.assign(descEl.style, {
                    flex: '1',
                    color: 'rgba(250,250,250,0.88)',
                });

                row.appendChild(keyEl);
                row.appendChild(descEl);
                panel.appendChild(row);
            }
        }

        root.addEventListener('mousedown', (e) => {
            if (e.target !== root) return;
            e.preventDefault();
            e.stopPropagation();
            dismissViewerHotkeysModal();
        });

        const hint = document.createElement('div');
        hint.textContent = 'Press any key or click outside to close';
        Object.assign(hint.style, {
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            fontSize: '12px',
            color: 'rgba(255,255,255,0.45)',
            textAlign: 'center',
        });
        panel.appendChild(hint);

        root.appendChild(panel);
        document.body.appendChild(root);
        viewerHotkeysModalEl = root;
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
    const IV_GROK_SAVED_KEPT_FILTER_KEY = 'ivGrokImagineSavedShowUnkeptOnly';
    const IV_GROK_SAVED_FILTER_ROOT_ID = 'iv-grok-saved-kept-filter';
    const GROK_SAVED_FILTER_ALL = 'all';
    const GROK_SAVED_FILTER_UNKEPT = 'unkept';
    const GROK_SAVED_FILTER_KEPT = 'kept';
    const GROK_SAVED_FILTER_OPTIONS = [
        [GROK_SAVED_FILTER_ALL, 'All'],
        [GROK_SAVED_FILTER_UNKEPT, 'Unkept only'],
        [GROK_SAVED_FILTER_KEPT, 'Kept only'],
    ];

    function grokSavedFilterOptionLabel(mode) {
        for (let i = 0; i < GROK_SAVED_FILTER_OPTIONS.length; i++) {
            if (GROK_SAVED_FILTER_OPTIONS[i][0] === mode) return GROK_SAVED_FILTER_OPTIONS[i][1];
        }
        return 'All';
    }

    let grokSavedFilterTriggerMinWidthPx = 0;

    function grokSavedFilterMeasureTriggerMinWidth() {
        const probe = document.createElement('button');
        probe.type = 'button';
        Object.assign(probe.style, {
            position: 'absolute',
            visibility: 'hidden',
            pointerEvents: 'none',
            padding: '6px 12px',
            border: '1px solid rgba(255,255,255,0.25)',
            fontSize: '12px',
            fontWeight: '600',
            lineHeight: '1.2',
            whiteSpace: 'nowrap',
        });
        document.body.appendChild(probe);
        let maxW = 0;
        for (let i = 0; i < GROK_SAVED_FILTER_OPTIONS.length; i++) {
            probe.textContent = `${GROK_SAVED_FILTER_OPTIONS[i][1]} ▾`;
            maxW = Math.max(maxW, probe.offsetWidth);
        }
        probe.remove();
        grokSavedFilterTriggerMinWidthPx = maxW;
        return maxW;
    }

    function grokSavedFilterApplyTriggerWidth(triggerBtn) {
        if (!triggerBtn) return;
        const w = grokSavedFilterTriggerMinWidthPx || grokSavedFilterMeasureTriggerMinWidth();
        triggerBtn.style.minWidth = `${w}px`;
        triggerBtn.style.boxSizing = 'border-box';
    }

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

    function grokSavedLoadKeptFilterMode() {
        try {
            const raw = localStorage.getItem(IV_GROK_SAVED_KEPT_FILTER_KEY);
            if (raw === '1') return GROK_SAVED_FILTER_UNKEPT;
            if (raw === '0') return GROK_SAVED_FILTER_ALL;
            if (raw === GROK_SAVED_FILTER_UNKEPT || raw === GROK_SAVED_FILTER_KEPT || raw === GROK_SAVED_FILTER_ALL) {
                return raw;
            }
            return GROK_SAVED_FILTER_ALL;
        } catch (e) {
            return GROK_SAVED_FILTER_ALL;
        }
    }

    function grokSavedStoreKeptFilterMode(mode) {
        try {
            localStorage.setItem(IV_GROK_SAVED_KEPT_FILTER_KEY, mode);
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
        const filterExisting = document.getElementById(IV_GROK_SAVED_FILTER_ROOT_ID);
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
        const filterMode = grokSavedLoadKeptFilterMode();
        const recentDeleted = grokRecentlyDeletedLoadSet();

        let filterRoot = filterExisting;
        if (filterRoot && filterRoot.tagName === 'SELECT') {
            filterRoot.remove();
            filterRoot = null;
        }
        if (!document.getElementById('iv-grok-saved-filter-chrome')) {
            const s = document.createElement('style');
            s.id = 'iv-grok-saved-filter-chrome';
            s.textContent =
                '.iv-grok-filter-item{transition:background .12s ease}' +
                '.iv-grok-filter-item:hover{background:rgba(255,255,255,0.2)!important}' +
                '.iv-grok-filter-item.iv-grok-filter-item-active{background:rgba(255,255,255,0.12)}' +
                '.iv-grok-filter-item.iv-grok-filter-item-active:hover{background:rgba(255,255,255,0.28)!important}';
            document.head.appendChild(s);
        }

        if (!filterRoot) {
            filterRoot = document.createElement('div');
            filterRoot.id = IV_GROK_SAVED_FILTER_ROOT_ID;
            Object.assign(filterRoot.style, {
                position: 'fixed',
                top: '12px',
                right: '16px',
                zIndex: '2147483630',
            });

            const triggerBtn = document.createElement('button');
            triggerBtn.type = 'button';
            triggerBtn.dataset.ivGrokSavedFilterTrigger = '1';
            triggerBtn.title = 'Filter saved tiles by Keep status (local to this browser).';
            Object.assign(triggerBtn.style, {
                padding: '6px 12px',
                borderRadius: '9999px',
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(24,24,27,0.92)',
                color: '#fafafa',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                lineHeight: '1.2',
            });

            const menu = document.createElement('div');
            menu.dataset.ivGrokSavedFilterMenu = '1';
            Object.assign(menu.style, {
                display: 'none',
                position: 'absolute',
                top: '100%',
                right: '0',
                marginTop: '6px',
                minWidth: '100%',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(24,24,27,0.98)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
                overflow: 'hidden',
                padding: '4px 0',
            });

            const closeMenu = () => {
                menu.style.display = 'none';
                document.removeEventListener('mousedown', filterRoot._ivCloseMenu, true);
            };
            filterRoot._ivCloseMenu = (ev) => {
                if (filterRoot.contains(ev.target)) return;
                closeMenu();
            };

            triggerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const open = menu.style.display !== 'none';
                if (open) {
                    closeMenu();
                } else {
                    menu.style.display = 'block';
                    requestAnimationFrame(() => {
                        document.addEventListener('mousedown', filterRoot._ivCloseMenu, true);
                    });
                }
            });

            for (let oi = 0; oi < GROK_SAVED_FILTER_OPTIONS.length; oi++) {
                const value = GROK_SAVED_FILTER_OPTIONS[oi][0];
                const label = GROK_SAVED_FILTER_OPTIONS[oi][1];
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'iv-grok-filter-item';
                item.dataset.ivGrokSavedFilterValue = value;
                item.textContent = label;
                Object.assign(item.style, {
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 14px',
                    border: 'none',
                    background: 'transparent',
                    color: '#fafafa',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    lineHeight: '1.2',
                });
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeMenu();
                    grokSavedStoreKeptFilterMode(value);
                    scheduleGrokImagineSavedKeepSync();
                });
                menu.appendChild(item);
            }

            grokSavedFilterApplyTriggerWidth(triggerBtn);
            filterRoot.appendChild(triggerBtn);
            filterRoot.appendChild(menu);
            document.body.appendChild(filterRoot);
        }

        const triggerBtn = filterRoot.querySelector('[data-iv-grok-saved-filter-trigger]');
        const menu = filterRoot.querySelector('[data-iv-grok-saved-filter-menu]');
        if (triggerBtn) {
            grokSavedFilterApplyTriggerWidth(triggerBtn);
            triggerBtn.textContent = `${grokSavedFilterOptionLabel(filterMode)} ▾`;
        }
        if (menu) {
            menu.querySelectorAll('[data-iv-grok-saved-filter-value]').forEach((item) => {
                item.classList.add('iv-grok-filter-item');
                item.classList.toggle('iv-grok-filter-item-active', item.dataset.ivGrokSavedFilterValue === filterMode);
            });
        }

        const cards = grokSavedGetGridCards();
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            card.dataset.ivGrokSavedCard = '1';
            const mediaId = grokSavedMediaIdFromCard(card);

            if (filterMode === GROK_SAVED_FILTER_UNKEPT) {
                card.style.display = mediaId && keptSet.has(mediaId) ? 'none' : '';
            } else if (filterMode === GROK_SAVED_FILTER_KEPT) {
                card.style.display = mediaId && keptSet.has(mediaId) ? '' : 'none';
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
    const IV_GROK_UI_DELETE_CHOSEN_ICON =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
    /** Shorter than “delete all except chosen”: keeps first (page order) + current strip selection. */
    const IV_GROK_UI_DELETE_OTHERS = 'Delete others';
    const IV_GROK_UI_CONFIRM = 'Confirm';
    /** First tap arms the delete button; second tap runs delete. Auto-cancels after this many ms. */
    const IV_GROK_DELETE_ARM_MS = 10000;
    /** Bottom-right stack fallbacks when the Imagine prompt bar is not in the DOM yet. */
    const IV_GROK_DELETE_EXCEPT_BOTTOM_PX = 44;
    const IV_GROK_DELETE_ALL_BOTTOM_PX = 96;
    const IV_GROK_POST_KEEP_BOTTOM_PX = 148;
    const IV_GROK_CORNER_BTN_STEP_PX = 52;
    const IV_GROK_FILMSTRIP_BTN_GAP_PX = 10;
    /** true: DevTools Console logs a full scan when you click the trash (cancel confirm is OK). Set false after debugging. */
    const IV_GROK_DELETE_MEDIA_DEBUG = false;
    /** true: logs layout when it changes, pointer hits in the × control area, and each click / delete step. Grok’s own console errors (CSP, GTM, i18next, etc.) are unrelated. */
    const IV_GROK_DELETE_SELECTED_DEBUG = false;
    const GROK_ASSET_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

    function grokDeleteSelectedButtonShowIdleIcon(btn) {
        btn.innerHTML = IV_GROK_UI_DELETE_CHOSEN_ICON;
        btn.setAttribute('aria-label', IV_GROK_UI_DELETE_CHOSEN);
    }

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

    function imaginePostFilmstripScrollEl() {
        return document.querySelector('[data-filmstrip-scroll="true"]');
    }

    function imaginePostIdFromFilmstripButton(btn) {
        if (!btn) return null;
        let id = imaginePostIdFromImgElement(btn.querySelector('img'));
        if (id) return id;
        id = imaginePostIdFromVideoElement(btn.querySelector('video'));
        return id || null;
    }

    function getImaginePostSelectedFilmstripButton() {
        const strip = imaginePostFilmstripScrollEl();
        if (!strip) return null;
        const selected = strip.querySelector('button[data-filmstrip-item="true"][tabindex="0"]');
        if (selected) return selected;
        return strip.querySelector('button[data-filmstrip-item="true"][class*="ring-white"]');
    }

    function collectImaginePostFilmstripMediaIds(debugRecords) {
        const strip = imaginePostFilmstripScrollEl();
        if (!strip) return [];
        const ordered = [];
        const seen = new Set();
        const buttons = strip.querySelectorAll('button[data-filmstrip-item="true"]');
        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const id = imaginePostIdFromFilmstripButton(btn);
            if (debugRecords) {
                const img = btn.querySelector('img');
                const url = (img && img.getAttribute('src')) || '';
                let pathname = '';
                try {
                    pathname = url ? new URL(url, location.href).pathname : '';
                } catch (e2) {
                    pathname = '(invalid URL)';
                }
                debugRecords.push({
                    note: 'filmstrip[' + i + ']',
                    url: url.length > 500 ? url.slice(0, 500) + '\u2026' : url,
                    pathname: pathname,
                    extractedId: id || null,
                    duplicateId: !!(id && seen.has(id)),
                    parserMissed: !id
                });
            }
            if (!id || seen.has(id)) continue;
            seen.add(id);
            ordered.push(id);
        }
        return ordered;
    }

    /** Visible hero image only — the main video player often uses the post slug, not the clip id. */
    function getImaginePostHeroImageMediaId(root) {
        if (!root) return null;
        const imgs = root.querySelectorAll('img[src]');
        for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i];
            if (img.classList.contains('invisible')) continue;
            const id = imaginePostIdFromImgElement(img);
            if (id) return id;
        }
        return null;
    }

    /** Media id for the filmstrip / hero slide the UI shows as selected. */
    function getImaginePostSelectedMediaId(root) {
        const selectedBtn = getImaginePostSelectedFilmstripButton();
        if (selectedBtn) {
            const id = imaginePostIdFromFilmstripButton(selectedBtn);
            if (id) return id;
        }
        return getImaginePostHeroImageMediaId(root);
    }

    function hideImaginePostDomForDeletedMediaId(root, mediaId) {
        if (!mediaId) return;
        const norm = String(mediaId).toLowerCase();
        const hideEl = (el) => {
            if (el && el.style) el.style.display = 'none';
        };
        const strip = imaginePostFilmstripScrollEl();
        const filmstripHost = strip || root;
        if (filmstripHost) {
            filmstripHost.querySelectorAll('button[data-filmstrip-item="true"]').forEach((btn) => {
                const id = imaginePostIdFromFilmstripButton(btn);
                if (id === norm) {
                    const wrap = btn.closest('.snap-center') || btn.closest('[class*="snap-center"]');
                    hideEl(wrap || btn);
                }
            });
        }
    }

    function collectImaginePostMediaIdsInDomOrder(root, debugRecords) {
        const fromFilmstrip = collectImaginePostFilmstripMediaIds(debugRecords);
        if (fromFilmstrip.length) return fromFilmstrip;

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

    const IV_GROK_POST_TOOLBAR_GAP_PX = 12;
    let grokImaginePostToolbarLayoutBound = false;
    let grokImaginePostToolbarLayoutRaf = null;
    let grokImaginePostToolbarResizeObs = null;
    let grokImaginePostToolbarResizeObsTarget = null;

    /** Grok post page: right rail (Share / Download / …) — keep our corner buttons left of it. */
    function grokImaginePostDetailsAside() {
        const article = getImaginePostRoot();
        if (article) {
            const local = article.querySelector('aside[aria-label="Post details"]');
            if (local) return local;
        }
        return document.querySelector('aside[aria-label="Post details"]');
    }

    function grokImaginePostToolbarRightPx() {
        const aside = grokImaginePostDetailsAside();
        if (!aside) return 16;
        const r = aside.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return 16;
        return Math.max(16, Math.round(window.innerWidth - r.left + IV_GROK_POST_TOOLBAR_GAP_PX));
    }

    /** Bottom Imagine prompt/query bar — stack delete controls just above it. */
    function grokImaginePostPromptBarEl() {
        const input = document.querySelector('[data-testid="chat-input"]');
        if (!input) return null;
        return input.closest('.query-bar') || input.closest('form') || input;
    }

    function grokImaginePostPromptBarRect() {
        const el = grokImaginePostPromptBarEl();
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 8) return null;
        return r;
    }

    function grokImaginePostCornerStackBottomPx(stackIndex) {
        const fallbacks = [IV_GROK_DELETE_EXCEPT_BOTTOM_PX, IV_GROK_DELETE_ALL_BOTTOM_PX, IV_GROK_POST_KEEP_BOTTOM_PX];
        const r = grokImaginePostPromptBarRect();
        if (!r) return fallbacks[stackIndex] != null ? fallbacks[stackIndex] : fallbacks[0];
        const baseBottom = Math.max(
            IV_GROK_DELETE_EXCEPT_BOTTOM_PX,
            Math.round(window.innerHeight - r.top + IV_GROK_POST_TOOLBAR_GAP_PX)
        );
        return baseBottom + stackIndex * IV_GROK_CORNER_BTN_STEP_PX;
    }

    function applyGrokImaginePostCornerButtonLayout() {
        if (!isGrokHost() || !isPostPage()) return;
        const rightPx = grokImaginePostToolbarRightPx() + 'px';
        const placements = [
            [IV_GROK_DELETE_EXCEPT_BTN_ID, 0],
            [IV_GROK_DELETE_ALL_BTN_ID, 1],
            [IV_GROK_POST_KEEP_BTN_ID, 2],
        ];
        for (let i = 0; i < placements.length; i++) {
            const el = document.getElementById(placements[i][0]);
            if (!el) continue;
            Object.assign(el.style, {
                position: 'fixed',
                right: rightPx,
                bottom: grokImaginePostCornerStackBottomPx(placements[i][1]) + 'px',
                left: 'auto',
                top: 'auto',
                transform: 'none',
                zIndex: '2147483640',
                pointerEvents: 'auto'
            });
        }
    }

    /** Outer filmstrip column (thumbs rail), not just the scroll inner. */
    function imaginePostFilmstripMountRect() {
        const strip = imaginePostFilmstripScrollEl();
        if (!strip) return null;
        let host = strip.parentElement;
        if (host && host.parentElement) host = host.parentElement;
        if (!host) host = strip;
        const r = host.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return null;
        return r;
    }

    /** Fixed position just right of the filmstrip; tracks the selected thumb vertically. */
    function mountGrokDeleteSelectedButton(sbtn) {
        if (!sbtn) return;
        if (!sbtn.parentElement) document.body.appendChild(sbtn);
        const mountRect = imaginePostFilmstripMountRect();
        const br0 = sbtn.getBoundingClientRect();
        const btnH = Math.max(36, Math.ceil(br0.height) || sbtn.offsetHeight || 36);
        if (mountRect) {
            const selectedBtn = getImaginePostSelectedFilmstripButton();
            let top;
            if (selectedBtn) {
                const sr = selectedBtn.getBoundingClientRect();
                top = Math.round(sr.top + sr.height / 2 - btnH / 2);
            } else {
                top = Math.round(mountRect.top + mountRect.height / 2 - btnH / 2);
            }
            const left = Math.round(mountRect.right + IV_GROK_FILMSTRIP_BTN_GAP_PX);
            Object.assign(sbtn.style, {
                position: 'fixed',
                left: left + 'px',
                top: top + 'px',
                right: 'auto',
                bottom: 'auto',
                transform: 'none',
                zIndex: '2147483640',
                pointerEvents: 'auto'
            });
        } else {
            Object.assign(sbtn.style, {
                position: 'fixed',
                bottom: grokImaginePostCornerStackBottomPx(2) + 'px',
                right: grokImaginePostToolbarRightPx() + 'px',
                left: 'auto',
                top: 'auto',
                transform: 'none',
                zIndex: '2147483640',
                pointerEvents: 'auto'
            });
        }
    }

    let grokImaginePostFilmstripResizeObs = null;
    let grokImaginePostFilmstripResizeObsTarget = null;
    let grokImaginePostFilmstripScrollElBound = null;
    let grokImaginePostPromptResizeObs = null;
    let grokImaginePostPromptResizeObsTarget = null;

    function grokImaginePostFilmstripObserve() {
        const strip = imaginePostFilmstripScrollEl();
        if (!strip) return;
        if (strip !== grokImaginePostFilmstripScrollElBound) {
            if (grokImaginePostFilmstripScrollElBound) {
                grokImaginePostFilmstripScrollElBound.removeEventListener('scroll', grokImaginePostFilmstripOnScroll);
            }
            grokImaginePostFilmstripScrollElBound = strip;
            strip.addEventListener('scroll', grokImaginePostFilmstripOnScroll, { passive: true });
        }
        if (typeof ResizeObserver === 'undefined') return;
        let host = strip.parentElement;
        if (host && host.parentElement) host = host.parentElement;
        if (!host) host = strip;
        if (!grokImaginePostFilmstripResizeObs) {
            grokImaginePostFilmstripResizeObs = new ResizeObserver(() => {
                scheduleImaginePostDeleteButtonsSync();
            });
        }
        if (host === grokImaginePostFilmstripResizeObsTarget) return;
        grokImaginePostFilmstripResizeObs.disconnect();
        grokImaginePostFilmstripResizeObs.observe(host);
        grokImaginePostFilmstripResizeObsTarget = host;
    }

    function grokImaginePostFilmstripOnScroll() {
        scheduleImaginePostDeleteButtonsSync();
    }

    function grokImaginePostPromptBarObserve() {
        const el = grokImaginePostPromptBarEl();
        if (!el || typeof ResizeObserver === 'undefined') return;
        if (!grokImaginePostPromptResizeObs) {
            grokImaginePostPromptResizeObs = new ResizeObserver(() => {
                scheduleImaginePostDeleteButtonsSync();
            });
        }
        if (el === grokImaginePostPromptResizeObsTarget) return;
        grokImaginePostPromptResizeObs.disconnect();
        grokImaginePostPromptResizeObs.observe(el);
        grokImaginePostPromptResizeObsTarget = el;
    }

    function teardownGrokImaginePostPromptBarObserve() {
        if (grokImaginePostPromptResizeObs) {
            grokImaginePostPromptResizeObs.disconnect();
            grokImaginePostPromptResizeObs = null;
            grokImaginePostPromptResizeObsTarget = null;
        }
    }

    function teardownGrokImaginePostFilmstripObserve() {
        if (grokImaginePostFilmstripScrollElBound) {
            grokImaginePostFilmstripScrollElBound.removeEventListener('scroll', grokImaginePostFilmstripOnScroll);
            grokImaginePostFilmstripScrollElBound = null;
        }
        if (grokImaginePostFilmstripResizeObs) {
            grokImaginePostFilmstripResizeObs.disconnect();
            grokImaginePostFilmstripResizeObs = null;
            grokImaginePostFilmstripResizeObsTarget = null;
        }
    }

    function grokImaginePostToolbarObserveAside() {
        if (typeof ResizeObserver === 'undefined') return;
        const aside = grokImaginePostDetailsAside();
        if (!aside) return;
        if (!grokImaginePostToolbarResizeObs) {
            grokImaginePostToolbarResizeObs = new ResizeObserver(() => {
                scheduleImaginePostDeleteButtonsSync();
            });
        }
        if (aside === grokImaginePostToolbarResizeObsTarget) return;
        grokImaginePostToolbarResizeObs.disconnect();
        grokImaginePostToolbarResizeObs.observe(aside);
        grokImaginePostToolbarResizeObsTarget = aside;
    }

    function teardownGrokImaginePostToolbarLayoutBinding() {
        if (!grokImaginePostToolbarLayoutBound) return;
        grokImaginePostToolbarLayoutBound = false;
        if (grokImaginePostToolbarLayoutRaf != null) {
            cancelAnimationFrame(grokImaginePostToolbarLayoutRaf);
            grokImaginePostToolbarLayoutRaf = null;
        }
        if (grokImaginePostToolbarResizeObs) {
            grokImaginePostToolbarResizeObs.disconnect();
            grokImaginePostToolbarResizeObs = null;
            grokImaginePostToolbarResizeObsTarget = null;
        }
        teardownGrokImaginePostFilmstripObserve();
        teardownGrokImaginePostPromptBarObserve();
        if (typeof grokImaginePostToolbarOnLayout === 'function') {
            window.removeEventListener('resize', grokImaginePostToolbarOnLayout);
            window.removeEventListener('scroll', grokImaginePostToolbarOnLayout, true);
            grokImaginePostToolbarOnLayout = null;
        }
    }

    let grokImaginePostToolbarOnLayout = null;

    function ensureGrokImaginePostToolbarLayoutBinding() {
        if (grokImaginePostToolbarLayoutBound) {
            grokImaginePostToolbarObserveAside();
            grokImaginePostFilmstripObserve();
            grokImaginePostPromptBarObserve();
            return;
        }
        grokImaginePostToolbarLayoutBound = true;
        grokImaginePostToolbarOnLayout = () => {
            if (grokImaginePostToolbarLayoutRaf != null) cancelAnimationFrame(grokImaginePostToolbarLayoutRaf);
            grokImaginePostToolbarLayoutRaf = requestAnimationFrame(() => {
                grokImaginePostToolbarLayoutRaf = null;
                applyGrokImaginePostCornerButtonLayout();
                const sb = document.getElementById(IV_GROK_DELETE_SELECTED_BTN_ID);
                if (sb) mountGrokDeleteSelectedButton(sb);
            });
        };
        window.addEventListener('resize', grokImaginePostToolbarOnLayout);
        window.addEventListener('scroll', grokImaginePostToolbarOnLayout, true);
        grokImaginePostToolbarObserveAside();
        grokImaginePostFilmstripObserve();
        grokImaginePostPromptBarObserve();
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
            teardownGrokImaginePostToolbarLayoutBinding();
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
                    bottom: IV_GROK_POST_KEEP_BOTTOM_PX + 'px',
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
                bottom: IV_GROK_DELETE_ALL_BOTTOM_PX + 'px',
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
                        filmstripButtons = (imaginePostFilmstripScrollEl() || root).querySelectorAll('button[data-filmstrip-item="true"]').length;
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
                bottom: IV_GROK_DELETE_EXCEPT_BOTTOM_PX + 'px',
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
            grokDeleteSelectedButtonShowIdleIcon(sbtn);
            Object.assign(sbtn.style, {
                width: 'auto',
                maxWidth: 'none',
                minWidth: '36px',
                minHeight: '36px',
                padding: '8px',
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
                grokDeleteSelectedButtonShowIdleIcon(sbtn);
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
        if (!sbtn.parentElement) document.body.appendChild(sbtn);
        applyGrokImaginePostCornerButtonLayout();
        mountGrokDeleteSelectedButton(sbtn);
        ensureGrokImaginePostToolbarLayoutBinding();
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
            video.addEventListener('keydown', handleViewerKeydown, true);
            
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
                bumpCursorAutoHide();
            };
            document.addEventListener('mousemove', video._onMouseMove);
            startCursorAutoHide(() => document.fullscreenElement === video, null, false);

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
            stopCursorAutoHide();
            // Exited fullscreen - restore original styles and remove listeners
            const videos = document.querySelectorAll('video[data-original-style]');
            videos.forEach(video => {
                video.removeEventListener('keydown', handleViewerKeydown, true);
                video.controls = video._originalControls || false;
                delete video._originalControls;
                if (video._onMouseMove) {
                    document.removeEventListener('mousemove', video._onMouseMove);
                    delete video._onMouseMove;
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

    function isKeyboardTypingTarget(target) {
        let el = target;
        if (!el || !el.nodeType) return false;
        if (el.nodeType !== 1) {
            el = el.parentElement;
            if (!el) return false;
        }
        try {
            return (
                el.matches('input, textarea, select, [contenteditable="true"]') ||
                !!el.closest('[contenteditable="true"]') ||
                el.getAttribute('role') === 'textbox'
            );
        } catch (e) {
            return false;
        }
    }

    /** Eligible image with largest visible viewport overlap; tie-break closer to screen center. Same filters as click. */
    function pickBestVisibleEligibleImage() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cx = vw * 0.5;
        const cy = vh * 0.5;
        const minArea = 64;
        let bestImg = null;
        let bestArea = -1;
        let bestDist = Infinity;
        document.querySelectorAll('img').forEach((img) => {
            if (isExcludedImage(img)) return;
            const r = img.getBoundingClientRect();
            const iw = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
            const ih = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            const area = iw * ih;
            if (area < minArea) return;
            const sx = Math.max(r.left, 0);
            const sy = Math.max(r.top, 0);
            const ex = Math.min(r.right, vw);
            const ey = Math.min(r.bottom, vh);
            const icx = (sx + ex) * 0.5;
            const icy = (sy + ey) * 0.5;
            const dist = (icx - cx) * (icx - cx) + (icy - cy) * (icy - cy);
            if (area > bestArea || (area === bestArea && dist < bestDist)) {
                bestArea = area;
                bestDist = dist;
                bestImg = img;
            }
        });
        return bestImg;
    }

    // Find the target video for keyboard controls
    // In fullscreen: use the fullscreen video element
    // Otherwise: use the first video on the page, but only if not typing in a text field
    function getTargetVideo(e) {
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement ||
                                 document.mozFullScreenElement || document.msFullscreenElement;
        
        if (fullscreenElement && fullscreenElement.tagName === 'VIDEO') {
            return fullscreenElement;
        }
        
        const isTyping = isKeyboardTypingTarget(e.target);
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
    let loopExportActive = false;

    function loopRafCheck() {
        if (loopExportActive || !loopVideo) return;
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

    function pauseLoopRafOnly() {
        if (loopRafId !== null) {
            cancelAnimationFrame(loopRafId);
            loopRafId = null;
        }
    }

    function resumeLoopRafOnly() {
        if (loopVideo && loopRafId === null && !loopExportActive) {
            loopRafId = requestAnimationFrame(loopRafCheck);
        }
    }

    function getLoopRegionForVideo(video) {
        if (!video || video !== loopVideo) return null;
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) return null;
        const start = loopIn !== null ? loopIn : 0;
        const end = loopOut !== null ? loopOut : duration;
        if (end <= start + 0.05) return null;
        return { start, end };
    }

    function pickLoopExportMimeType() {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
        const types = [
            'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
            'video/mp4;codecs=avc1',
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ];
        for (const t of types) {
            if (MediaRecorder.isTypeSupported(t)) return t;
        }
        return '';
    }

    function loopExportFileExt(mimeType) {
        return /mp4/i.test(mimeType) ? 'mp4' : 'webm';
    }

    function downloadViewerBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    function waitVideoSeeked(video, time) {
        return new Promise((resolve) => {
            const target = Math.max(0, Math.min(video.duration || 0, time));
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                video.removeEventListener('seeked', done);
                resolve();
            };
            video.addEventListener('seeked', done);
            video.currentTime = target;
        });
    }

    function waitVideoMetadata(video) {
        if (video.readyState >= 1) return Promise.resolve();
        return new Promise((resolve, reject) => {
            video.addEventListener('loadedmetadata', () => resolve(), { once: true });
            video.addEventListener('error', () => reject(new Error('video load failed')), { once: true });
        });
    }

    function canCaptureStreamFromVideo(video) {
        const fn = video.captureStream || video.mozCaptureStream;
        if (!fn) return false;
        try {
            const stream = fn.call(video);
            stream.getTracks().forEach((t) => t.stop());
            return true;
        } catch (e) {
            return false;
        }
    }

    async function createBlobUrlCaptureVideo(sourceVideo) {
        const url = sourceVideo.currentSrc || sourceVideo.getAttribute('src') || sourceVideo.src || '';
        if (!url || url.startsWith('blob:')) return null;
        let res;
        try {
            res = await fetch(url, { credentials: 'include', mode: 'cors', cache: 'force-cache' });
            if (!res.ok) {
                res = await fetch(url, { credentials: 'omit', mode: 'cors', cache: 'force-cache' });
            }
            if (!res.ok) return null;
        } catch (e) {
            return null;
        }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        Object.assign(v.style, {
            position: 'fixed',
            left: '-9999px',
            width: '1px',
            height: '1px',
            opacity: '0',
            pointerEvents: 'none',
        });
        document.body.appendChild(v);
        v.src = blobUrl;
        try {
            await waitVideoMetadata(v);
        } catch (e) {
            v.remove();
            URL.revokeObjectURL(blobUrl);
            return null;
        }
        return {
            video: v,
            cleanup: () => {
                v.pause();
                v.remove();
                URL.revokeObjectURL(blobUrl);
            },
        };
    }

    /** Same-origin capture from source, or hidden clone fed from fetch(blob) when cross-origin. */
    async function resolveLoopExportCaptureVideo(sourceVideo) {
        if (canCaptureStreamFromVideo(sourceVideo)) {
            return { recordVideo: sourceVideo, cleanup: () => {} };
        }
        showViewerToast('Preparing video…', 30000);
        const clone = await createBlobUrlCaptureVideo(sourceVideo);
        if (!clone || !canCaptureStreamFromVideo(clone.video)) {
            clone?.cleanup();
            return null;
        }
        return { recordVideo: clone.video, cleanup: clone.cleanup };
    }

    async function exportLoopFragment(video) {
        if (loopExportActive) return;
        const region = getLoopRegionForVideo(video);
        if (!region) {
            showViewerToast('Set loop on this video first (I / O / L)');
            return;
        }
        const mimeType = pickLoopExportMimeType();
        if (!mimeType) {
            showViewerToast('Recording not supported');
            return;
        }

        loopExportActive = true;
        pauseLoopRafOnly();
        const wasPaused = video.paused;
        const chunks = [];
        let recorder = null;
        let stopTimer = null;
        let onTimeUpdate = null;
        let mediaStream = null;
        let recordVideo = video;
        let releaseCapture = () => {};

        const finishExport = () => {
            loopExportActive = false;
            if (stopTimer) clearTimeout(stopTimer);
            if (onTimeUpdate && recordVideo) recordVideo.removeEventListener('timeupdate', onTimeUpdate);
            if (mediaStream) {
                mediaStream.getTracks().forEach((t) => t.stop());
                mediaStream = null;
            }
            releaseCapture();
            resumeLoopRafOnly();
        };

        try {
            const captureTarget = await resolveLoopExportCaptureVideo(video);
            if (!captureTarget) {
                showViewerToast('Cannot record (cross-origin or fetch blocked)');
                return;
            }
            recordVideo = captureTarget.recordVideo;
            releaseCapture = captureTarget.cleanup;

            const captureStreamFn = recordVideo.captureStream || recordVideo.mozCaptureStream;
            if (!captureStreamFn) {
                showViewerToast('Recording not supported');
                return;
            }

            showViewerToast('Recording loop…', 60000);
            mediaStream = captureStreamFn.call(recordVideo);
            recorder = new MediaRecorder(mediaStream, { mimeType, videoBitsPerSecond: 8_000_000 });
            recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size) chunks.push(ev.data);
            };

            const stopped = new Promise((resolve) => {
                recorder.onstop = resolve;
                recorder.onerror = resolve;
            });

            recorder.start(200);
            await waitVideoSeeked(recordVideo, region.start);
            await recordVideo.play();

            onTimeUpdate = () => {
                if (recordVideo.currentTime >= region.end - 0.04) {
                    recordVideo.pause();
                    if (recorder.state === 'recording') recorder.stop();
                }
            };
            recordVideo.addEventListener('timeupdate', onTimeUpdate);

            stopTimer = setTimeout(() => {
                recordVideo.pause();
                if (recorder.state === 'recording') recorder.stop();
            }, (region.end - region.start + 3) * 1000);

            await stopped;
            await new Promise((r) => setTimeout(r, 80));

            if (!chunks.length) {
                showViewerToast('Recording failed');
                return;
            }

            const baseMime = mimeType.split(';')[0].trim() || 'video/webm';
            const ext = loopExportFileExt(mimeType);
            const blob = new Blob(chunks, { type: baseMime });
            downloadViewerBlob(
                blob,
                `loop-${Math.round(region.start * 1000)}ms-${Math.round(region.end * 1000)}ms.${ext}`,
            );
            showViewerToast(`Saved loop clip (.${ext})`);
        } catch (err) {
            console.error('[ImageViewer] loop export failed:', err);
            showViewerToast('Recording failed');
        } finally {
            finishExport();
            if (recordVideo !== video) recordVideo.pause();
            else if (wasPaused) video.pause();
        }
    }

    // Keyboard shortcuts for the viewer: video controls, image fullscreen (F), overlay vs video routing
    function handleViewerKeydown(e) {
        if (viewerHotkeysModalBlocksKeydown(e)) return;

        if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (!isKeyboardTypingTarget(e.target)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                showViewerHotkeysModal();
            }
            return;
        }

        // F or / to toggle video fullscreen (plain keys only — not Cmd/Ctrl/Alt+F so Find/search works)
        if (e.code === 'KeyF' || e.code === 'Slash') {
            if (e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }
            if (isKeyboardTypingTarget(e.target)) {
                return;
            }
            if (overlay) {
                e.preventDefault();
                e.stopImmediatePropagation();
                hideFullscreen();
                return;
            }
            if (document.querySelectorAll('video').length > 0) {
                const video = getTargetVideo(e);
                if (video) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    toggleVideoFullscreen(video);
                }
                return;
            }
            const img = pickBestVisibleEligibleImage();
            if (img) {
                e.preventDefault();
                e.stopImmediatePropagation();
                showFullscreen(img);
            }
            return;
        }

        // T: open image in new tab (inline view on ChatGPT/Grok/Gemini; overlay uses its own keydown handler)
        if (e.code === 'KeyT') {
            if (e.metaKey || e.ctrlKey || e.altKey || overlay) return;
            let img = viewerImageFromEventTarget(e.target) || viewerImageFromPointer();
            if (!img && isKeyboardTypingTarget(e.target)) return;
            if (!img) {
                const best = pickBestVisibleEligibleImage();
                if (best && isViewerOpenInTabImageSrc(viewerImageSrcForNewTab(best))) {
                    img = best;
                }
            }
            if (img) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void openImageInNewTabInline(img);
            }
            return;
        }

        // C: copy image to clipboard (overlay uses its own keydown handler)
        if (e.code === 'KeyC') {
            if (e.metaKey || e.ctrlKey || e.altKey || overlay) return;
            let img = viewerImageFromEventTarget(e.target) || viewerImageFromPointer();
            if (!img && isKeyboardTypingTarget(e.target)) return;
            if (!img) img = pickBestVisibleEligibleImage();
            if (img) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void copyFullscreenOverlayImageToClipboard(img);
            }
            return;
        }
        
        // Spacebar to pause/unpause video
        if (e.code === 'Space') {
            if (overlay) return;
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
        
        // L to toggle looping (full video; turns off custom region loop or native loop too)
        if (e.code === 'KeyL') {
            if (overlay) return;
            const video = getTargetVideo(e);
            if (video) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const customLoopActive = loopVideo === video && loopRafId !== null;
                if (customLoopActive || video.loop) {
                    if (customLoopActive) clearLoop();
                    else video.loop = false;
                    showViewerToast('Loop off');
                } else {
                    loopIn = null;
                    loopOut = null;
                    startLooping(video);
                    showViewerToast('Loop on');
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

        // E: record loop region (I/O points or full video when L looping) to MP4 or WebM
        if (e.code === 'KeyE') {
            if (overlay) return;
            if (isKeyboardTypingTarget(e.target)) return;
            const video = getTargetVideo(e);
            if (video && getLoopRegionForVideo(video)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void exportLoopFragment(video);
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
            if (overlay) return;
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
    window.addEventListener('keydown', handleViewerKeydown, true);
    document.addEventListener('keydown', handleViewerKeydown, true);
    } // End of init()
    
    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
