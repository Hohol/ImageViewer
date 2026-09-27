# ImageViewer project

## Overview

- This is a dependency-free userscript for Tampermonkey and Violentmonkey.
- The shipped source is `ImageViewer.js`; there is no build step or package manager.
- It runs on ChatGPT, Gemini, and Grok.
- `temp/` contains ignored browser snapshots and debugging artifacts. Use them only when relevant to a reported bug; they are not production source.

## Git and releases

- Never commit unless the user explicitly asks.
- Do not increment the `@version` field during ordinary local development.
- If a requested push or release includes changes to `ImageViewer.js`, increment `@version` once before pushing. Documentation-only and other non-script changes do not require a version bump.
