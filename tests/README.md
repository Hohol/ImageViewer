# ImageViewer regression tests

Tests are grouped by the behavior they own, then by feature. Most current
coverage is for ChatGPT's gallery because that is where the recent regressions
occurred. Passing this suite does not mean every site or viewer feature is tested.

## Structure

```text
tests/
  shared/
    viewer/
      navigation.test.cjs
      browser-fullscreen.test.cjs
      eligibility/           # Real DOM checks for the common filter
  sites/
    chatgpt/
      navigation-debug.test.cjs
      gallery/
        fixture.{html,css,js}
        *.browser.js
    gemini/
      image-eligibility.browser.js
    grok/
      image-eligibility.browser.js
  support/
    source.cjs
    browser/                 # Generic runner, registry, and assertion reporting
  serve.cjs
```

Use `shared/<feature>/` for behavior common to the supported sites, and
`sites/<site>/<feature>/` for site-specific DOM, selectors, and integrations.
For example, Gemini image eligibility belongs under `sites/gemini/`, Grok saved
media under `sites/grok/`, and shared clipboard or video behavior under `shared/`.
Create those directories when adding actual tests; avoid empty placeholder suites.
Keep site fixtures alongside their cases. Only reusable test infrastructure
belongs in `support/`.

## Current coverage

| Area | Coverage |
| --- | --- |
| Local image navigation | Alphabetical ordering, same-folder filtering, duplicate links, encoded filenames, key routing, standalone modifiers versus combinations, help dismissal, held scrolling, and fullscreen/Escape routing (Node; browser APIs mocked). Real Chrome directory loading and fullscreen require a browser smoke check. |
| Gallery hotkey selection | Nearest offscreen image by viewport-center distance, hidden/excluded images, visible-image priority, and ChatGPT cached-history fallback (mocked layout) |
| Shared viewer navigation | Partial: cached navigation, ChatGPT search handoff, repeated keys, stale-result cancellation, basic non-ChatGPT fallback |
| Gallery browser fullscreen | Mode transitions retain the overlay; failed entry, repeated requests, and closing in-page mode (mocked browser API) |
| ChatGPT gallery | Scan, passive capture, virtualized history, directional searches, boundaries (including mounted-edge detection, full-scan completion without the extra pagination wait at confirmed starts, retention across older chunks/remounts, and pagination/incomplete-content guards), edited branches, long text spans, paired generated images regrouped into shared message containers and loaded in reverse order, large-preview/picker duplicates and selection changes |
| ChatGPT search-image cards | Excluded from clicks, navigation, and gallery capture; generated images and generic image/button components stay eligible |
| ChatGPT SVG components | Marked SVG components are excluded; ordinary SVG images stay eligible |
| ChatGPT image retries | Non-overlapping side/stacked composer layouts, reversed-scroll latest-message detection and distinct missing-control errors; bounded edit/send retries including moderation failures, successful image detection, reference-image exclusion, delayed image loading, hidden-document continuation, delayed turn-state transitions with an active composer Stop button, cancellation, reset on new/edited prompt submission, automatic activation for manual d prompts, and conversation changes (synthetic browser DOM) |
| ChatGPT navigation diagnostics | Detached images, turn changes, URL redaction, bounded logs, listener cleanup |
| Shared image eligibility | Common exclusions and ChatGPT generated-image exceptions agree for clicking and navigation |
| Gemini integration | Inline generated images, lightbox images, source/markup eligibility, upload-preview exclusions |
| Grok integration | Chat/Imagine image eligibility, hero/card layouts, filmstrip and other thumbnail exclusions; saved-media filters and deletion controls remain untested |
| Imagine post return navigation | Back and page-level Escape reuse native Saved links when available, with a full-navigation fallback; fullscreen, overlay, menu dismissal, unrelated clicks, and modified clicks retain priority (mocked DOM) |
| Imagine random-post audio | J carries muted/unmuted state across full navigation, restores it after player initialization, and releases restoration on user interaction (mocked DOM; live autoplay behavior requires a browser check) |
| Imagine empty-post navigation | Successful delete-all on a J-opened post jumps to another cached post, evicts deleted URLs, and falls back to Saved when exhausted; ordinary entries retain Back (mocked navigation) |
| Imagine delete shortcut | X delegates to the selected-item trash button in page/fullscreen modes, shows and clears its confirmation toast, and ignores typing, modifiers, repeats, and disabled buttons (mocked DOM; deletion API remains untested) |
| Imagine selection after deletion | Removed or hidden selected videos advance to the next surviving video, falling back to the previous one; unselected deletions, empty lists, images, and unrelated route changes do not trigger selection (mocked DOM, page/fullscreen modes) |
| Imagine saved navigation | J caches loaded post URLs across unmounts, in-app navigation, and browser sessions via local storage, validates restored URLs, deduplicates remounts, preserves conversation URLs, skips hidden links, and respects typing, modifiers, composition, repeated keys, and empty grids (mocked DOM) |
| Imagine video navigation | R random selection, lowercase r unvisited selection and page-leave reset, A/D previous/next routing in page/fullscreen modes, no wrapping, image skipping, avoiding the current video, deletions and hidden wrappers, updated index totals, empty/single-video cases, typing and modifier guards (mocked DOM) |
| Other shared viewer features | No dedicated tests yet for fit/zoom, native browser fullscreen behavior, clipboard, new-tab opening, hotkeys, video controls, or loop export |

