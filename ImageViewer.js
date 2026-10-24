// ==UserScript==
// @name         ImageViewer
// @namespace    http://example.com/
// @version      2.40
// @description  Improves image and video UI on ChatGPT, Gemini, and Grok; browses local images in Chrome.
// @match        *://chatgpt.com/*
// @match        *://*.chatgpt.com/*
// @match        *://grok.com/*
// @match        *://*.grok.com/*
// @match        *://gemini.google.com/*
// @match        file:///*
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

    // Reserve capture priority at document-start, before Grok's type-to-focus
    // listener. DOM-dependent handlers are connected only after init completes.
    let viewerKeydownHandler = null;
    window.addEventListener('keydown', (e) => {
        if (viewerKeydownHandler) viewerKeydownHandler(e);
    }, true);

    // Local images use Chrome's directory document as the image index. This
    // avoids fetching file: URLs or requiring a separate folder permission.
    function localImageName(url) {
        try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); }
        catch { return ''; }
    }

    function collectLocalImages(links, folder) {
        const images = new Map();
        for (const link of links) {
            try {
                const url = new URL(link.getAttribute('href'), folder);
                if (url.protocol !== 'file:' || url.search || url.hash ||
                    new URL('.', url).href !== folder) continue;
                const name = localImageName(url.href);
                if (!/\.(?:avif|apng|bmp|gif|ico|jpe?g|jfif|png|svg|webp)$/i.test(name)) continue;
                images.set(url.href, { name, url: url.href });
            } catch { /* Ignore invalid directory links. */ }
        }
        const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: false });
        return [...images.values()].sort((a, b) =>
            collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }

    function initLocalImageViewer() {
        if (window.top !== window) return;
        const current = new URL(location.href);
        if (document.contentType?.startsWith('image/') && !current.pathname.endsWith('/')) {
            const folder = new URL('.', current);
            folder.hash = 'iv-image=' + encodeURIComponent(localImageName(current.href));
            location.replace(folder.href);
            return;
        }
        if (!current.pathname.endsWith('/') || !current.hash.startsWith('#iv-image=')) return;
        const folder = new URL('.', current).href;
        // Wait for all of Chrome's streamed directory rows before taking the index.
        if (document.readyState !== 'complete') {
            window.addEventListener('load', initLocalImageViewer, { once: true });
            return;
        }
        const images = collectLocalImages(document.querySelectorAll('a[href]'), folder);
        const selectedName = () => {
            try { return decodeURIComponent(location.hash.slice('#iv-image='.length)); }
            catch { return ''; }
        };
        let index = images.findIndex(image => image.name === selectedName());
        const viewer = document.createElement('div');
        viewer.id = 'iv-local-viewer';
        viewer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;color:#eee;display:flex;flex-direction:column;font:14px system-ui,sans-serif';
        const stage = document.createElement('div');
        stage.style.cssText = 'flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:flex-start;overflow:auto';
        const image = document.createElement('img');
        image.style.cssText = 'display:block;flex-shrink:0;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;margin:auto;cursor:zoom-in';
        stage.append(image);
        viewer.append(stage);
        document.body.append(viewer);
        let nativeSize = false;
        const toggleSize = () => {
            nativeSize = !nativeSize;
            image.style.maxWidth = nativeSize ? 'none' : '100%';
            image.style.maxHeight = nativeSize ? 'none' : '100%';
            image.style.cursor = nativeSize ? 'zoom-out' : 'zoom-in';
            stage.scrollTop = 0;
            stage.scrollLeft = 0;
        };
        image.addEventListener('click', toggleSize);
        const render = () => {
            if (index < 0) {
                image.style.display = 'none';
                document.title = 'Image not found — ImageViewer';
                return;
            }
            image.style.display = 'block';
            image.alt = images[index].name;
            image.src = images[index].url;
            stage.scrollTop = 0;
            stage.scrollLeft = 0;
            document.title = images[index].name + ' — ImageViewer';
        };
        image.addEventListener('error', () => {
            if (index >= 0) document.title = `Cannot display ${images[index].name} — ImageViewer`;
        });
        const navigate = direction => {
            const target = index + direction;
            if (index < 0 || target < 0 || target >= images.length) return;
            index = target;
            history.replaceState(null, '', '#iv-image=' + encodeURIComponent(images[index].name));
            render();
        };
        let help = null;
        let helpDismissKey = null;
        let modifierTap = null;
        let fullscreenBusy = false;
        let scrollFrame = null;
        let scrollTime = 0;
        const scrollKeys = new Set();
        const stopScroll = () => {
            scrollKeys.clear();
            if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
            scrollFrame = null;
            scrollTime = 0;
        };
        const scrollTick = now => {
            if (!nativeSize || help || !scrollKeys.size) { stopScroll(); return; }
            const direction = Number(scrollKeys.has('ArrowDown')) - Number(scrollKeys.has('ArrowUp'));
            if (scrollTime) stage.scrollTop += direction * 720 * Math.min((now - scrollTime) / 1000, 0.05);
            scrollTime = now;
            scrollFrame = requestAnimationFrame(scrollTick);
        };
        const showHelp = () => {
            stopScroll();
            help = document.createElement('div');
            help.id = 'iv-local-help';
            help.setAttribute('role', 'dialog');
            help.setAttribute('aria-modal', 'true');
            help.setAttribute('aria-label', 'Local image shortcuts');
            help.tabIndex = -1;
            help.style.cssText = 'position:absolute;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:1';
            const panel = document.createElement('div');
            panel.style.cssText = 'background:#18181b;padding:24px;border-radius:14px;max-height:85%;overflow:auto;line-height:1.8';
            const heading = document.createElement('strong');
            heading.textContent = 'Local image shortcuts';
            panel.append(heading);
            const entries = [
                ['← / ⌘ / Alt', 'Previous image (⌘ and Alt pressed alone)'],
                ['→ / Space', 'Next image'],
                ['↑ / ↓', 'Scroll in native-resolution mode'],
                ['. / Click image', 'Toggle fit / native resolution'],
                ['R', 'Random different image'],
                ['B / F / /', 'Toggle browser fullscreen'],
                ['Esc', 'Exit fullscreen; otherwise return to folder'],
                ['H', 'Show this help'],
            ];
            for (const [keys, description] of entries) {
                const row = document.createElement('div');
                const label = document.createElement('b');
                label.textContent = keys + ' — ';
                row.append(label, document.createTextNode(description));
                panel.append(row);
            }
            const hint = document.createElement('div');
            hint.textContent = 'Press any unmodified key or click to dismiss.';
            panel.append(hint);
            help.append(panel);
            help.addEventListener('click', closeHelp);
            viewer.append(help);
            help.focus();
        };
        const closeHelp = () => {
            help?.remove();
            help = null;
            stage.focus({ preventScroll: true });
        };
        stage.tabIndex = -1;
        stage.style.outline = 'none';
        const toggleFullscreen = async () => {
            if (fullscreenBusy) return;
            fullscreenBusy = true;
            stopScroll();
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await viewer.requestFullscreen();
            } catch (error) {
                console.warn('[ImageViewer] Local fullscreen failed:', error);
            } finally {
                fullscreenBusy = false;
            }
        };
        const consume = e => { e.preventDefault(); e.stopImmediatePropagation(); };
        viewerKeydownHandler = e => {
            if (e.code === helpDismissKey) { consume(e); return; }
            // Wait for modifier release so Cmd+C, Alt+Left, etc. never navigate.
            const modifier = e.key === 'Meta' || e.key === 'Alt';
            if (modifier && !e.repeat) {
                modifierTap = !help && !e.isComposing && !e.ctrlKey && !e.shiftKey &&
                    !(e.key === 'Meta' ? e.altKey : e.metaKey) ? e.key : null;
                return;
            }
            if (!modifier) modifierTap = null;
            if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (help) {
                consume(e);
                if (!e.repeat) { helpDismissKey = e.code; closeHelp(); }
                return;
            }
            if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            const code = e.code;
            if (!['Period', 'KeyR', 'KeyH', 'KeyB', 'KeyF', 'Slash', 'Escape',
                'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)) return;
            consume(e);
            if (code === 'ArrowUp' || code === 'ArrowDown') {
                if (nativeSize && stage.scrollHeight > stage.clientHeight) {
                    scrollKeys.add(code);
                    if (scrollFrame === null) scrollFrame = requestAnimationFrame(scrollTick);
                }
                return;
            }
            if (code === 'ArrowLeft') { navigate(-1); return; }
            if (code === 'ArrowRight' || code === 'Space') { navigate(1); return; }
            if (e.repeat) return;
            if (code === 'Period') { stopScroll(); toggleSize(); }
            else if (code === 'KeyH') showHelp();
            else if (code === 'KeyR' && images.length > 1 && index >= 0) {
                const pick = Math.floor(Math.random() * (images.length - 1));
                navigate((pick >= index ? pick + 1 : pick) - index);
            } else if (code === 'Escape') {
                stopScroll();
                if (document.fullscreenElement) void toggleFullscreen();
                else location.assign(folder);
            } else if (['KeyB', 'KeyF', 'Slash'].includes(code)) void toggleFullscreen();
        };
        window.addEventListener('keyup', e => {
            if (e.code === helpDismissKey) helpDismissKey = null;
            if (e.key === modifierTap) {
                modifierTap = null;
                if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !help && !e.isComposing) {
                    consume(e);
                    navigate(-1);
                }
            }
            scrollKeys.delete(e.code);
            if (!scrollKeys.size) stopScroll();
        }, true);
        window.addEventListener('blur', () => { modifierTap = null; helpDismissKey = null; stopScroll(); });
        window.addEventListener('pagehide', stopScroll);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { modifierTap = null; stopScroll(); }
        });
        document.addEventListener('fullscreenchange', stopScroll);
        window.addEventListener('hashchange', () => {
            if (!location.hash.startsWith('#iv-image=')) { location.reload(); return; }
            index = images.findIndex(item => item.name === selectedName());
            render();
        });
        render();
    }

    // Wait for DOM to be ready before checking
    function init() {
        if (location.protocol === 'file:') {
            initLocalImageViewer();
            return;
        }
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
    let ivChatGPTNavigationDebug = null;
    let ivChatGPTGallery = null;
    let imageNavigationSearch = null;
    if (isChatGPTHost()) {
        const style = document.createElement('style');
        style.textContent = '[data-app-action-timeline-scroll]:focus-visible { outline: none !important; box-shadow: none !important; }';
        document.head.appendChild(style);
    }
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

    function onOverlayWheel(e) {
        if (!overlay || !overlayFitNative) return;

        const linePx = 16;
        const xScale = e.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? linePx
            : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? overlay.clientWidth
              : 1;
        const yScale = e.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? linePx
            : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? overlay.clientHeight
              : 1;

        e.preventDefault();
        e.stopPropagation();
        overlay.scrollLeft += e.deltaX * xScale;
        overlay.scrollTop += e.deltaY * yScale;
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

    /** true: DevTools console logs fullscreen exit / resync steps. Set false normally. */
    const IV_FULLSCREEN_EXIT_DEBUG = false;

    function ivFullscreenDebugSnapshot(extra) {
        const fsEl =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement;
        let displayMode = null;
        try {
            displayMode = window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches;
        } catch (e) {}
        const snap = {
            api: isFullscreenApiActive(),
            visual: isBrowserWindowVisuallyFullscreen(),
            overlay: !!overlay,
            pending: ivPendingVisualFullscreenExit,
            intentional: ivIntentionalFullscreenExit,
            contextMenu: ivContextMenuInFullscreen,
            userAct: hasTransientUserActivation(),
            fsTag: fsEl ? fsEl.tagName : null,
            displayMode,
            webkitIsFullScreen: document.webkitIsFullScreen,
            ih: window.innerHeight,
            iw: window.innerWidth,
            oh: window.outerHeight,
            ow: window.outerWidth,
            sh: window.screen.availHeight || window.screen.height,
            sw: window.screen.availWidth || window.screen.width,
            screenH: window.screen.height,
        };
        if (extra) Object.assign(snap, extra);
        return snap;
    }

    function ivLogFullscreenExit(message, detail) {
        if (!IV_FULLSCREEN_EXIT_DEBUG) return;
        const snap = ivFullscreenDebugSnapshot(detail);
        let text;
        try {
            text = JSON.stringify(snap);
        } catch (e) {
            text = String(snap);
        }
        console.log('[Image Viewer fullscreen exit] ' + message + ' ' + text);
    }

    function isFullscreenApiActive(doc) {
        doc = doc || document;
        return !!(
            doc.fullscreenElement ||
            doc.webkitFullscreenElement ||
            doc.mozFullScreenElement ||
            doc.msFullscreenElement
        );
    }

    function hasTransientUserActivation() {
        try {
            if (navigator.userActivation) return !!navigator.userActivation.isActive;
        } catch (e) {}
        return true;
    }

    let ivIntentionalFullscreenExit = false;
    let galleryInPage = false;
    let galleryFullscreenPending = false;
    let ivPendingVisualFullscreenExit = false;
    let ivStuckFsElement = null;
    /** Right-click while fullscreen can desync API vs window; only then do enter→exit. */
    let ivContextMenuInFullscreen = false;

    /** Heuristic: browser window still chromeless even though the Fullscreen API already exited. */
    function isBrowserWindowVisuallyFullscreen() {
        try {
            if (window.matchMedia) {
                if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
            }
        } catch (e) {}
        if (document.webkitIsFullScreen === true) return true;
        const margin = 80;
        const ih = window.innerHeight;
        const iw = window.innerWidth;
        const oh = window.outerHeight;
        const ow = window.outerWidth;
        const sh = window.screen.availHeight || window.screen.height;
        const sw = window.screen.availWidth || window.screen.width;
        if (ih >= sh - margin && iw >= sw - margin) return true;
        if (oh >= sh - margin && ow >= sw - margin) return true;
        if (ih >= window.screen.height - 50) return true;
        return false;
    }

    function resyncStuckBrowserFullscreen(elementForReentry, options) {
        options = options || {};
        const doc = document;
        const exitFn =
            doc.exitFullscreen ||
            doc.webkitExitFullscreen ||
            doc.mozCancelFullScreen ||
            doc.msExitFullscreen;
        if (!exitFn) return Promise.resolve();

        if (!options.allowEnter || !hasTransientUserActivation()) {
            ivLogFullscreenExit('resync exit-only', {
                allowEnter: !!options.allowEnter,
                userActivation: hasTransientUserActivation(),
            });
            return Promise.resolve(exitFn.call(doc)).catch((err) => {
                ivLogFullscreenExit('resync exit-only failed', { message: err && err.message });
            });
        }

        const el = elementForReentry || document.documentElement;
        const requestFn =
            el.requestFullscreen ||
            el.webkitRequestFullscreen ||
            el.mozRequestFullScreen ||
            el.msRequestFullscreen;
        if (!requestFn) {
            return Promise.resolve(exitFn.call(doc)).catch((err) => {
                ivLogFullscreenExit('resync failed', { message: err && err.message });
            });
        }
        ivLogFullscreenExit('resync enter→exit (user gesture)');
        try {
            const entered = requestFn.call(el);
            return Promise.resolve(entered)
                .then(() => exitFn.call(doc))
                .catch((err) => {
                    ivLogFullscreenExit('resync failed', { message: err && err.message });
                });
        } catch (err) {
            ivLogFullscreenExit('resync failed', { message: err && err.message });
            return Promise.resolve();
        }
    }

    function scheduleFullscreenExitResync(elementForReentry, options) {
        options = options || {};
        const el = elementForReentry || document.documentElement;
        const force = !!options.force;
        const allowEnterNow = !!options.allowEnter && hasTransientUserActivation();

        const maybeResync = (label, canEnter) => {
            if (document.hidden) {
                ivLogFullscreenExit('skip resync: document hidden', { label });
                return;
            }
            if (isFullscreenApiActive()) {
                ivLogFullscreenExit('skip resync: API still fullscreen', { label });
                return;
            }
            const visual = isBrowserWindowVisuallyFullscreen();
            if (!force && !visual) {
                ivLogFullscreenExit('skip resync: not visually fullscreen', { label, force, visual });
                return;
            }
            ivLogFullscreenExit(canEnter ? 'resync enter→exit' : 'resync exit-only (scheduled)', {
                label,
                force,
                visual,
            });
            void resyncStuckBrowserFullscreen(el, { allowEnter: canEnter });
        };

        maybeResync('0ms', allowEnterNow);
        setTimeout(() => maybeResync('100ms', false), 100);
        setTimeout(() => maybeResync('300ms', false), 300);
    }

    function resyncAfterContextMenu(elementForReentry, options) {
        options = options || {};
        if (!ivContextMenuInFullscreen) return false;
        if (options.requireVisual && !isBrowserWindowVisuallyFullscreen()) return false;
        const el = elementForReentry || document.documentElement;
        if (hasTransientUserActivation()) {
            void resyncStuckBrowserFullscreen(el, { allowEnter: true });
        } else {
            armStuckVisualFullscreenExit(el);
        }
        scheduleFullscreenExitResync(el, options.force ? { force: true } : {});
        ivContextMenuInFullscreen = false;
        return true;
    }

    function armStuckVisualFullscreenExit(elementForReentry) {
        ivPendingVisualFullscreenExit = true;
        ivStuckFsElement = elementForReentry || document.documentElement;
        ivLogFullscreenExit('armed stuck visual fullscreen exit');
        if (!hasTransientUserActivation()) return;
        void resyncStuckBrowserFullscreen(ivStuckFsElement, { allowEnter: true }).then(() => {
            if (isFullscreenApiActive() || isBrowserWindowVisuallyFullscreen()) return;
            ivPendingVisualFullscreenExit = false;
            clearOverlay();
        });
    }

    function consumeStuckVisualFullscreenExit(e) {
        if (!ivPendingVisualFullscreenExit) return false;
        if (isFullscreenApiActive()) {
            ivLogFullscreenExit('consume skip: API still fullscreen (disarm)', {
                ev: e && e.type,
                target: e && e.target && e.target.tagName,
            });
            ivPendingVisualFullscreenExit = false;
            return false;
        }
        if (!isBrowserWindowVisuallyFullscreen()) {
            ivLogFullscreenExit('consume skip: not visually fullscreen (disarm)', {
                ev: e && e.type,
                target: e && e.target && e.target.tagName,
            });
            ivPendingVisualFullscreenExit = false;
            return false;
        }
        if (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        ivPendingVisualFullscreenExit = false;
        ivIntentionalFullscreenExit = true;
        ivLogFullscreenExit('consume stuck visual fullscreen exit (user gesture)', {
            ev: e && e.type,
            target: e && e.target && e.target.tagName,
        });
        clearOverlay();
        void resyncStuckBrowserFullscreen(ivStuckFsElement, { allowEnter: true });
        return true;
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

    function isChatGPTHost() {
        const h = location.hostname;
        return h === 'chatgpt.com' || h.endsWith('.chatgpt.com');
    }

    /** Temporary diagnostics: set false after investigating ChatGPT's virtualized timeline. */
    const IV_CHATGPT_NAVIGATION_DEBUG = false;

    function createChatGPTNavigationDebug() {
        if (!IV_CHATGPT_NAVIGATION_DEBUG || !isChatGPTHost()) return null;
        const prefix = '[ImageViewer ChatGPT navigation]';
        const turnSelector = '[data-turn-key], [data-testid^="conversation-turn-"]';
        const timelineSelector = '[data-app-action-timeline-scroll]';
        const nodeIds = new WeakMap();
        let nextNodeId = 1;
        let previous = null;
        let timer = null;
        let running = false;
        let sequence = 0;
        const pending = new Set();
        const events = [];
        const maxEvents = 300;

        function nodeId(node) {
            if (!node) return null;
            if (!nodeIds.has(node)) nodeIds.set(node, nextNodeId++);
            return nodeIds.get(node);
        }

        // Compare complete URLs without putting signed URLs, image bytes, or chat text in logs.
        function sourceId(src) {
            if (!src) return null;
            let hash = 2166136261;
            for (let i = 0; i < src.length; i++) hash = Math.imul(hash ^ src.charCodeAt(i), 16777619);
            return `${src.split(':', 1)[0]}:${(hash >>> 0).toString(16)}`;
        }

        function turnKey(turn) {
            return turn?.getAttribute('data-turn-key') || turn?.getAttribute('data-testid') || null;
        }

        function imageState(img) {
            if (!img) return null;
            const turn = img.closest(turnSelector);
            const message = img.closest('[data-chatgpt-search-message-ids], [data-message-id]');
            const rect = img.getBoundingClientRect();
            return {
                node: nodeId(img), turn: turnKey(turn),
                message: message?.getAttribute('data-chatgpt-search-message-ids') ||
                    message?.getAttribute('data-message-id') || null,
                src: sourceId(img.src), currentSrc: sourceId(img.currentSrc),
                connected: img.isConnected, skipped: isExcludedImage(img),
                complete: img.complete, natural: [img.naturalWidth, img.naturalHeight],
                size: [Math.round(rect.width), Math.round(rect.height)],
                inViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
                    rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
            };
        }

        function snapshot() {
            const timeline = document.querySelector(timelineSelector);
            const root = timeline || document;
            return {
                // Hash the route as well so SPA chat switches can be distinguished.
                route: sourceId(location.origin + location.pathname),
                timeline: timeline ? {
                    node: nodeId(timeline), top: Math.round(timeline.scrollTop),
                    height: timeline.scrollHeight, viewport: timeline.clientHeight,
                    direction: getComputedStyle(timeline).flexDirection,
                } : null,
                turns: Array.from(root.querySelectorAll(turnSelector), (turn) => ({
                    key: turnKey(turn), node: nodeId(turn),
                    state: turn.querySelector('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state') || null,
                    images: turn.querySelectorAll('img').length,
                })),
                images: Array.from(root.querySelectorAll('img')).filter((img) => !overlay?.contains(img)).map(imageState),
                gallery: {
                    open: !!overlay, index: currentIndex, count: imgs.length,
                    detached: imgs.filter((img) => !img.isConnected).map(nodeId),
                    nodes: imgs.map(nodeId), selected: imageState(imgs[currentIndex]),
                    displayed: imageState(overlay ? overlayImage : null),
                },
            };
        }

        function record(event, detail = {}) {
            if (!running) return;
            const state = snapshot();
            const sameRoute = previous?.route === state.route;
            const oldImages = new Map((sameRoute ? previous.images : []).map((img) => [img.node, img]));
            const newImages = new Map(state.images.map((img) => [img.node, img]));
            const oldTurns = new Set((sameRoute ? previous.turns : []).map((turn) => turn.key));
            const newTurns = new Set(state.turns.map((turn) => turn.key));
            const entry = {
                sequence: ++sequence, time: new Date().toISOString(), event, ...detail,
                changes: {
                    routeChanged: !!previous && !sameRoute,
                    turnsAdded: [...newTurns].filter((key) => !oldTurns.has(key)),
                    turnsRemoved: [...oldTurns].filter((key) => !newTurns.has(key)),
                    imagesAdded: state.images.filter((img) => !oldImages.has(img.node)).map((img) => img.node),
                    imagesRemoved: [...oldImages.keys()].filter((id) => !newImages.has(id)),
                    sourcesChanged: state.images.filter((img) => {
                        const old = oldImages.get(img.node);
                        return old && (old.src !== img.src || old.currentSrc !== img.currentSrc);
                    }).map((img) => img.node),
                },
                ...state,
            };
            previous = state;
            events.push(entry);
            if (events.length > maxEvents) events.shift();
            // Serialize now: DevTools otherwise shows mutable objects at inspection time.
            console.log(prefix + ' ' + JSON.stringify(entry));
            return entry;
        }

        function schedule(reason) {
            if (!running) return;
            pending.add(reason);
            if (timer !== null) return;
            // Throttle (not debounce) so continuous scrolling still produces samples.
            timer = setTimeout(() => {
                timer = null;
                const reasons = [...pending];
                pending.clear();
                record('timeline-update', { reasons });
            }, 250);
        }

        function relevant(node) {
            return node.nodeType === 1 && !overlay?.contains(node) &&
                (node.matches(`${timelineSelector}, ${turnSelector}, img`) ||
                    !!node.querySelector(`${timelineSelector}, ${turnSelector}, img`));
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (overlay?.contains(mutation.target)) continue;
                if (mutation.type === 'attributes' ||
                    [...mutation.addedNodes, ...mutation.removedNodes].some(relevant)) {
                    schedule('dom');
                    break;
                }
            }
        });
        const onScroll = (event) => {
            if (event.target === document || event.target.matches?.(timelineSelector)) schedule('scroll');
        };
        const onImageEvent = (event) => {
            if (event.target.tagName !== 'IMG') return;
            record('image-' + event.type, { image: imageState(event.target) });
        };

        const api = {
            record,
            snapshot: () => record('manual-snapshot'),
            export: () => JSON.stringify({ schema: 1, maxEvents, totalEvents: sequence, events }, null, 2),
            clear() { events.length = 0; previous = null; sequence = 0; },
            start() {
                if (running) return;
                running = true;
                observer.observe(document.body, {
                    childList: true, subtree: true, attributes: true,
                    attributeFilter: ['src', 'srcset', 'data-turn-key', 'data-talvt-turn-state'],
                });
                document.addEventListener('scroll', onScroll, true);
                document.addEventListener('load', onImageEvent, true);
                document.addEventListener('error', onImageEvent, true);
                record('start');
            },
            stop() {
                if (!running) return;
                record('stop');
                running = false;
                observer.disconnect();
                document.removeEventListener('scroll', onScroll, true);
                document.removeEventListener('load', onImageEvent, true);
                document.removeEventListener('error', onImageEvent, true);
                clearTimeout(timer);
                timer = null;
                pending.clear();
            },
        };
        window.__ivChatGPTDebug = api;
        console.info(prefix + ' enabled. Export: copy(__ivChatGPTDebug.export()). Stop: __ivChatGPTDebug.stop()');
        api.start();
        return api;
    }

    // The timeline only mounts a small window of turns. Keep discovered images independent
    // of those DOM nodes and own the blob URLs so unmounting cannot revoke our images.
    function createChatGPTGallery() {
        if (!isChatGPTHost()) return null;
        const timelineSelector = '[data-app-action-timeline-scroll]';
        const turnSelector = '[data-turn-key], [data-testid^="conversation-turn-"]';
        const records = new Map();
        const imageKeys = new WeakMap();
        const turnPositions = new Map();
        // Stable image keys at confirmed ends of this conversation's gallery.
        const knownEnds = new Map();
        let discardedTurns = new WeakMap();
        let discardedImages = new WeakMap();
        let editingTurn = null;
        let turnOrder = [];
        let conversation = null;
        let conversationPath = location.pathname;
        let departedConversation = null;
        let pageHidden = false;
        let generation = 0;
        let bytes = 0;
        let run = null;
        let passive = newPassiveSession();
        const maxBytes = 512 * 1024 * 1024;
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const turnKey = (turn) => turn.getAttribute('data-turn-key') || turn.getAttribute('data-testid');
        const timeline = () => document.querySelector(timelineSelector);
        const conversationId = () => document.querySelector('[data-map-composer-conversation]')?.getAttribute('data-map-composer-conversation') ||
            timeline()?.querySelector('[data-chatgpt-selection-conversation-id]')?.getAttribute('data-chatgpt-selection-conversation-id') ||
            location.pathname.match(/\/c\/([^/]+)/)?.[1] || null;
        const log = (event, detail) => ivChatGPTNavigationDebug?.record('scan-' + event, detail);

        function newPassiveSession() {
            return { passive: true, cancelled: false, controllers: new Set(), attempted: new WeakMap() };
        }

        function reset(reason = 'conversation-change') {
            editingTurn = null;
            discardedTurns = new WeakMap();
            discardedImages = new WeakMap();
            if (run) {
                run.cancelReason = reason;
                log('reset', { reason, ...scanState(run) });
                run.cancelled = true;
                for (const controller of run.controllers) controller.abort();
            }
            passive.cancelled = true;
            for (const controller of passive.controllers) controller.abort();
            passive = newPassiveSession();
            generation++;
            for (const record of records.values()) {
                if (record.url) URL.revokeObjectURL(record.url);
            }
            records.clear();
            knownEnds.clear();
            turnOrder = [];
            turnPositions.clear();
            bytes = 0;
            // Also release any previous gallery proxies held by the viewer.
            if (overlay) clearOverlay();
            imgs = [];
            currentIndex = -1;
        }

        function syncConversation() {
            if (pageHidden) return null;
            if (conversationPath !== location.pathname) {
                departedConversation = conversation || departedConversation;
                conversationPath = location.pathname;
                reset('page-navigation');
                conversation = null;
            }
            const id = conversationId();
            // SPA routes change before the old conversation DOM is removed.
            // Do not repopulate the released cache from that outgoing timeline.
            if (departedConversation && id === departedConversation &&
                location.pathname.match(/\/c\/([^/]+)/)?.[1] !== id) return null;
            if (id) departedConversation = null;
            if (id !== conversation) {
                reset();
                conversation = id;
            }
            return id;
        }

        function mergeTurns(keys) {
            // Prefer overlapping turn IDs. Manual jumps can visit disjoint windows in
            // any order, so use their distance from the bottom when no neighbour is known.
            for (let i = keys.length - 1; i >= 0; i--) {
                const key = keys[i];
                if (turnOrder.includes(key)) continue;
                const next = keys.slice(i + 1).find((k) => turnOrder.includes(k));
                const prev = keys.slice(0, i).reverse().find((k) => turnOrder.includes(k));
                const position = turnPositions.get(key);
                const before = turnOrder.findIndex((k) => turnPositions.get(k) < position);
                const at = next ? turnOrder.indexOf(next) : prev ? turnOrder.indexOf(prev) + 1 :
                    before >= 0 ? before : turnOrder.length;
                turnOrder.splice(at, 0, key);
                // Discovering older history cannot invalidate the newer end (and vice versa).
                for (const [direction, endKey] of knownEnds) {
                    const endTurn = JSON.parse(endKey)[0];
                    if ((turnOrder.indexOf(key) - turnOrder.indexOf(endTurn)) * direction > 0) {
                        knownEnds.delete(direction);
                    }
                }
            }
        }

        function mounted() {
            const root = timeline();
            if (!root) return [];
            const turns = Array.from(root.querySelectorAll(turnSelector)).filter((turn) =>
                discardedTurns.get(turn) !== turnKey(turn));
            const top = root.getBoundingClientRect().top;
            const distance = fromBottom(root);
            for (const turn of turns) {
                turnPositions.set(turnKey(turn), distance - (turn.getBoundingClientRect().top - top));
            }
            mergeTurns(turns.map(turnKey));
            const result = [];
            for (const turn of turns) {
                const slots = new Map();
                const groupedImages = new Map();
                const groupOrders = new Map();
                const seen = new Set();
                let order = 0;
                for (const img of turn.querySelectorAll('img')) {
                    const owner = img.closest('[data-chatgpt-search-message-ids], [data-message-id]');
                    let message = owner?.getAttribute('data-chatgpt-search-message-ids') ||
                        owner?.getAttribute('data-message-id') || turnKey(turn);
                    let itemOrder;
                    let slot = slots.get(message) || 0;
                    slots.set(message, slot + 1);
                    const messageIds = [...new Set(message.trim().split(/\s+/))];
                    if (owner && messageIds.length > 1 && img.closest('button[data-testid="generated-image-preview"], [role="group"][aria-label="Generated images"] button[aria-label^="Show generated image "]')) {
                        if (!groupedImages.has(owner)) {
                            groupedImages.set(owner, Array.from(owner.querySelectorAll('img')).filter((node) =>
                                node.closest('[data-chatgpt-search-message-ids], [data-message-id]') === owner &&
                                node.closest('button[data-testid="generated-image-preview"], [role="group"][aria-label="Generated images"] button[aria-label^="Show generated image "]')));
                        }
                        const group = groupedImages.get(owner);
                        // Parallel generated messages share one wrapper in the two-column
                        // layout. Keep the same message identity as their separate layout.
                        // Images can mount out of order: image 2 may be the only
                        // <img> present while image 1 is still loading. Its preview
                        // number remains stable throughout that transition.
                        const preview = img.closest('button[data-testid="generated-image-preview"], [role="group"][aria-label="Generated images"] button[aria-label^="Show generated image "]');
                        const number = preview.getAttribute('aria-label')?.match(/^(?:Show )?Generated image (\d+)$/i);
                        const index = number ? Number(number[1]) - 1 :
                            group.length === messageIds.length ? group.indexOf(img) : -1;
                        // Do not cache an ambiguous temporary identity that would
                        // become a duplicate once the other image mounts.
                        if (index < 0 || index >= messageIds.length) continue;
                        if (!groupOrders.has(owner)) {
                            groupOrders.set(owner, order);
                            order += messageIds.length;
                        }
                        itemOrder = groupOrders.get(owner) + index;
                        message = messageIds[index];
                        slot = 0;
                    }
                    if (isExcludedImage(img)) continue;
                    const key = JSON.stringify([turnKey(turn), message, slot]);
                    if (discardedImages.get(img) === key) continue;
                    imageKeys.set(img, key);
                    // The picker and large preview represent the same generated image.
                    // Assign both nodes the key for clicks, but capture it only once.
                    if (seen.has(key)) continue;
                    seen.add(key);
                    itemOrder ??= order++;
                    const rect = img.getBoundingClientRect();
                    const position = distance - (rect.top + rect.height / 2 - top);
                    const record = records.get(key);
                    if (record) { record.position = position; record.order = itemOrder; }
                    result.push({ key, turn: turnKey(turn), order: itemOrder, img, position });
                }
            }
            // A selected second preview can precede the first picker image in the DOM.
            const ranks = new Map(turns.map((turn, index) => [turnKey(turn), index]));
            result.sort((a, b) => ranks.get(a.turn) - ranks.get(b.turn) || a.order - b.order);
            rememberMountedEnds(root, result);
            return result;
        }

        function rememberMountedEnds(root, items) {
            for (const [direction, endKey] of knownEnds) {
                const end = items.find((item) => item.key === endKey) || records.get(endKey);
                if (!end || items.some((item) => item.turn === end.turn &&
                    (item.order - end.order) * direction > 0)) knownEnds.delete(direction);
            }
            // Remember ends during passive capture, before the user scrolls away.
            // These are image identities, so recycled DOM nodes do not lose the evidence.
            for (const direction of [-1, 1]) {
                const item = direction < 0 ? items[0] : items[items.length - 1];
                if (item?.img.complete && item.img.naturalWidth && mountedBoundary(root, item.key, direction, items)) {
                    knownEnds.set(direction, item.key);
                }
            }
        }

        function rememberEditedTurn(turn) {
            if (!turn || !timeline()?.contains(turn) || !syncConversation()) return;
            mounted();
            editingTurn = { key: turnKey(turn), id: conversation };
        }

        function discardEditedBranch() {
            const edit = editingTurn;
            editingTurn = null;
            if (!edit || edit.id !== syncConversation()) return;
            const items = mounted();
            const order = run?.previousOrder?.includes(edit.key) ? run.previousOrder : turnOrder;
            const index = order.indexOf(edit.key);
            if (index < 0) return;
            const removed = new Set(order.slice(index));
            const currentTurnIndex = turnOrder.indexOf(edit.key);
            if (currentTurnIndex >= 0) for (const key of turnOrder.slice(currentTurnIndex)) removed.add(key);
            // Old DOM can remain mounted briefly after Send. Ignore those nodes until
            // they are replaced, while allowing new message IDs in a reused edit turn.
            for (const item of items) {
                if (removed.has(item.turn)) discardedImages.set(item.img, item.key);
            }
            for (const turn of timeline()?.querySelectorAll(turnSelector) || []) {
                const key = turnKey(turn);
                if (removed.has(key) && key !== edit.key) discardedTurns.set(turn, key);
            }
            cancel('edited-branch');
            passive.cancelled = true;
            for (const controller of passive.controllers) controller.abort();
            passive = newPassiveSession();
            generation++;
            let count = 0;
            for (const [key, record] of records) {
                if (!removed.has(record.turn)) continue;
                if (record.url) { URL.revokeObjectURL(record.url); bytes -= record.size; }
                records.delete(key);
                count++;
            }
            const retained = turnOrder.filter((key) => !removed.has(key));
            turnOrder = order.filter((key) => !removed.has(key));
            mergeTurns(retained);
            for (const key of removed) turnPositions.delete(key);
            knownEnds.clear();
            if (overlay) clearOverlay();
            imgs = [];
            currentIndex = -1;
            log('branch-discarded', { turn: edit.key, turns: removed.size, images: count });
            scheduleCapture();
        }

        const editInputSelector = 'textarea, [contenteditable="true"]';
        function isEditingTurn(turn) {
            return editingTurn && editingTurn.id === conversationId() && turn?.isConnected &&
                turnKey(turn) === editingTurn.key && !!turn.querySelector(editInputSelector);
        }
        document.addEventListener('click', (event) => {
            const button = event.target.closest?.('button');
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
            if (button.matches('[data-testid="send-button"]')) knownEnds.clear();
            const turn = button.closest(turnSelector);
            if (button.getAttribute('aria-label') === 'Edit message') {
                rememberEditedTurn(turn);
                return;
            }
            if (!isEditingTurn(turn)) return;
            const labels = [button.getAttribute('aria-label') || '', button.textContent].map((label) => label.trim());
            if (labels.some((label) => /^cancel$/i.test(label))) { editingTurn = null; return; }
            if (button.type === 'submit' || labels.some((label) => /^(send|submit|save(?: changes|\s*(?:&|and)\s*submit)?)$/i.test(label))) {
                discardEditedBranch();
            }
        }, true);
        document.addEventListener('focusin', (event) => {
            if (!event.target.matches?.(editInputSelector) ||
                !event.target.closest('[data-chatgpt-search-unit-key$=":user"], [data-message-author-role="user"]')) return;
            rememberEditedTurn(event.target.closest(turnSelector));
        });
        document.addEventListener('submit', (event) => {
            if (event.target.querySelector?.('[data-testid="send-button"]')) knownEnds.clear();
            if (isEditingTurn(event.target.closest?.(turnSelector))) discardEditedBranch();
        }, true);

        async function preserve(item, session) {
            let record = records.get(item.key);
            if (!record) {
                const image = document.createElement('img');
                imageKeys.set(image, item.key);
                record = { key: item.key, turn: item.turn, order: item.order, image, url: null, size: 0 };
                records.set(item.key, record);
            }
            record.order = item.order;
            record.position = item.position;
            const img = item.img;
            const pixels = img.naturalWidth * img.naturalHeight;
            if (record.pending || (record.url && record.pixels >= pixels)) return;
            if (!img.complete || !pixels) return;
            const src = img.currentSrc || img.src;
            const attempt = item.key + src;
            if (!src || (session.passive ? session.attempted.get(img) === src : session.attempted.has(attempt))) return;
            if (session.passive) session.attempted.set(img, src);
            else session.attempted.add(attempt);
            const epoch = generation;
            const controller = new AbortController();
            session.controllers.add(controller);
            record.pending = true;
            let timeout;
            try {
                const blob = await Promise.race([
                    (async () => {
                        try {
                            const response = await fetch(src, { signal: controller.signal });
                            if (!response.ok) throw new Error('Image fetch failed');
                            const fetched = await response.blob();
                            if (fetched.size && fetched.type.startsWith('image/')) return fetched;
                        } catch (e) {
                            if (controller.signal.aborted) throw e;
                        }
                        // Some pages block fetch(blob:) with CSP but allow reading decoded pixels.
                        if ((img.currentSrc || img.src) !== src) return null;
                        return clipboardPngBlobFromImageElement(img);
                    })(),
                    new Promise((_, reject) => {
                        timeout = setTimeout(() => { controller.abort(); reject(new Error('Image timed out')); }, 10000);
                    }),
                ]);
                if (epoch !== generation || session.cancelled || conversationId() !== conversation) return;
                if (!blob?.size) throw new Error('Image unavailable');
                if (bytes - record.size + blob.size > maxBytes) {
                    session.limit = true;
                    session.cancelReason = 'memory-limit';
                    session.cancelled = true;
                    if (session.passive) showViewerToast('Image cache full for this chat', 4000);
                    return;
                }
                const url = URL.createObjectURL(blob);
                if (record.url) URL.revokeObjectURL(record.url);
                bytes += blob.size - record.size;
                Object.assign(record, { url, size: blob.size, pixels, failed: false });
                record.image.src = url;
                record.image.alt = 'Chat image';
            } catch (e) {
                if (epoch === generation && !session.cancelled) {
                    record.failed = true;
                    log('image-unavailable', { reason: e.name || 'Error' });
                }
            } finally {
                clearTimeout(timeout);
                session.controllers.delete(controller);
                record.pending = false;
            }
        }

        function images() {
            if (!syncConversation() || !records.size) return null;
            const current = mounted();
            const available = new Map(current.map((item) => [item.key, item]));
            // Eligibility was checked on the source image before capture. Cached
            // copies no longer have the site's ancestor markup to inspect.
            for (const record of records.values()) {
                if (record.url) available.set(record.key, { ...record, img: record.image });
            }
            const ranks = new Map(turnOrder.map((key, i) => [key, i]));
            return [...available.values()].sort((a, b) =>
                (ranks.get(a.turn) ?? Infinity) - (ranks.get(b.turn) ?? Infinity) || a.order - b.order,
            ).map((item) => item.img);
        }

        function nearestImage() {
            const list = images() || [];
            const root = timeline();
            if (!root) return null;
            const center = fromBottom(root) - root.clientHeight / 2;
            let nearest = null;
            let bestDistance = Infinity;
            for (const img of list) {
                const record = records.get(imageKeys.get(img));
                const position = record?.position;
                if (!Number.isFinite(position)) continue;
                const distance = Math.abs(position - center);
                if (distance < bestDistance) { nearest = img; bestDistance = distance; }
            }
            return nearest;
        }

        function fromBottom(el) {
            return getComputedStyle(el).flexDirection === 'column-reverse'
                ? -el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop;
        }

        function setFromBottom(el, distance) {
            el.scrollTop = getComputedStyle(el).flexDirection === 'column-reverse'
                ? -distance : el.scrollHeight - el.clientHeight - distance;
        }

        function scanState(session) {
            return {
                navigation: !!session.navigation, hidden: document.hidden,
                visibility: document.visibilityState, focused: document.hasFocus(),
                cancelled: session.cancelled, cancelReason: session.cancelReason || null,
                epochMatches: session.epoch === generation, conversationMatches: session.id === conversationId(),
                timelineMatches: session.root === timeline(), rootConnected: session.root.isConnected,
                paused: session.pausedAt != null,
                pausedMs: Math.round((session.pausedMs || 0) +
                    (session.pausedAt != null ? performance.now() - session.pausedAt : 0)),
                distance: Math.round(fromBottom(session.root)),
                extent: session.root.scrollHeight - session.root.clientHeight,
            };
        }

        function active(session) {
            const valid = !session.cancelled && session.epoch === generation &&
                session.id === conversationId() && session.root === timeline() && session.root.isConnected;
            if (!valid && !session.inactiveLogged) {
                session.inactiveLogged = true;
                log('inactive', scanState(session));
            }
            return valid;
        }

        function signature(root) {
            return JSON.stringify([
                root.scrollHeight,
                ...Array.from(root.querySelectorAll(turnSelector), turnKey),
                ...Array.from(root.querySelectorAll('img'), (img) => [img.currentSrc || img.src, img.complete, img.naturalWidth]),
            ]);
        }

        function updateProgress(session) {
            if (!session.label) return;
            const count = [...records.values()].filter((record) => record.url).length;
            const status = session.pausedAt != null ? 'Scan paused until you return' : 'Loading chat images…';
            session.label.textContent = `${status} ${count} saved · Esc to cancel`;
        }

        function scanTime(session) {
            return (session.pausedAt ?? performance.now()) - (session.pausedMs || 0);
        }

        async function settle(session, minWait = null) {
            const start = scanTime(session);
            let changed = start;
            let previous = '';
            while (active(session)) {
                // Preserve full scans while background rendering is suspended.
                // Directional navigation retains its existing cancellation behavior.
                if (document.hidden) {
                    if (session.navigation) { session.cancelReason = 'navigation-hidden'; session.cancelled = true; break; }
                    if (!session.waitingForVisibility) {
                        session.waitingForVisibility = true;
                        log('waiting-for-visible', scanState(session));
                    }
                    await pause(200);
                    continue;
                }
                if (session.waitingForVisibility) {
                    session.waitingForVisibility = false;
                    log('resumed', scanState(session));
                }
                const items = mounted();
                for (const item of items) {
                    session.seen.add(item.key);
                    void preserve(item, session);
                }
                updateProgress(session);
                const next = signature(session.root);
                if (next !== previous) { previous = next; changed = scanTime(session); }
                const turns = Array.from(session.root.querySelectorAll(turnSelector));
                const alreadyChecked = turns.length > 0 && turns.every((turn) =>
                    session.checkedTurns.get(turn) === turnKey(turn));
                const pending = items.some((item) => !item.img.complete || !item.img.naturalWidth || records.get(item.key)?.pending) ||
                    !!session.root.querySelector('[aria-busy="true"], [role="progressbar"], [data-testid="generated-image-preview"]:not(:has(img))');
                const now = scanTime(session);
                // New/recycled turn nodes still get a loading window. Once inspected,
                // moving within the same content only needs a brief render/scroll check.
                const wait = minWait ?? (alreadyChecked ? 200 : 2500);
                const quiet = alreadyChecked && minWait === null ? 200 : 1000;
                if (now - start >= wait && now - changed >= quiet && !pending) {
                    for (const turn of turns) session.checkedTurns.set(turn, turnKey(turn));
                    return true;
                }
                if (now - start >= 12000) {
                    session.timeouts++;
                    log('section-timeout', { images: items.length });
                    return false;
                }
                await pause(200);
            }
            return false;
        }

        function nextScanStep(session, direction = -1) {
            const root = session.root;
            const overlapStep = Math.max(100, root.clientHeight * 0.7);
            const top = root.getBoundingClientRect().top + root.clientTop;
            const boundary = direction < 0 ? top : top + root.clientHeight;
            const turns = Array.from(root.querySelectorAll(turnSelector));
            const rects = turns.map((turn) => turn.getBoundingClientRect());
            const probe = boundary - direction;
            let index = rects.findIndex((rect) => rect.top <= probe && rect.bottom > probe);
            let edge = boundary;
            while (index >= 0 && index < turns.length) {
                const turn = turns[index];
                const rect = rects[index];
                if (session.checkedTurns.get(turn) !== turnKey(turn) ||
                    !turn.querySelector('[data-talvt-turn-state="complete"]') ||
                    turn.querySelector('img, picture, [data-testid="generated-image-gallery"], ' +
                        '[data-testid="generated-image-preview"], [data-image-transparency-backdrop-scope], ' +
                        '[aria-busy="true"], [role="progressbar"], [data-virtualized-turn-content]') ||
                    (direction < 0 ? rect.bottom < edge - 32 : rect.top > edge + 32)) break;
                edge = direction < 0 ? rect.top : rect.bottom;
                index += direction;
            }
            // Jump only inside contiguous, mounted, inspected text. Keep an overlap
            // before its far edge so the next unseen/image-bearing turn gets visited.
            const step = Math.max(overlapStep, (edge - boundary) * direction - root.clientHeight * 0.3);
            if (step > overlapStep) log('text-skip', { pixels: Math.round(step) });
            return step;
        }

        async function scan() {
            if (run?.navigation) { cancel('full-scan-started'); await run.done; }
            if (run) return;
            const id = syncConversation();
            const root = timeline();
            if (!id || !root) { showViewerToast('Open a ChatGPT conversation first'); return; }
            if (overlay) { hideFullscreen(); clearOverlay(); }
            hideViewerHotkeysModal();
            const panel = document.createElement('div');
            panel.id = 'iv-chatgpt-scan';
            panel.setAttribute('role', 'status');
            Object.assign(panel.style, {
                position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                zIndex: '2147483647', background: '#18181b', color: '#fafafa', padding: '12px 16px',
                border: '1px solid #71717a', borderRadius: '10px', font: '14px system-ui',
                display: 'flex', alignItems: 'center', gap: '16px',
            });
            const label = document.createElement('span');
            const cancelButton = document.createElement('button');
            cancelButton.textContent = 'Cancel';
            cancelButton.type = 'button';
            Object.assign(cancelButton.style, { padding: '6px 12px', borderRadius: '6px', background: '#3f3f46', color: 'white', cursor: 'pointer' });
            panel.append(label, cancelButton);
            document.body.appendChild(panel);
            const session = {
                root, id, epoch: generation, label, cancelled: false, timeouts: 0,
                pausedAt: null, pausedMs: 0,
                controllers: new Set(), attempted: new Set(), seen: new Set(),
                checkedTurns: new WeakMap(),
            };
            const previousOrder = turnOrder;
            session.previousOrder = previousOrder;
            knownEnds.clear();
            turnOrder = [];
            run = session;
            const onVisibilityChange = () => {
                if (document.hidden && session.pausedAt === null) {
                    session.pausedAt = performance.now();
                } else if (!document.hidden && session.pausedAt !== null) {
                    session.pausedMs += performance.now() - session.pausedAt;
                    session.pausedAt = null;
                }
                updateProgress(session);
                log('visibility', scanState(session));
            };
            document.addEventListener('visibilitychange', onVisibilityChange);
            onVisibilityChange();
            cancelButton.addEventListener('click', () => cancel('cancel-button'));
            const onManualScroll = (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
            };
            root.addEventListener('wheel', onManualScroll, { passive: false, capture: true });
            root.addEventListener('touchmove', onManualScroll, { passive: false, capture: true });
            const oldBehavior = root.style.getPropertyValue('scroll-behavior');
            const oldPriority = root.style.getPropertyPriority('scroll-behavior');
            const oldOverflow = root.style.getPropertyValue('overflow-y');
            const oldOverflowPriority = root.style.getPropertyPriority('overflow-y');
            // Hide the draggable scrollbar while retaining programmatic scrolling.
            root.style.setProperty('overflow-y', 'hidden', 'important');
            root.style.setProperty('scroll-behavior', 'auto', 'important');
            let completed = false;
            let stopReason = 'inactive';
            log('start', { diagnostics: 'visibility-pause-v1', ...scanState(session) });
            try {
                setFromBottom(root, 0);
                const started = scanTime(session);
                while (active(session)) {
                    const settled = await settle(session);
                    if (!active(session)) break;
                    if (scanTime(session) - started > 20 * 60 * 1000) { stopReason = 'duration-limit'; break; }
                    const distance = fromBottom(root);
                    const extent = root.scrollHeight - root.clientHeight;
                    if (distance >= extent - 2) {
                        const turns = Array.from(root.querySelectorAll(turnSelector));
                        // The normal settle already waited for image capture. Confirm
                        // every mounted turn up to the true start before skipping pagination delay.
                        if (settled && mountedTurnBoundary(root, turns[turns.length - 1], -1)) {
                            completed = true;
                            stopReason = 'mounted-top';
                            break;
                        }
                        // Reaching the current top can trigger another history page. Give it
                        // another quiet period and require unchanged turns and scroll extent.
                        const before = signature(root);
                        await settle(session, 4000);
                        if (!active(session)) break;
                        if (before === signature(root) && fromBottom(root) >= root.scrollHeight - root.clientHeight - 2) {
                            completed = true;
                            stopReason = 'confirmed-top';
                            break;
                        }
                        continue;
                    }
                    setFromBottom(root, distance + nextScanStep(session));
                }
            } catch (e) {
                stopReason = 'error';
                log('error', { reason: e.name || 'Error' });
            } finally {
                const exitState = scanState(session);
                session.cancelled = true;
                for (const controller of session.controllers) controller.abort();
                if (session.epoch === generation) {
                    turnOrder = [...previousOrder.filter((key) => !turnOrder.includes(key)), ...turnOrder];
                }
                // A full rescan also drops images removed by edits or a branch change.
                if (completed && !session.timeouts) {
                    for (const [key, record] of records) {
                        if (session.seen.has(key)) continue;
                        if (record.url) { URL.revokeObjectURL(record.url); bytes -= record.size; }
                        records.delete(key);
                    }
                    if ([...session.seen].every((key) => records.get(key)?.url)) {
                        const list = images() || [];
                        if (list.length) {
                            knownEnds.set(-1, imageKeys.get(list[0]));
                            knownEnds.set(1, imageKeys.get(list[list.length - 1]));
                        }
                    }
                }
                // Leave completed scans at the oldest turn, or cancelled scans where they stopped.
                root.style.setProperty('scroll-behavior', oldBehavior, oldPriority);
                root.style.setProperty('overflow-y', oldOverflow, oldOverflowPriority);
                root.removeEventListener('wheel', onManualScroll, true);
                root.removeEventListener('touchmove', onManualScroll, true);
                document.removeEventListener('visibilitychange', onVisibilityChange);
                panel.remove();
                run = null;
                if (session.id === conversationId()) {
                    const count = [...records.values()].filter((record) => record.url).length;
                    const failed = [...records.values()].filter((record) => record.failed && !record.url).length;
                    if (!completed || session.limit || session.timeouts || failed) {
                        const status = session.limit ? 'Memory limit reached' : completed ? 'Scan incomplete' : 'Scan stopped';
                        showViewerToast(`${status}: ${count} images saved${session.timeouts || failed ? ' · Some images may be missing; run again to retry' : ''}`, 6000);
                    }
                }
                log('finish', {
                    completed, reason: session.cancelReason || stopReason, exitState,
                    count: [...records.values()].filter((record) => record.url).length,
                    failed: [...records.values()].filter((record) => record.failed && !record.url).length,
                    timeouts: session.timeouts, bytes,
                });
                syncConversation();
                captureMounted();
            }
        }

        function cancel(reason = 'api', detail = {}) {
            if (!run) return;
            if (!run.cancelled) {
                run.cancelReason = reason;
                log('cancel', { reason, ...detail, ...scanState(run) });
            }
            run.cancelled = true;
            for (const controller of run.controllers) controller.abort();
        }

        // Recognize the virtualizer layout used by ChatGPT without assuming that
        // the first mounted turn (or fallback-turn-0) is the first chat turn.
        function mountedBoundary(root, key, direction, items) {
            const selected = items.find((item) => item.key === key);
            const turn = selected?.img.closest(turnSelector);
            if (!mountedTurnBoundary(root, turn, direction)) return false;
            const turns = Array.from(turn.parentElement.parentElement.querySelectorAll(turnSelector));
            const index = turns.indexOf(turn);
            const relevant = direction < 0 ? turns.slice(0, index + 1) : turns.slice(index);
            const another = items.some((item) => relevant.includes(item.img.closest(turnSelector)) &&
                (item.turn === selected.turn ? (item.order - selected.order) * direction > 0 : true));
            return !another;
        }

        // Shared structural check also works for text-only windows at the start of a scan.
        function mountedTurnBoundary(root, turn, direction) {
            if (!turn) return false;
            const row = turn?.parentElement;
            const block = row?.parentElement;
            const extent = block?.parentElement;
            const transcript = extent?.parentElement;
            if (!transcript?.matches('[data-chatgpt-conversation-selection-target]') ||
                !root.contains(transcript) || !extent.style.height || !block.style.marginTop) return false;
            const turns = Array.from(block.querySelectorAll(turnSelector));
            const index = turns.indexOf(turn);
            if (index < 0 || turns.length !== block.children.length ||
                turns.some((node, i) => node.parentElement !== block.children[i])) return false;
            const bounds = extent.getBoundingClientRect();
            const mountedBounds = block.getBoundingClientRect();
            if (bounds.height <= 0 || mountedBounds.height <= 0) return false;
            if (direction < 0) {
                if (Math.abs(mountedBounds.top - bounds.top) > 2) return false;
                // The pagination indicator sits before the extent, outside the turns.
                for (const sibling of transcript.children) {
                    if (sibling === extent) break;
                    if (!sibling.hidden && sibling.getBoundingClientRect().height > 0) return false;
                }
            } else if (Math.abs(mountedBounds.bottom - bounds.bottom) > 2) return false;
            const relevant = direction < 0 ? turns.slice(0, index + 1) : turns.slice(index);
            if (relevant.some((node) => !node.querySelector('[data-talvt-turn-state="complete"]') ||
                node.querySelector('[data-virtualized-turn-content], [aria-busy="true"], [role="progressbar"], ' +
                    '[data-testid="generated-image-preview"]:not(:has(img))'))) return false;
            return true;
        }

        async function findNext(selected, direction, isCurrent) {
            if ((run && !run.navigation) || !isCurrent()) return null;
            const id = syncConversation();
            const root = timeline();
            const key = imageKeys.get(selected);
            if (!id || !root || !key || !isCurrent()) return null;
            const items = mounted();
            if (knownEnds.get(direction) === key || mountedBoundary(root, key, direction, items)) return null;
            const record = records.get(key);
            const position = turnPositions.get(record?.turn);
            if (position === undefined) return null;
            const label = direction < 0 ? 'earlier' : 'later';
            const loadingMessage = `Looking for ${label} images… · Esc to close`;
            // Unknown boundaries need immediate feedback, including while an older
            // search is winding down. Confirmed ends have already returned above.
            showViewerToast(loadingMessage, 30000);
            if (run?.navigation) { cancel('navigation-replaced'); await run.done; }
            if (!isCurrent()) return null;
            if (run || id !== conversationId() || root !== timeline()) {
                hideViewerToast(loadingMessage);
                return null;
            }
            let finish;
            const session = {
                navigation: true, root, id, epoch: generation, cancelled: false, timeouts: 0,
                controllers: new Set(), attempted: new Set(), seen: new Set(), checkedTurns: new WeakMap(),
                done: new Promise((resolve) => { finish = resolve; }),
            };
            run = session;
            const oldBehavior = root.style.getPropertyValue('scroll-behavior');
            const oldPriority = root.style.getPropertyPriority('scroll-behavior');
            root.style.setProperty('scroll-behavior', 'auto', 'important');
            const onManualScroll = (event) => cancel('manual-' + event.type, { trusted: event.isTrusted });
            root.addEventListener('wheel', onManualScroll, { passive: true });
            root.addEventListener('touchstart', onManualScroll, { passive: true });
            log('navigation-start', { direction });
            let found = false;
            let reachedEnd = false;
            try {
                // The viewer may be showing a cached turn far from the mounted window.
                // Resume at that turn, rather than at the page's unrelated scroll position.
                setFromBottom(root, Math.max(0, Math.min(position, root.scrollHeight - root.clientHeight)));
                const started = performance.now();
                while (active(session) && isCurrent()) {
                    await settle(session);
                    if (!active(session) || !isCurrent()) break;
                    const list = images() || [];
                    const index = list.findIndex((img) => imageKeys.get(img) === key);
                    const next = index >= 0 ? list[index + direction] : null;
                    if (next && records.get(imageKeys.get(next))?.url) {
                        found = true;
                        return { list, index: index + direction };
                    }
                    if (performance.now() - started > 20 * 60 * 1000) break;
                    const distance = fromBottom(root);
                    const atEnd = () => direction < 0
                        ? fromBottom(root) >= root.scrollHeight - root.clientHeight - 2
                        : fromBottom(root) <= 2;
                    if (atEnd()) {
                        const before = signature(root);
                        await settle(session, 4000);
                        if (!active(session) || !isCurrent()) break;
                        // Pagination can add images without moving the viewport. Check
                        // them again before declaring that the chat has ended.
                        const updated = images() || [];
                        const at = updated.findIndex((img) => imageKeys.get(img) === key);
                        const candidate = at >= 0 ? updated[at + direction] : null;
                        if (candidate && records.get(imageKeys.get(candidate))?.url) {
                            found = true;
                            return { list: updated, index: at + direction };
                        }
                        if (before === signature(root) && atEnd()) { reachedEnd = true; break; }
                        continue;
                    }
                    setFromBottom(root, distance - direction * nextScanStep(session, direction));
                }
            } catch (e) {
                log('navigation-error', { reason: e.name || 'Error' });
            } finally {
                const cancelled = session.cancelled;
                session.cancelled = true;
                for (const controller of session.controllers) controller.abort();
                root.style.setProperty('scroll-behavior', oldBehavior, oldPriority);
                root.removeEventListener('wheel', onManualScroll);
                root.removeEventListener('touchstart', onManualScroll);
                if (run === session) run = null;
                finish();
                if (isCurrent() && session.id === conversationId()) {
                    const confirmedEnd = reachedEnd && !cancelled && !session.timeouts && !session.limit &&
                        [...session.seen].every((seenKey) => records.get(seenKey)?.url);
                    if (found) hideViewerToast(loadingMessage);
                    else if (confirmedEnd) {
                        knownEnds.set(direction, key);
                        hideViewerToast(loadingMessage);
                    } else showViewerToast(`Image search ${cancelled ? 'stopped' : 'incomplete'} · Press the arrow again to retry`, 4000);
                }
                log('navigation-finish', { direction, found, reachedEnd, timeouts: session.timeouts });
                captureMounted();
            }
            return null;
        }

        let observedRoot = null;
        let captureTimer = null;
        const observer = new MutationObserver((mutations) => {
            if (mutations.some((mutation) => mutation.type === 'childList' ||
                mutation.target.tagName === 'IMG' || mutation.attributeName === 'data-turn-key')) {
                scheduleCapture();
            }
        });

        function observeTimeline() {
            const root = timeline();
            if (root === observedRoot) return false;
            observer.disconnect();
            observedRoot = root;
            if (root) observer.observe(root, {
                childList: true, subtree: true, attributes: true,
                attributeFilter: ['src', 'srcset', 'style', 'class', 'data-turn-key'],
            });
            return true;
        }

        function captureMounted() {
            const id = syncConversation();
            observeTimeline();
            if (!id || passive.cancelled || (run && !run.cancelled)) return;
            for (const item of mounted()) void preserve(item, passive);
        }

        function scheduleCapture() {
            if (captureTimer !== null) return;
            captureTimer = setTimeout(() => { captureTimer = null; captureMounted(); }, 50);
        }

        document.addEventListener('load', (event) => {
            // Start copying immediately at load time, before a fast scroll can unmount
            // the turn. Overlay images live outside the timeline and are ignored.
            if (event.target.tagName === 'IMG' && event.target.closest(timelineSelector)) captureMounted();
        }, true);
        document.addEventListener('scroll', (event) => {
            if (event.target.matches?.(timelineSelector)) scheduleCapture();
        }, true);
        // Rebind after SPA navigation or replacement of the timeline, even without images.
        setInterval(() => {
            const previous = conversation;
            syncConversation();
            if (observeTimeline() || previous !== conversation) captureMounted();
        }, 1000);
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            history[method] = function (...args) {
                const result = original.apply(this, args);
                syncConversation();
                scheduleCapture();
                return result;
            };
        }
        window.addEventListener('popstate', () => { syncConversation(); scheduleCapture(); });
        window.addEventListener('pagehide', () => {
            pageHidden = true;
            reset('pagehide'); conversation = null;
            observer.disconnect(); observedRoot = null;
            clearTimeout(captureTimer); captureTimer = null;
        });
        window.addEventListener('pageshow', () => { pageHidden = false; scheduleCapture(); });
        captureMounted();
        return {
            scan, cancel, images, findNext, nearestImage,
            cancelNavigation() { if (run?.navigation) cancel('navigation-cancelled'); },
            get scanning() { return !!run && !run.navigation; },
            key: (img) => imageKeys.get(img),
            original(img) {
                const key = imageKeys.get(img);
                return mounted().find((item) => item.key === key)?.img || null;
            },
        };
    }

    // ChatGPT scrolls the conversation in a column-reverse container, while
    // the browser's native Cmd+Arrow shortcuts still target the document.
    // Restore the usual macOS jump-to-start/end behavior for the timeline.
    function handleChatGPTDocumentEdgeKeydown(e) {
        if (
            !isChatGPTHost() ||
            ivChatGPTGallery?.scanning ||
            overlay ||
            !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey ||
            (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') ||
            isKeyboardTypingTarget(e.target)
        ) {
            return;
        }

        const timeline = document.querySelector('[data-app-action-timeline-scroll]');
        if (!timeline || timeline.scrollHeight <= timeline.clientHeight + 1) return;

        const isReverse = getComputedStyle(timeline).flexDirection === 'column-reverse';
        const towardStart = e.key === 'ArrowUp';
        timeline.scrollTop = isReverse
            ? (towardStart ? -timeline.scrollHeight : 0)
            : (towardStart ? 0 : timeline.scrollHeight);

        e.preventDefault();
        e.stopImmediatePropagation();
    }

    window.addEventListener('keydown', handleChatGPTDocumentEdgeKeydown, true);

    function isChatGPTProfileImage(img) {
        if (!isChatGPTHost()) return false;
        let ancestor = img.parentElement;
        for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
            if (ancestor.querySelector(':scope > button[aria-label="Open profile menu"]')) return true;
        }
        return false;
    }

    function viewerImageSrcForNewTab(img) {
        return img.currentSrc || img.getAttribute('src') || img.src || '';
    }

    function isViewerOpenInTabImageSrc(src) {
        if (!src) return false;
        return /^https?:/i.test(src) || src.startsWith('blob:');
    }

    function imageFromEventTarget(target) {
        let el = target;
        if (!el || !el.nodeType) return null;
        if (el.nodeType !== 1) el = el.parentElement;
        if (!el) return null;
        if (el.tagName !== 'IMG') {
            // Fresh ChatGPT results can target the preview button instead of its image.
            const preview = isChatGPTHost()
                ? el.closest('button[data-testid="generated-image-preview"], [role="group"][aria-label="Generated images"] button[aria-label^="Show generated image "]')
                : null;
            el = preview ? preview.querySelector('img') : el.closest('img');
        }
        if (!el || el.tagName !== 'IMG' || isExcludedImage(el)) return null;
        return el;
    }

    function viewerImageFromEventTarget(target) {
        const img = imageFromEventTarget(target);
        return img && isViewerOpenInTabImageSrc(viewerImageSrcForNewTab(img)) ? img : null;
    }

    let ivLastPointerX = -1;
    let ivLastPointerY = -1;

    function viewerImageFromPointer() {
        if (ivLastPointerX < 0 || ivLastPointerY < 0) return null;
        return viewerImageFromEventTarget(document.elementFromPoint(ivLastPointerX, ivLastPointerY));
    }

    function viewerVideoFromPointer() {
        if (ivLastPointerX < 0 || ivLastPointerY < 0) return null;
        let el = document.elementFromPoint(ivLastPointerX, ivLastPointerY);
        if (!el) return null;
        let video = el.tagName === 'VIDEO' ? el : el.closest ? el.closest('video') : null;
        if (video && !isVideoVisibleForFullscreenTarget(video)) return null;
        return video;
    }

    /** Largest visible <video> (Grok post pages often list filmstrip thumbs before the hero video). */
    function pickBestVisibleVideo() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const minArea = 64;
        let best = null;
        let bestArea = -1;
        document.querySelectorAll('video').forEach((video) => {
            if (!isVideoVisibleForFullscreenTarget(video)) return;
            const r = video.getBoundingClientRect();
            const iw = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
            const ih = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            const area = iw * ih;
            if (area < minArea) return;
            if (area > bestArea) {
                bestArea = area;
                best = video;
            }
        });
        return best;
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
        // Imagine lightbox: the grid-position classes now live on a wrapper,
        // while the hero image is nested inside the explicit media frame.
        if (img.closest('[data-lightbox-media] [data-media-frame]') &&
            !img.closest('[data-filmstrip-item]')) return true;
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

    // One eligibility rule for clicking, navigation, and gallery capture. Apply
    // this to source images while their site-specific ancestors are still present.
    function isExcludedImage(img) {
        if (isGrokHost() && !isGrokOptInImage(img)) return true;
        if (isGeminiHost() && !isGeminiOptInImage(img)) return true;
        if (isChatGPTProfileImage(img)) return true;
        // The "Your dot" sidebar button renders its navigation icon as an image.
        if (isChatGPTHost() && img.closest('[data-sidebar-destination="builtin:orbit"]')) return true;
        // Source citations include small site logos inside favicon components.
        if (isChatGPTHost() && img.closest('[data-d-component="favicon"]')) return true;
        // ChatGPT renders inline SVG components as images in rich responses.
        if (isChatGPTHost() && img.getAttribute('data-d-component') === 'svg') return true;
        // ChatGPT web-search cards place the image beside an overlay Open button.
        if (isChatGPTHost() && img.closest('[data-d-component="image"][class~="group/search-image"]')) return true;
        const alt = img.getAttribute('alt');
        // Skip avatars: ChatGPT (alt="User") and Grok (alt="pfp")
        if (alt === 'User' || alt === 'pfp') return true;
        // Grok grid thumbnails (e.g. alt="Thumbnail 1")
        if (alt && /^Thumbnail\b/i.test(alt)) return true;
        // Grok compact selectable grid cards
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
        if (img.closest('div.flex.flex-col.gap-2')) {
            const grokOk = isGrokHost() && isGrokOptInImage(img);
            const geminiOk = isGeminiHost() && isGeminiOptInImage(img);
            // Fresh ChatGPT results use this layout too; allow their explicit preview button.
            const chatgptOk = isChatGPTHost() && !!img.closest('button[data-testid="generated-image-preview"], [role="group"][aria-label="Generated images"] button[aria-label^="Show generated image "]');
            if (!grokOk && !geminiOk && !chatgptOk) return true;
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
        cancelImageNavigationSearch();
        if (!overlay) return;
        ivChatGPTNavigationDebug?.record('overlay-close');
        ivLogFullscreenExit('clearOverlay');
        stopOverlayArrowScroll();
        stopCursorAutoHide();
        overlayNativeScrollBySrc.clear();
        overlay.removeEventListener('click', hideFullscreen);
        overlay.remove();
        overlay = null;
        galleryInPage = false;
    }

    // BROWSER BUG WORKAROUND: When user right-clicks and uses context menu (e.g., "Copy image"
    // or "Copy video frame") while in fullscreen, the browser decouples the Fullscreen API
    // state from the actual browser window fullscreen state. The API reports we're not in
    // fullscreen (fullscreenElement is null), but the browser window remains visually fullscreen.
    // To fix this, we re-enter fullscreen via the API to re-sync the states, then immediately
    // exit, which properly exits both API and window fullscreen.
    function exitFullscreenWithWorkaround(elementForReentry) {
        const doc = document;
        const exitFn =
            doc.exitFullscreen ||
            doc.webkitExitFullscreen ||
            doc.mozCancelFullScreen ||
            doc.msExitFullscreen;

        if (!exitFn) return Promise.resolve();

        ivIntentionalFullscreenExit = true;
        const el = elementForReentry || document.documentElement;
        const result = exitFn.call(doc);

        if (!isFullscreenApiActive(doc)) {
            resyncAfterContextMenu(el, { requireVisual: true });
        } else if (ivContextMenuInFullscreen) {
            scheduleFullscreenExitResync(el);
        }

        setTimeout(() => {
            if (isFullscreenApiActive(doc)) {
                ivLogFullscreenExit('retry exitFullscreen');
                exitFn.call(doc);
            }
        }, 100);

        return result;
    }

    async function toggleGalleryBrowserFullscreen() {
        if (!overlay || galleryFullscreenPending) return;
        const currentOverlay = overlay;
        const wasInPage = galleryInPage;
        const exiting = isFullscreenApiActive();
        const target = exiting ? document : document.documentElement;
        const action = exiting
            ? document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen
            : target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
        if (!action) { showViewerToast('Browser fullscreen is unavailable'); return; }
        galleryFullscreenPending = true;
        galleryInPage = exiting;
        ivPendingVisualFullscreenExit = false;
        ivIntentionalFullscreenExit = false;
        try {
            await action.call(target);
        } catch (error) {
            if (overlay === currentOverlay) {
                galleryInPage = wasInPage;
                showViewerToast('Could not toggle browser fullscreen');
            }
            ivLogFullscreenExit('gallery fullscreen toggle failed', { name: error.name });
        } finally {
            galleryFullscreenPending = false;
        }
    }

    function hideFullscreen() {
        const doc = document;
        const apiFs = isFullscreenApiActive(doc);
        const hadOverlay = !!overlay;
        const docEl = document.documentElement;

        ivLogFullscreenExit('hideFullscreen', { apiFs, hadOverlay });
        ivIntentionalFullscreenExit = true;
        ivPendingVisualFullscreenExit = false;

        if (!apiFs && galleryInPage) {
            clearOverlay();
            ivIntentionalFullscreenExit = false;
            return;
        }

        if (!apiFs && hadOverlay) {
            clearOverlay();
            resyncAfterContextMenu(docEl, { force: true });
            return;
        }

        const result = exitFullscreenWithWorkaround(docEl);
        if (result && result.then) {
            result.catch(() => clearOverlay());
        }

        if (!apiFs) {
            clearOverlay();
        }
    }

    function scrollToImage() {
        const selected = imgs[currentIndex];
        const imgEl = selected?.isConnected ? selected : ivChatGPTGallery?.original(selected);
        if (!imgEl) {
            showViewerToast('This image’s chat turn is not currently loaded');
            return;
        }
        ivChatGPTNavigationDebug?.record('scroll-to-image');
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

    function collectNavigableImages() {
        const cached = ivChatGPTGallery?.images();
        if (cached) return cached;
        const allImgs = Array.from(document.querySelectorAll('img'));
        const seen = new Set();
        const list = [];
        for (const imgEl of allImgs) {
            if (overlay?.contains(imgEl) || isExcludedImage(imgEl)) continue;
            const src = imgEl.src;
            if (!src || seen.has(src)) continue;
            seen.add(src);
            list.push(imgEl);
        }
        return list;
    }

    function pickRandomIndex(length, avoid) {
        if (length <= 0) return -1;
        if (length === 1) return 0;
        if (avoid < 0 || avoid >= length) return Math.floor(Math.random() * length);
        let i = Math.floor(Math.random() * (length - 1));
        if (i >= avoid) i += 1;
        return i;
    }

    function cancelImageNavigationSearch() {
        if (imageNavigationSearch) showViewerToast('Image search stopped', 1000);
        imageNavigationSearch = null;
        ivChatGPTGallery?.cancelNavigation();
    }

    async function navigate(delta) {
        if (imageNavigationSearch?.delta === delta) return;
        cancelImageNavigationSearch();
        if (overlay && ivChatGPTGallery) {
            const selected = imgs[currentIndex];
            const key = ivChatGPTGallery.key(selected);
            const list = ivChatGPTGallery.images();
            const index = list?.findIndex((img) => key
                ? ivChatGPTGallery.key(img) === key : img.src === selected?.src);
            if (index >= 0) {
                saveOverlayNativeScrollForCurrent();
                imgs = list;
                currentIndex = index;
            }
        }
        const next = currentIndex + delta;
        ivChatGPTNavigationDebug?.record('navigate', {
            delta, next, blocked: next < 0 || next >= imgs.length,
        });
        if (next < 0 || next >= imgs.length) {
            if (!overlay || !ivChatGPTGallery) return;
            const request = { delta, overlay };
            imageNavigationSearch = request;
            const isCurrent = () => imageNavigationSearch === request && overlay === request.overlay;
            try {
                const result = await ivChatGPTGallery.findNext(imgs[currentIndex], delta, isCurrent);
                if (!result || !isCurrent()) return;
                saveOverlayNativeScrollForCurrent();
                imgs = result.list;
                currentIndex = result.index;
                displayImageInOverlay(imgs[currentIndex]);
            } finally {
                if (imageNavigationSearch === request) imageNavigationSearch = null;
            }
            return;
        }
        saveOverlayNativeScrollForCurrent();
        currentIndex = next;
        displayImageInOverlay(imgs[currentIndex]);
    }

    function navigateToRandomImage() {
        cancelImageNavigationSearch();
        const list = collectNavigableImages();
        ivChatGPTNavigationDebug?.record('random', { collected: list.length });
        if (!list.length) return false;

        if (overlay) {
            const currentKey = ivChatGPTGallery?.key(imgs[currentIndex]);
            const currentSrc = overlayImage?.src || imgs[currentIndex]?.src;
            saveOverlayNativeScrollForCurrent();
            imgs = list;
            currentIndex = imgs.findIndex((imgEl) => currentKey
                ? ivChatGPTGallery.key(imgEl) === currentKey : imgEl.src === currentSrc);
            const next = pickRandomIndex(imgs.length, currentIndex);
            if (next < 0) return false;
            currentIndex = next;
            displayImageInOverlay(imgs[currentIndex]);
            return true;
        }

        const next = pickRandomIndex(list.length, -1);
        if (next < 0) return false;
        showFullscreen(list[next]);
        return true;
    }

    function showFullscreen(img) {
        if (ivChatGPTGallery?.scanning) return;
        if (!img || isExcludedImage(img)) return;
        ivContextMenuInFullscreen = false;
        galleryInPage = false;
        
        imgs = collectNavigableImages();
        
        // Cached ChatGPT images have their own URLs; match their stable message/slot key.
        const key = ivChatGPTGallery?.key(img);
        currentIndex = imgs.findIndex(imgEl => key ? ivChatGPTGallery.key(imgEl) === key : imgEl.src === img.src);
        if (currentIndex < 0) currentIndex = 0;

        ivLogFullscreenExit('showFullscreen');
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

        displayImageInOverlay(imgs[currentIndex] || img);
        applyOverlayImageFitMode();

        // Navigation buttons
        const createNav = (symbol, handler) => {
            const btn = document.createElement('div');
            Object.assign(btn.style, {
                position: 'fixed', top: 0, bottom: 0,
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
            position: 'fixed', top: '10px', right: '10px',
            width: '3rem', height: '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'transparent', color: 'rgba(255,255,255,0.3)',
            fontSize: '2rem', cursor: 'pointer', userSelect: 'none', zIndex: 2147483648
        });
        scrollBtn.textContent = '⇨'; scrollBtn.title = 'Scroll to image';
        scrollBtn.addEventListener('click', e => { e.stopPropagation(); scrollToImage(); });
        overlay.appendChild(scrollBtn);

        // Close overlay on click
        overlay.addEventListener('click', hideFullscreen);
        // Fixed navigation controls can otherwise intercept trackpad/wheel scrolling.
        overlay.addEventListener('wheel', onOverlayWheel, { capture: true, passive: false });
        document.body.appendChild(overlay);
        ivChatGPTNavigationDebug?.record('overlay-open');
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
        if (!overlay && e.button === 0 && imageFromEventTarget(e.target)) {
            e.preventDefault(); e.stopPropagation();
        }
    }, true));

    document.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        consumeStuckVisualFullscreenExit(e);
    }, true);

    document.addEventListener('contextmenu', () => {
        if (!overlay && !isFullscreenApiActive()) return;
        ivContextMenuInFullscreen = true;
        ivLogFullscreenExit('contextmenu in fullscreen');
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' && e.code !== 'KeyF' && e.code !== 'Slash') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        consumeStuckVisualFullscreenExit(e);
    }, true);

    // Open on left-click for non-excluded images
    document.addEventListener('click', e => {
        if (!overlay && e.button === 0) {
            const img = imageFromEventTarget(e.target);
            if (img) showFullscreen(img);
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

    // Routed through the early window capture listener, ahead of site shortcuts.
    function handleOverlayKeydown(e) {
        if (viewerHotkeysModalBlocksKeydown(e)) return;
        if (!overlay) return;
        if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!e.repeat) void toggleGalleryBrowserFullscreen();
            return;
        }
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
    }

    document.addEventListener('keyup', e => {
        if (!overlay) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (!overlayScrollKeys.delete(e.key)) return;
        syncOverlayScrollDir();
        if (!overlayScrollDir) stopOverlayArrowScroll();
    }, true);

    // Close overlay on real fullscreen exit. "Copy image" can fire a spurious API
    // exit while the window stays visually fullscreen — keep the overlay so the
    // next click/Esc can re-sync and leave fullscreen.
    ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => {
        ivLogFullscreenExit('fullscreenchange', { evt });
        if (overlay && !isFullscreenApiActive()) {
            if (galleryInPage) {
                ivIntentionalFullscreenExit = false;
                return;
            }
            if (ivIntentionalFullscreenExit) {
                ivIntentionalFullscreenExit = false;
                ivLogFullscreenExit('fullscreenchange: intentional API exit');
                clearOverlay();
                resyncAfterContextMenu(document.documentElement, { requireVisual: true });
                return;
            }
            ivLogFullscreenExit('fullscreenchange: spurious API exit, keep overlay');
            armStuckVisualFullscreenExit(document.documentElement);
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

    function hideViewerToast(message) {
        if (!viewerToastEl || viewerToastEl.textContent !== message) return;
        clearTimeout(viewerToastHideTimer);
        viewerToastEl.style.opacity = '0';
        try { viewerToastEl.hidePopover(); } catch (e) {}
    }

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
                viewerToastHideTimer = setTimeout(() => {
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
                ['R', 'Random image (outside Imagine)'],
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
            title: 'Imagine videos',
            items: [
                ['A / D', 'Previous / next video'],
                ['r', 'Random unvisited video'],
                ['R', 'Random video'],
            ],
        },
        {
            title: 'Image fullscreen',
            items: [
                ['Esc', 'Close'],
                ['B', 'Toggle browser fullscreen (show / hide browser tabs)'],
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

        if (ivChatGPTGallery) {
            const scanButton = document.createElement('button');
            scanButton.type = 'button';
            scanButton.textContent = 'Load all chat images (Shift+L)';
            Object.assign(scanButton.style, {
                marginTop: '16px', padding: '10px 14px', borderRadius: '8px',
                background: '#3f3f46', color: '#fafafa', cursor: 'pointer', width: '100%',
            });
            scanButton.addEventListener('click', () => { hideViewerHotkeysModal(); void ivChatGPTGallery.scan(); });
            panel.appendChild(scanButton);
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

    /** Keep/Unkeep buttons and the keep-status filter for Grok Imagine. */
    const IV_GROK_IMAGINE_KEEP_UI_ENABLED = false;
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
        if (!IV_GROK_IMAGINE_KEEP_UI_ENABLED || !isGrokImagineSavedPage()) {
            if (filterExisting) filterExisting.remove();
            document.getElementById('iv-grok-saved-filter-chrome')?.remove();
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

    function isGrokImaginePage() {
        return isGrokHost() && (location.pathname === '/imagine' || location.pathname.startsWith('/imagine/'));
    }

    const imagineVisitedVideos = new Set();
    const imagineFilmstripMediaIds = new Set();
    let imagineVisitedPage = location.pathname;

    function resetImagineVisitedVideos() {
        imagineVisitedVideos.clear();
        imagineFilmstripMediaIds.clear();
        imagineVisitedPage = location.pathname;
    }

    function syncImagineVisitedPage() {
        if (imagineVisitedPage === location.pathname) return;
        const previousPost = imagineVisitedPage.match(/^\/imagine\/post\/([^/]+)\/?$/)?.[1];
        const nextPost = location.pathname.match(/^\/imagine\/post\/([^/]+)\/?$/)?.[1];
        // Grok replaces the post URL for each selection within the same filmstrip.
        if (previousPost && nextPost && imagineFilmstripMediaIds.has(previousPost) && imagineFilmstripMediaIds.has(nextPost)) {
            imagineVisitedPage = location.pathname;
            return;
        }
        resetImagineVisitedVideos();
    }

    function bindImagineVisitedPageLifecycle() {
        if (!isGrokHost()) return;
        // Grok changes routes without unloading the document.
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            history[method] = function (...args) {
                const result = original.apply(this, args);
                syncImagineVisitedPage();
                return result;
            };
        }
        window.addEventListener('popstate', syncImagineVisitedPage);
        window.addEventListener('pagehide', resetImagineVisitedVideos);
    }

    function imagineVideoVisitKey(btn) {
        return imaginePostIdFromFilmstripButton(btn) ||
            btn.querySelector('img')?.getAttribute('src') ||
            btn.querySelector('video')?.getAttribute('src') || btn;
    }

    function collectImagineVideoButtons(allButtons) {
        return allButtons.filter((btn) => {
            if (btn.disabled || btn.hidden || btn.style.display === 'none') return false;
            // Deletion can hide the thumbnail's wrapper instead of removing the button.
            for (let parent = btn.parentElement; parent; parent = parent.parentElement) {
                if (parent.hidden || parent.style?.display === 'none') return false;
            }
            // Video slides can render only an image thumbnail, with a duration badge.
            return !!btn.querySelector('video') || Array.from(btn.querySelectorAll('span')).some((span) =>
                /^(?:\d+:)?\d+:\d{2}$/.test(span.textContent.trim()));
        });
    }

    function showImagineVideoIndex(button = getImaginePostSelectedFilmstripButton(), buttons = null) {
        if (!isGrokImaginePage()) return;
        if (!buttons) {
            const strip = imaginePostFilmstripScrollEl();
            if (!strip) return;
            buttons = collectImagineVideoButtons(Array.from(strip.querySelectorAll('button[data-filmstrip-item="true"]')));
        }
        const index = buttons.indexOf(button);
        if (index >= 0) showViewerToast(`${index + 1}/${buttons.length}`, 1000);
    }

    function navigateImagineVideo(direction = 0, unvisitedOnly = false) {
        syncImagineVisitedPage();
        const strip = imaginePostFilmstripScrollEl();
        if (!strip) return false;
        const allButtons = Array.from(strip.querySelectorAll('button[data-filmstrip-item="true"]'));
        // Keep removed IDs until page leave: Grok may update the deleted current
        // post's URL only after the filmstrip has already changed.
        for (const btn of allButtons) {
            const id = imaginePostIdFromFilmstripButton(btn);
            if (id) imagineFilmstripMediaIds.add(id);
        }
        const buttons = collectImagineVideoButtons(allButtons);
        const selected = getImaginePostSelectedFilmstripButton();
        let target;
        if (unvisitedOnly) {
            if (buttons.includes(selected)) imagineVisitedVideos.add(imagineVideoVisitKey(selected));
            const candidates = buttons.filter((btn) => !imagineVisitedVideos.has(imagineVideoVisitKey(btn)));
            if (!candidates.length) {
                showViewerToast('No more unvisited videos', 1000);
                return false;
            }
            target = candidates[pickRandomIndex(candidates.length, -1)];
            imagineVisitedVideos.add(imagineVideoVisitKey(target));
        } else if (direction) {
            const selectedIndex = allButtons.indexOf(selected);
            if (selectedIndex < 0) return false;
            const candidates = direction < 0 ? buttons.slice().reverse() : buttons;
            target = candidates.find((btn) => (allButtons.indexOf(btn) - selectedIndex) * direction > 0);
        } else {
            target = buttons[pickRandomIndex(buttons.length, buttons.indexOf(selected))];
        }
        if (!target || target === selected) return false;
        if (overlay) hideFullscreen();
        // Let Grok update its hero player, including its existing fullscreen video.
        target.click();
        showImagineVideoIndex(target, buttons);
        return true;
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

    /** Skip ids we already deleted this session (e.g. via trash icon before bulk delete). */
    function grokBulkMediaIdsExcludingRecentlyDeleted(idList) {
        if (!idList || !idList.length) return [];
        const recentDeleted = grokRecentlyDeletedLoadSet();
        if (!recentDeleted.size) return idList.slice();
        return idList.filter((id) => !recentDeleted.has(String(id || '').trim().toLowerCase()));
    }

    function deleteGrokAssetMetadataOne(id) {
        const assetId = encodeURIComponent(String(id || '').trim());
        if (!assetId) return Promise.resolve({ ok: false, status: 0 });
        return fetch('https://grok.com/rest/assets-metadata/' + assetId, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
                'accept': '*/*',
                'x-xai-request-id': typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
            }
        }).then((res) => ({ ok: res.ok, status: res.status }));
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
        }).then(async (res) => {
            if (res.ok) return { ok: true, status: res.status };
            if (res.status === 404) return deleteGrokAssetMetadataOne(id);
            return { ok: false, status: res.status };
        });
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
    let grokImaginePostMoreOptionsMenuObs = null;
    let grokImaginePostMoreOptionsMenuObsTarget = null;

    function grokImaginePostMoreOptionsMenuOpen() {
        const triggers = document.querySelectorAll('button[aria-label="More options"][aria-haspopup="menu"]');
        for (let i = 0; i < triggers.length; i++) {
            const t = triggers[i];
            if (t.getAttribute('data-state') === 'open' || t.getAttribute('aria-expanded') === 'true') {
                return true;
            }
        }
        return false;
    }

    function grokImaginePostCornerDeleteButtonIds() {
        return [
            IV_GROK_DELETE_EXCEPT_BTN_ID,
            IV_GROK_DELETE_ALL_BTN_ID,
            IV_GROK_POST_KEEP_BTN_ID,
        ];
    }

    function applyGrokImaginePostDeleteButtonsVisibility() {
        if (!isGrokHost() || !isPostPage()) return;
        const cornerIds = grokImaginePostCornerDeleteButtonIds();
        if (grokImaginePostMoreOptionsMenuOpen()) {
            for (let i = 0; i < cornerIds.length; i++) {
                const el = document.getElementById(cornerIds[i]);
                if (el) el.style.display = 'none';
            }
        } else {
            for (let i = 0; i < cornerIds.length; i++) {
                const el = document.getElementById(cornerIds[i]);
                if (el) el.style.display = '';
            }
            applyGrokImaginePostCornerButtonLayout();
        }
        const sb = document.getElementById(IV_GROK_DELETE_SELECTED_BTN_ID);
        if (sb) mountGrokDeleteSelectedButton(sb);
    }

    function grokImaginePostMoreOptionsMenuObserve() {
        const aside = grokImaginePostDetailsAside();
        if (!aside || typeof MutationObserver === 'undefined') return;
        if (!grokImaginePostMoreOptionsMenuObs) {
            grokImaginePostMoreOptionsMenuObs = new MutationObserver(() => {
                applyGrokImaginePostDeleteButtonsVisibility();
            });
        }
        if (aside === grokImaginePostMoreOptionsMenuObsTarget) {
            applyGrokImaginePostDeleteButtonsVisibility();
            return;
        }
        grokImaginePostMoreOptionsMenuObs.disconnect();
        grokImaginePostMoreOptionsMenuObs.observe(aside, {
            attributes: true,
            attributeFilter: ['data-state', 'aria-expanded'],
            subtree: true,
            childList: true,
        });
        grokImaginePostMoreOptionsMenuObsTarget = aside;
        applyGrokImaginePostDeleteButtonsVisibility();
    }

    function teardownGrokImaginePostMoreOptionsMenuObserve() {
        if (grokImaginePostMoreOptionsMenuObs) {
            grokImaginePostMoreOptionsMenuObs.disconnect();
            grokImaginePostMoreOptionsMenuObs = null;
            grokImaginePostMoreOptionsMenuObsTarget = null;
        }
    }

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
        teardownGrokImaginePostMoreOptionsMenuObserve();
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
            grokImaginePostMoreOptionsMenuObserve();
            return;
        }
        grokImaginePostToolbarLayoutBound = true;
        grokImaginePostToolbarOnLayout = () => {
            if (grokImaginePostToolbarLayoutRaf != null) cancelAnimationFrame(grokImaginePostToolbarLayoutRaf);
            grokImaginePostToolbarLayoutRaf = requestAnimationFrame(() => {
                grokImaginePostToolbarLayoutRaf = null;
                applyGrokImaginePostDeleteButtonsVisibility();
            });
        };
        window.addEventListener('resize', grokImaginePostToolbarOnLayout);
        window.addEventListener('scroll', grokImaginePostToolbarOnLayout, true);
        grokImaginePostToolbarObserveAside();
        grokImaginePostFilmstripObserve();
        grokImaginePostPromptBarObserve();
        grokImaginePostMoreOptionsMenuObserve();
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
        if (!IV_GROK_IMAGINE_KEEP_UI_ENABLED || !postSlugId) {
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
                const idsForDelete = grokBulkMediaIdsExcludingRecentlyDeleted(imaginePostMediaIdsForDelete(allIds));
                if (btn.dataset.ivGrokArmed !== '1') {
                    if (!idsForDelete.length) {
                        history.back();
                        return;
                    }
                    grokDeleteAllArm(idsForDelete.length);
                    return;
                }
                grokDeleteAllDisarm();
                if (!idsForDelete.length) {
                    history.back();
                    return;
                }
                const ids = idsForDelete;
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
                    const pendingRaw = exBtn._ivGrokExceptPendingIds ? exBtn._ivGrokExceptPendingIds.slice() : null;
                    grokDeleteExceptDisarm();
                    const pending = pendingRaw ? grokBulkMediaIdsExcludingRecentlyDeleted(pendingRaw) : null;
                    if (!pending || !pending.length) {
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
                const pendingIds = grokBulkMediaIdsExcludingRecentlyDeleted(imaginePostMediaIdsForDelete(toDeleteOrdered));
                if (!pendingIds.length) {
                    grokDeleteExceptDisarm();
                    return;
                }
                exBtn._ivGrokExceptPendingIds = pendingIds;
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
        applyGrokImaginePostDeleteButtonsVisibility();
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
    
    /** Prefer a visible hero player; ignore hidden/filmstrip targets. */
    function resolveVideoForFullscreenToggle(preferred) {
        if (preferred && isVideoVisibleForFullscreenTarget(preferred)) return preferred;
        return pickBestVisibleVideo();
    }

    function requestVideoFullscreen(video) {
        const requestFn =
            video.requestFullscreen ||
            video.webkitRequestFullscreen ||
            video.mozRequestFullScreen ||
            video.msRequestFullscreen;
        if (!requestFn) {
            ivLogVideoFullscreen('requestFullscreen unavailable on video');
            return Promise.resolve(false);
        }
        ivLogVideoFullscreen('enter fullscreen', {
            src: (video.currentSrc || video.src || '').slice(0, 120),
            area: Math.round(video.getBoundingClientRect().width * video.getBoundingClientRect().height),
        });
        return Promise.resolve(requestFn.call(video))
            .then(() => true)
            .catch((err) => {
                ivLogVideoFullscreen('requestFullscreen failed', { message: err && err.message });
                return false;
            });
    }

    // Toggle fullscreen for video element
    function toggleVideoFullscreen(video) {
        video = resolveVideoForFullscreenToggle(video);
        if (!video) {
            ivLogVideoFullscreen('toggle aborted: no visible video element');
            return;
        }

        const doc = document;
        const fsEl =
            doc.fullscreenElement ||
            doc.webkitFullscreenElement ||
            doc.mozFullScreenElement ||
            doc.msFullscreenElement;

        if (fsEl === video) {
            ivLogVideoFullscreen('exit fullscreen', { fsTag: fsEl.tagName });
            exitFullscreenWithWorkaround(video);
            return;
        }

        const target = resolveVideoForFullscreenToggle(video);
        if (!target) {
            ivLogVideoFullscreen('enter aborted: no visible video');
            return;
        }

        if (fsEl) {
            ivLogVideoFullscreen('exit then enter video fullscreen (sync)', {
                fsTag: fsEl.tagName,
                videoTag: target.tagName,
            });
            const exitFn =
                doc.exitFullscreen ||
                doc.webkitExitFullscreen ||
                doc.mozCancelFullScreen ||
                doc.msExitFullscreen;
            if (exitFn) {
                try {
                    void exitFn.call(doc);
                } catch (err) {
                    ivLogVideoFullscreen('exitFullscreen failed (sync handoff)', {
                        message: err && err.message,
                    });
                }
            }
        }

        void requestVideoFullscreen(target);
    }

    const IV_VIDEO_FS_BTN_ATTR = 'data-iv-video-fs-btn';

    function shouldSkipVideoFullscreenTarget(video) {
        if (!video) return true;
        if (video.closest('[data-filmstrip-item]') || video.closest('[data-filmstrip-scroll]')) return true;
        return false;
    }

    function isVideoVisibleForFullscreenTarget(video) {
        if (!video || !video.isConnected || shouldSkipVideoFullscreenTarget(video)) return false;
        const r = video.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        const style = window.getComputedStyle(video);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const opacity = parseFloat(style.opacity);
        if (!isNaN(opacity) && opacity < 0.05) return false;
        return true;
    }

    function clearVideoFullscreenButtonsInContainer(container) {
        if (!container) return;
        container.querySelectorAll('[' + IV_VIDEO_FS_BTN_ATTR + ']').forEach((btn) => btn.remove());
        container.querySelectorAll('video[data-has-fullscreen-button]').forEach((v) => {
            delete v.dataset.hasFullscreenButton;
        });
    }

    function heroVideoForFullscreenButton(container) {
        if (!container) return null;
        let best = null;
        let bestArea = -1;
        container.querySelectorAll('video').forEach((video) => {
            if (!isVideoVisibleForFullscreenTarget(video)) return;
            const r = video.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) {
                bestArea = area;
                best = video;
            }
        });
        return best;
    }

    function videoFullscreenButtonFor(video) {
        const container = video.parentElement;
        if (!container) return null;
        const btn = container.querySelector('[' + IV_VIDEO_FS_BTN_ATTR + ']');
        if (!btn || btn._ivVideoFsVideo !== video) return null;
        return btn;
    }

    function removeVideoFullscreenButton(video) {
        clearVideoFullscreenButtonsInContainer(video && video.parentElement);
    }

    function createFullscreenButton(video) {
        if (shouldSkipVideoFullscreenTarget(video)) {
            removeVideoFullscreenButton(video);
            return;
        }

        const container = video.parentElement;
        if (!container) return;

        const hero = heroVideoForFullscreenButton(container);
        if (!hero) {
            clearVideoFullscreenButtonsInContainer(container);
            return;
        }
        if (video !== hero) {
            delete video.dataset.hasFullscreenButton;
            return;
        }

        const existing = container.querySelector('[' + IV_VIDEO_FS_BTN_ATTR + ']');
        if (
            existing &&
            existing._ivVideoFsVideo === hero &&
            hero.isConnected &&
            isVideoVisibleForFullscreenTarget(hero)
        ) {
            return;
        }
        clearVideoFullscreenButtonsInContainer(container);

        video.dataset.hasFullscreenButton = 'true';

        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(IV_VIDEO_FS_BTN_ATTR, '1');
        button._ivVideoFsVideo = hero;
        button.innerHTML = '⛶';
        button.title = 'Fullscreen (F)';
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

        const videoContainer = container;
        if (!videoContainer.style.position || videoContainer.style.position === 'static') {
            videoContainer.style.position = 'relative';
        }

        if (!videoContainer.dataset.ivVideoFsHoverBound) {
            videoContainer.dataset.ivVideoFsHoverBound = '1';
            videoContainer.addEventListener('mouseenter', () => {
                const btn = videoContainer.querySelector('[' + IV_VIDEO_FS_BTN_ATTR + ']');
                if (btn) btn.style.opacity = '1';
            });
            videoContainer.addEventListener('mouseleave', () => {
                const btn = videoContainer.querySelector('[' + IV_VIDEO_FS_BTN_ATTR + ']');
                if (btn) btn.style.opacity = '0';
            });
        }

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = 'rgba(0,0,0,0.8)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'rgba(0,0,0,0.6)';
        });

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleVideoFullscreen(button._ivVideoFsVideo);
        });

        videoContainer.appendChild(button);
    }

    /** true: DevTools console logs video fullscreen toggle / button mount steps. Set false normally. */
    const IV_VIDEO_FULLSCREEN_DEBUG = false;

    function ivLogVideoFullscreen(message, detail) {
        if (!IV_VIDEO_FULLSCREEN_DEBUG) return;
        if (detail !== undefined) console.log('[Image Viewer video fullscreen]', message, detail);
        else console.log('[Image Viewer video fullscreen]', message);
    }

    let videoFsButtonsRaf = null;

    function pruneOrphanVideoFullscreenButtons() {
        document.querySelectorAll('[' + IV_VIDEO_FS_BTN_ATTR + ']').forEach((btn) => {
            const v = btn._ivVideoFsVideo;
            if (!v || !v.isConnected || !isVideoVisibleForFullscreenTarget(v)) {
                btn.remove();
            }
        });
    }

    function addFullscreenButtonsToVideos() {
        pruneOrphanVideoFullscreenButtons();
        const videos = document.querySelectorAll('video');
        ivLogVideoFullscreen('ensure buttons', { videoCount: videos.length });
        videos.forEach((video) => createFullscreenButton(video));
    }

    function scheduleAddFullscreenButtonsToVideos() {
        if (videoFsButtonsRaf !== null) cancelAnimationFrame(videoFsButtonsRaf);
        videoFsButtonsRaf = requestAnimationFrame(() => {
            videoFsButtonsRaf = null;
            addFullscreenButtonsToVideos();
        });
    }
    
    // Clear loop when the looped video's source changes (SPA navigation reuses same element)
    let loopVideoSrc = null;
    document.addEventListener('loadstart', (e) => {
        if (e.target.tagName === 'VIDEO' && loopVideo && e.target === loopVideo) {
            const newSrc = e.target.src || e.target.currentSrc;
            if (loopVideoSrc && newSrc !== loopVideoSrc) clearLoop();
        }
    }, true);
    
    function mutationsAffectVideoButtons(mutations) {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                const t = mutation.target;
                if (t && t.tagName === 'VIDEO') return true;
                continue;
            }
            if (mutation.type !== 'childList') continue;
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'VIDEO') return true;
                if (node.querySelector && node.querySelector('video')) return true;
            }
            for (const node of mutation.removedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'VIDEO') return true;
                if (node.querySelector && node.querySelector('video')) return true;
            }
        }
        return false;
    }

    // Watch for new videos being added to the page
    const videoObserver = new MutationObserver((mutations) => {
        if (mutationsAffectVideoButtons(mutations)) {
            scheduleAddFullscreenButtonsToVideos();
        }
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
        scheduleAddFullscreenButtonsToVideos();
        scheduleImaginePostDeleteButtonsSync();
        scheduleGrokImagineSavedKeepSync();
        if (isPostPage()) applySharedVolumeToAll();
        videoObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'class', 'style', 'hidden'],
        });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            scheduleAddFullscreenButtonsToVideos();
            scheduleImaginePostDeleteButtonsSync();
            scheduleGrokImagineSavedKeepSync();
            if (isPostPage()) applySharedVolumeToAll();
            videoObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'class', 'style', 'hidden'],
            });
        });
    }

    bindImagineVisitedPageLifecycle();
    window.addEventListener('popstate', () => {
        scheduleImaginePostDeleteButtonsSync();
        scheduleGrokImagineSavedKeepSync();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        scheduleAddFullscreenButtonsToVideos();
        ivLogVideoFullscreen('tab visible: refreshed video buttons', {
            videoCount: document.querySelectorAll('video').length,
            apiFs: isFullscreenApiActive(),
        });
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
                    if (!video.controls) showImagineVideoIndex();
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
            scheduleAddFullscreenButtonsToVideos();
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
                lastFullscreenVideo = null;
                if (ivIntentionalFullscreenExit) {
                    ivIntentionalFullscreenExit = false;
                    resyncAfterContextMenu(videoForWorkaround);
                } else if (ivContextMenuInFullscreen) {
                    armStuckVisualFullscreenExit(videoForWorkaround);
                }
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

    // Offscreen images still have layout coordinates; hidden images do not.
    function pickNearestEligibleImage() {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        let nearest = null;
        let bestDistance = Infinity;
        for (const img of document.querySelectorAll('img')) {
            if (isExcludedImage(img)) continue;
            const rect = img.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const distance = (rect.left + rect.width / 2 - cx) ** 2 +
                (rect.top + rect.height / 2 - cy) ** 2;
            if (distance < bestDistance) {
                nearest = img;
                bestDistance = distance;
            }
        }
        return nearest;
    }

    function pickGalleryHotkeyImage() {
        return pickBestVisibleEligibleImage() || ivChatGPTGallery?.nearestImage() || pickNearestEligibleImage();
    }

    // Find the target video for keyboard controls
    // In fullscreen: use the fullscreen video element
    // Otherwise: pointer / largest visible video (Grok filmstrip + chat focus), then first match
    function getTargetVideo(e) {
        const fullscreenElement =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement;

        if (fullscreenElement && fullscreenElement.tagName === 'VIDEO') {
            return fullscreenElement;
        }

        if (isKeyboardTypingTarget(e.target)) {
            return null;
        }

        const fromPointer = viewerVideoFromPointer();
        if (fromPointer) return fromPointer;

        const bestVisible = pickBestVisibleVideo();
        if (bestVisible) return bestVisible;

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
        if (e.isComposing || e.keyCode === 229) return;

        if (ivChatGPTGallery?.scanning) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                ivChatGPTGallery.cancel('escape');
            } else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) &&
                !isKeyboardTypingTarget(e.target) &&
                !((e.ctrlKey || e.metaKey) && ['PageUp', 'PageDown'].includes(e.key)) &&
                !(e.key === ' ' && e.target.closest?.('button, [role="button"], a[href]'))) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
            return;
        }
        if (!overlay && isKeyboardTypingTarget(e.target)) return;
        if (ivChatGPTGallery && e.code === 'KeyL' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void ivChatGPTGallery.scan();
            return;
        }

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
                } else {
                    ivLogVideoFullscreen('F ignored: videos on page but no target', {
                        typing: isKeyboardTypingTarget(e.target),
                        targetTag: e.target && e.target.tagName,
                    });
                }
                return;
            }
            // Virtualized chats may have cached images with no mounted/visible source.
            const img = pickGalleryHotkeyImage();
            if (img) {
                e.preventDefault();
                e.stopImmediatePropagation();
                showFullscreen(img);
            }
            return;
        }

        // A/D: sequential Imagine videos, stopping at either end of the filmstrip.
        if ((e.code === 'KeyA' || e.code === 'KeyD') && isGrokImaginePage()) {
            if (e.metaKey || e.ctrlKey || e.altKey || isKeyboardTypingTarget(e.target)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            navigateImagineVideo(e.code === 'KeyA' ? -1 : 1);
            return;
        }

        // R: Imagine owns video selection; other pages keep random image navigation.
        if (e.code === 'KeyR') {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (isKeyboardTypingTarget(e.target)) return;
            if (isGrokImaginePage()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                // Some keyboard layouts report lowercase even with Caps Lock enabled.
                const uppercase = e.key === 'R' || (!!e.getModifierState?.('CapsLock') && !e.shiftKey);
                navigateImagineVideo(0, !uppercase);
                return;
            }
            const fsEl =
                document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.mozFullScreenElement ||
                document.msFullscreenElement;
            if (fsEl && fsEl.tagName === 'VIDEO') return;
            if (navigateToRandomImage()) {
                e.preventDefault();
                e.stopImmediatePropagation();
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
    
    viewerKeydownHandler = (e) => {
        handleViewerKeydown(e);
        if (!e.cancelBubble && !e.isComposing && e.keyCode !== 229) handleOverlayKeydown(e);
    };
    ivChatGPTNavigationDebug = createChatGPTNavigationDebug();
    ivChatGPTGallery = createChatGPTGallery();
    } // End of init()
    
    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
