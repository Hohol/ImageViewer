// ==UserScript==
// @name         Image Fullscreen Toggle v1.42
// @namespace    http://example.com/
// @version      1.42
// @description  Click any image on chatgpt.com, grok.com or gemini.google.com to zoom+fullscreen; Alt+F or hover button to fullscreen videos; Spacebar to pause/unpause video in fullscreen; Esc or click closes overlay; ←/→/Space/Meta/Alt/buttons to navigate; transparent nav buttons; Scroll button exits fullscreen and scrolls to image location; unique image navigation excluding avatars; opt-in on chatgpt.com, grok.com and gemini.google.com, disabled on /library pages; exclude avatars and generated images on click, but include generated images in navigation.
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
            if (onlyChild.tagName === 'IMG' || onlyChild.tagName === 'VIDEO') {
                return;
            }
        }

    let overlay = null;
    let imgs = [];
    let currentIndex = -1;
    let overlayImage = null;

    // Check if image should be skipped from navigation (avatars, previews, etc.)
    function shouldSkipImage(img) {
        const alt = img.getAttribute('alt');
        // Skip avatars: ChatGPT (alt="User") and Grok (alt="pfp")
        if (alt === 'User' || alt === 'pfp') return true;
        // Skip preview images (URLs ending with /preview-image)
        if (img.src.endsWith('/preview-image')) return true;
        return false;
    }

    // Exclude certain images and generated-image blocks on initial click
    function isExcludedImage(img) {
        if (shouldSkipImage(img)) return true;
        if (img.closest('div.flex.flex-col.gap-2')) return true;
        // Skip thumbnail images in Favorites button
        if (img.closest('button[aria-label="Favorites"]')) return true;
        // Skip masonry grid thumbnails (Grok's image gallery)
        if (img.closest('[role="listitem"]')) return true;
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

        // Display image
        overlayImage = img.cloneNode();
        
        // For Google Images (like Gemini), remove size restrictions from URL
        let fullSizeSrc = img.src;
        if (fullSizeSrc.includes('googleusercontent.com') || fullSizeSrc.includes('ggpht.com')) {
            // Remove size parameters like =s1024-rj or =w500-h400 to get original size
            fullSizeSrc = fullSizeSrc.replace(/=[swh]\d+(-\w+)?$/i, '=s0');
        }
        
        // Remove all classes that might have size restrictions
        overlayImage.removeAttribute('class');
        overlayImage.removeAttribute('_ngcontent-ng-c1355997682');
        overlayImage.removeAttribute('loading');
        
        // Set the full-size src
        overlayImage.src = fullSizeSrc;
        
        // Set aggressive inline styles to ensure full size display
        Object.assign(overlayImage.style, { 
            maxWidth: '100%', 
            maxHeight: '100%', 
            width: 'auto',
            height: 'auto',
            objectFit: 'contain' 
        });
        
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

    // === VIDEO FULLSCREEN FUNCTIONALITY ===
    
    // Toggle fullscreen for video element
    function toggleVideoFullscreen(video) {
        const doc = document;
        const isFullscreen = doc.fullscreenElement || doc.webkitFullscreenElement || 
                           doc.mozFullScreenElement || doc.msFullscreenElement;
        
        if (isFullscreen) {
            // Exit fullscreen
            const exitFn = doc.exitFullscreen || doc.webkitExitFullscreen || 
                          doc.mozCancelFullScreen || doc.msExitFullscreen;
            if (exitFn) exitFn.call(doc);
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
    
    // Watch for new videos being added to the page
    const videoObserver = new MutationObserver(() => {
        addFullscreenButtonsToVideos();
    });
    
    // Start observing when DOM is ready
    if (document.body) {
        addFullscreenButtonsToVideos();
        videoObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            addFullscreenButtonsToVideos();
            videoObserver.observe(document.body, { childList: true, subtree: true });
        });
    }
    
    // Apply styles to videos when entering fullscreen
    ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => {
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement ||
                                 document.mozFullScreenElement || document.msFullscreenElement;
        
        if (fullscreenElement && fullscreenElement.tagName === 'VIDEO') {
            // Just entered fullscreen with a video - apply styles
            const video = fullscreenElement;
            
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
                backgroundColor: 'black'
            });
        } else if (!fullscreenElement) {
            // Exited fullscreen - restore original styles
            const videos = document.querySelectorAll('video[data-original-style]');
            videos.forEach(video => {
                video.style.cssText = video.dataset.originalStyle;
                if (video.dataset.originalClass) {
                    video.className = video.dataset.originalClass;
                }
                delete video.dataset.originalStyle;
                delete video.dataset.originalClass;
            });
        }
    }));

    // Alt+F / Option+F keyboard shortcut for video fullscreen
    document.addEventListener('keydown', e => {
        // Use e.code to detect physical key, not e.key (which gives ÷ on Mac with Alt+F)
        if (e.altKey && e.code === 'KeyF') {
            e.preventDefault();
            const video = document.querySelector('video');
            if (video) {
                toggleVideoFullscreen(video);
            }
        }
        
        // Spacebar to pause/unpause video when in fullscreen
        if (e.code === 'Space') {
            const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement ||
                                     document.mozFullScreenElement || document.msFullscreenElement;
            
            if (fullscreenElement && fullscreenElement.tagName === 'VIDEO') {
                e.preventDefault();
                const video = fullscreenElement;
                if (video.paused) {
                    video.play().catch(err => console.error('Video play failed:', err));
                } else {
                    video.pause();
                }
            }
        }
    });
    } // End of init()
    
    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