## Command-line checks

No packages or build step are required. Use Node.js 22+ and a modern browser.
Run these commands from the repository root:

```sh
node --check ImageViewer.js
node --test
```

Node discovers `*.test.cjs` recursively, so adding a site or feature requires no
runner changes. Failures produce a nonzero exit status. For one feature:

```sh
node --test tests/shared/viewer/navigation.test.cjs
```

## Browser checks

```sh
node tests/serve.cjs
```

Open **http://127.0.0.1:8765/** and keep that tab active until it reports
**ALL TESTS PASSED**. Suite names include the site and feature. The page runs
each suite in a fresh iframe; expand Results for assertion details. Failed or
stalled suites are reported, and the remaining suites still run. Stop the server
with Ctrl+C. Set `PORT=8766` if the default port is occupied.

The ChatGPT gallery suites are under `chatgpt/gallery/`:

| Case | Coverage |
| --- | --- |
| `scan` | Pagination, delayed images, owned blobs, scan position, scroll locking, visibility pause/resume, cancellation, conversation changes, fetch fallback, broken images |
| `manual` | Passive capture, disjoint scroll jumps, remounts, pending captures, predecoded insertions, timeline replacement |
| `navigation` | Searching both directions through unloaded turns, pagination, cancellation, chat changes |
| `boundaries` | Silent confirmed ends, immediate search feedback, direction reversal, new content, incomplete searches |
| `branches` | Edit cancellation and submission, preserving earlier images, stale DOM/fetches, new branch images, edits during scans |
| `long-text` | Scan and navigation skip large text spans while retaining sparse images |
| `eligibility` | Real image exclusions during scans, passive capture, and lookup through unloaded turns |

The `chatgpt/retries` suite uses `/sites/chatgpt/retries/fixture.html` to exercise automatic retries without submitting real prompts. Live ChatGPT compatibility still requires a manual smoke check.

The `chatgpt/search-image-eligibility`, `chatgpt/svg-image-eligibility`, `shared/viewer/image-eligibility`,
`gemini/image-eligibility`, and
`grok/image-eligibility` suites compare the actual filter, click targeting, and
navigation collection on synthetic DOM layouts. Their fixture blocks external
image requests; CDN URLs are used only to exercise source-eligibility rules.

To rerun one suite, open
`/sites/chatgpt/gallery/fixture.html?suite=chatgpt/gallery/branches`.
Reload after changing tests or the userscript. The server disables caching and
extracts current source on each request; there are no generated script copies.

Register browser suites once in `support/browser/registry.js`, with a descriptive
ID, fixture page, and case script. Other sites and shared features can supply
their own fixtures without depending on ChatGPT's timeline. Browser cases use
`*.browser.js`; Node cases use `*.test.cjs`.

## Fixture design and limits

`sites/chatgpt/gallery/fixture.js` simulates a virtualized timeline with generated
canvas images and synthetic message IDs. It mounts neighbouring turns, revokes
source blob URLs on unmount, and delays images and history pages. Cases run in
separate documents to isolate listeners and state. Gallery waits are accelerated
20×; layout, scrolling, decoding, MutationObserver callbacks, and fetches run in
the browser. Expected failed blob fetches appear in the console during revocation
and broken-image tests.

`support/source.cjs` extracts shipped functions by explicit source boundaries
and fails loudly if a refactor moves them. A section can combine related function
fragments while omitting unrelated startup side effects. Section names identify ownership,
for example `chatgpt/gallery` and `shared/viewer/navigation`. Surrounding viewer
APIs are stubbed, but gallery fixtures use the real image eligibility rules.
These tests do not prove compatibility with changed live-site
markup, userscript managers, or Chrome background-tab rendering. Check those in
the actual site/browser when relevant. Overriding `document.hidden` does not
establish background support.

Private snapshots and console logs stay in ignored `temp/`. Keep committed
fixtures synthetic. Add regression coverage where a bug belongs, and update the
coverage table when introducing tests for another feature or site.
