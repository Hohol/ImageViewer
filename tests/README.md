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
  sites/
    chatgpt/
      navigation-debug.test.cjs
      gallery/
        fixture.{html,css,js}
        *.browser.js
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
| Shared viewer navigation | Partial: cached navigation, ChatGPT search handoff, repeated keys, stale-result cancellation, basic non-ChatGPT fallback |
| ChatGPT gallery | Scan, passive capture, virtualized history, directional searches, boundaries, edited branches, long text spans |
| ChatGPT navigation diagnostics | Detached images, turn changes, URL redaction, bounded logs, listener cleanup |
| Gemini integration | No dedicated tests yet |
| Grok integration | No dedicated tests yet, including saved-media filters and deletion controls |
| Other shared viewer features | No dedicated tests yet for image eligibility, fit/zoom, fullscreen, clipboard, new-tab opening, hotkeys, video controls, or loop export |

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

The current browser suites are all under `chatgpt/gallery/`:

| Case | Coverage |
| --- | --- |
| `scan` | Pagination, delayed images, owned blobs, scan position, cancellation, conversation changes, fetch fallback, broken images |
| `manual` | Passive capture, disjoint scroll jumps, remounts, pending captures, predecoded insertions, timeline replacement |
| `navigation` | Searching both directions through unloaded turns, pagination, cancellation, chat changes |
| `boundaries` | Silent confirmed ends, immediate search feedback, direction reversal, new content, incomplete searches |
| `branches` | Edit cancellation and submission, preserving earlier images, stale DOM/fetches, new branch images, edits during scans |
| `long-text` | Scan and navigation skip large text spans while retaining sparse images |

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
and fails loudly if a refactor moves them. Section names identify ownership,
for example `chatgpt/gallery` and `shared/viewer/navigation`. Surrounding viewer
APIs are stubbed. These tests do not prove compatibility with changed live-site
markup, userscript managers, or Chrome background-tab rendering. Check those in
the actual site/browser when relevant. Overriding `document.hidden` does not
establish background support.

Private snapshots and console logs stay in ignored `temp/`. Keep committed
fixtures synthetic. Add regression coverage where a bug belongs, and update the
coverage table when introducing tests for another feature or site.
