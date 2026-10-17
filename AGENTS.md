# ImageViewer project

This tracked file contains shared project knowledge useful across machines. Keep personal preferences and machine-specific instructions in the untracked `AGENTS.override.md` file.

## Overview

- This is a dependency-free userscript for Tampermonkey and Violentmonkey.
- The shipped source is `ImageViewer.js`; there is no build step or package manager.
- It runs on ChatGPT, Gemini, and Grok.
- It augments these sites' interfaces in various ways, primarily to improve image and video viewing.
- `tests/` groups dependency-free checks by shared feature (`shared/`) and site (`sites/`), with reusable infrastructure in `support/`. See `tests/README.md` for commands.

## Feature map

- **Gallery mode** — The image-viewing overlay, opened by clicking an eligible image or pressing F or `/`. It can run with browser fullscreen on or off. Uses cached images on ChatGPT, preserving individual image identities across grouped generated-message layouts; when none is visible, the hotkey opens the known image nearest the current view. Existing code may call this image fullscreen. Entry point: `showFullscreen()`.
- **Image eligibility** — Shared exclusion rules for clicks, navigation, and cache capture. Entry point: `isExcludedImage()`.
- **ChatGPT image scan** — scrolls through virtualized conversation history and caches images so they survive unloading. Pauses while the tab is hidden and blocks manual scrolling. Releases the image cache on page exit and SPA route changes, ignoring outgoing conversation DOM until navigation settles. Successful scans finish silently when the progress panel disappears. Full scans skip the extra pagination wait at a structurally confirmed, settled chat start. Directional navigation remembers complete chat boundaries during passive capture, retains them across chunk remounts, and invalidates them on submission or content extending that boundary. Entry point: `createChatGPTGallery()` → `scan()`.

Update existing feature-map entries when their logic, entry points, or user-facing behavior changes. Add new entries only when the user explicitly requests them.
