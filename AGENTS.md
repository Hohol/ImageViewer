# ImageViewer project

## Overview

- ImageViewer is a dependency-free userscript that improves image and video viewing.
- It runs on ChatGPT, Gemini, and Grok, and supports local image viewing in Chrome.
- The shipped source is `ImageViewer.js`; there is no build step or package manager.
- The script was developed and tested only with Chrome and Tampermonkey. Some features might not work in other environments.
- `tests/` groups dependency-free checks by shared feature (`shared/`) and site (`sites/`), with reusable infrastructure in `support/`. See `tests/README.md` for commands.

## Feature map

- **Gallery mode** — The image-viewing overlay, opened by clicking an eligible image or pressing `F` or `/`. It can run with browser fullscreen on or off. When no image is visible, the gallery hotkey opens the eligible image nearest the current view. Existing code may call this image fullscreen. Entry point: `showFullscreen()`.
- **Image eligibility** — Shared exclusion rules for clicks, navigation, and cache capture. Entry point: `isExcludedImage()`.
- **ChatGPT gallery and image scan** — The gallery uses cached images, preserving individual image identities across grouped generated-message layouts and deduplicating large previews against their image pickers. Cached positions let the gallery hotkey find nearby images even after their source elements unload. The image scan scrolls through virtualized conversation history and caches images so they survive unloading. The scan pauses while the tab is hidden and blocks manual scrolling. The gallery releases its image cache on page exit and SPA route changes, ignoring outgoing conversation DOM until navigation settles. Successful scans finish silently when the progress panel disappears. Full scans skip the extra pagination wait at a structurally confirmed, settled chat start. Directional navigation remembers complete chat boundaries during passive capture, retains them across chunk remounts, and invalidates them on submission or content extending that boundary. Entry point: `createChatGPTGallery()` → `scan()`.
- **Local images (Chrome)** — Local image files redirect to a viewer on the containing directory's `file:` page. Tampermonkey must have "Allow access to file URLs" enabled. `Left`/`Right` navigate immediate image files alphabetically without wrapping; the selected filename is stored in the URL hash. Clicking the image or pressing `.` toggles fit/native resolution; native mode allows scrolling and the size mode persists across image navigation. `Space` advances; standalone `Cmd`/`Alt` go back on release; `R` selects a different random image; held `Up`/`Down` scroll in native mode; `B`, `F`, or `/` toggle browser fullscreen; `Esc` closes help, exits fullscreen, or returns to the folder; `H` shows local-only help. `C` and `T` are deliberately unbound locally. Entry point: `initLocalImageViewer()`.

## Maintaining this file

Update existing feature-map entries when their logic, entry points, or user-facing behavior changes. Add new entries only when the user explicitly requests them.
