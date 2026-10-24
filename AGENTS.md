# ImageViewer project

## Overview

- ImageViewer is a dependency-free userscript that improves image and video viewing.
- It runs on ChatGPT, Gemini, and Grok, and supports local image viewing in Chrome.
- The shipped source is `ImageViewer.js`; there is no build step or package manager.
- The script was developed and tested only with Chrome and Tampermonkey. Some features might not work in other environments.
- `tests/` groups dependency-free checks by shared feature (`shared/`) and site (`sites/`), with reusable infrastructure in `support/`. See `tests/README.md` for commands.

## Feature map

- **Gallery mode** — Image overlay opened by clicking an eligible image or pressing `F` or `/`; supports browser fullscreen and selects the nearest image when none is visible. Entry point: `showGallery()`.
- **Image eligibility** — Shared exclusion rules for clicks, navigation, and cache capture. Entry point: `isExcludedImage()`.
- **Video viewing** — Fullscreen, playback controls, custom loops, and clip export; Grok Imagine also supports sequential and random video navigation. Entry points: `toggleVideoFullscreen()`, `getTargetVideo()`, `startLooping()`, `exportLoopFragment()`, and `navigateImagineVideo()`.
- **ChatGPT gallery and image scan** — Caches images across virtualized history, preserves identities across grouped layouts, and deduplicates previews and pickers. Scans pause in hidden tabs and block manual scrolling; the cache resets on conversation changes. Entry point: `createChatGPTGallery()` → `scan()`.
- **Local images (Chrome)** — Browses images in the containing directory alphabetically without wrapping, with fit/native resolution modes and separate local hotkeys. Requires Tampermonkey's "Allow access to file URLs" setting. Entry point: `initLocalImageViewer()`.

## Maintaining this file

Update existing feature-map entries when their logic, entry points, or user-facing behavior changes. Add new entries only when the user explicitly requests them.
