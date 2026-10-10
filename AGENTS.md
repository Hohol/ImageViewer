# ImageViewer project

This tracked file contains shared project knowledge useful across machines. Keep personal preferences and machine-specific instructions in the untracked `AGENTS.override.md` file.

## Overview

- This is a dependency-free userscript for Tampermonkey and Violentmonkey.
- The shipped source is `ImageViewer.js`; there is no build step or package manager.
- It runs on ChatGPT, Gemini, and Grok.
- It augments these sites' interfaces in various ways, primarily to improve image and video viewing.
- `tests/` groups dependency-free checks by shared feature (`shared/`) and site (`sites/`), with reusable infrastructure in `support/`. See `tests/README.md` for commands.
- `temp/` contains ignored browser snapshots and debugging artifacts. Use them only when relevant to a reported bug; they are not production source.

## Project terminology

- "Fullscreen mode" means ImageViewer's full-screen image-viewing overlay, opened for an eligible image by clicking it or pressing F or the slash key; it does not mean the browser's ordinary fullscreen mode (for example, F11).
