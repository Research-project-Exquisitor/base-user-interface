# exq-ui
User Interface for Exquisitor.


## Setup
To install the application
```
npm install
```

By default the UI connects to the Exquisitor service at `https://localhost:5000`. To use a service at a different address, change `exqURI` in `src/services/http.ts`.

> [!NOTE]
> Mock data is off by default. To run the UI without a live Exquisitor service, set `mock = true` in `src/services/http.ts`.

## Run

### Development
Starts a dev server with hot reload at http://localhost:3000
```
npm run dev
```

### Production build
Type-checks and builds the app into `dist/`
```
npm run build
```

Preview the build locally at http://localhost:4173
```
npm run preview
```

To deploy, serve the contents of `dist/` from any static web server (e.g. nginx, Apache, `npx serve dist`). Configure it to fall back to `index.html` for unknown paths, otherwise refreshing on an app route returns a 404.

> [!IMPORTANT]
> Opening `dist/index.html` directly from disk (`file://`) does not work. Browsers block the app's module scripts outside of HTTP, so it must be served.

## Research events (phase 3b)

Use this UI with the matching backend: `POST /exq/log/clientEvent` now accepts
structured research events; the old generic tracker and MessagePack audit log
are retired. Keep your local `exqURI` matched to the server address.

`recordResearchEvent` is the only UI research logger. Search clients use
`postSearch`, with correlation headers constructed in `http.ts`. Result pages
carry `{ requestId, ids }` through history, RF and Load More. Grid state includes
rendered order and grouped layouts; related clicks retain their search context.

Events cover model tabs, filters (including cleared ranges), temporal dialog
changes, rendered results, relevance labels, related-item opening, video
segments/playback/seeking, and answer submissions. Automatic seeks have a
`cause` distinct from user seeks. No generic click, keypress, hover,
`timeupdate`, or `volumechange` stream is recorded. Result-state events describe
rendered results, not evidence that a participant looked at each result.

Without DRES evaluations, answer buttons capture a local `answer_submission`
and report **CAPTURED**, with no verdict. With an evaluation selected, the same
event precedes the DRES request. Delivery retries and persistence are phase 4;
local capture is not a durability acknowledgement.

Run `npm run test:research`, `npm run build`, and `npm run check:event-types`.
The latter checks generated types against the sibling engine's Python schema.

Manual check: run searches, Load More, RF, open related items, change filters,
open/play/seek a video, and record an answer. Inspect
`../live-services-engine/logs/raw/session-<id>.jsonl`. Search submission,
execution and response share a request ID; execution inherits the submission
sequence. Historical `audit.log` files should not grow.

The component logging tests compile the actual Vue setup functions and run their
watchers with fixture stores and video-element doubles. They check filter edits
and closure, temporal actions, related-item provenance, and playback/seek
context. They do not test browser media decoding or network video delivery.
