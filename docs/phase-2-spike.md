# Phase 2 gate: drag-and-drop across the iframe

The design doc sets one gate for phase 2: drag-and-drop across the iframe passes a
spike review, before publishing is built. This is the material for that review.

## What was built

- The editor (`apps/editor`) shows the tenant's host app in an iframe on another
  origin and draws hover, selection and drop overlays on top of it, from layout boxes
  the host reports.
- Dragging happens entirely in the editor. While a drag is active, a transparent
  overlay takes every pointer event, so the iframe never sees them. Drop targets are
  computed from the latest layout (`apps/editor/src/lib/drop-target.ts`), and a drop
  becomes one JSON Patch sent to the host and saved as a draft.
- The host (`@builder/react/edit`) renders the editor's document with the tenant's
  own components, applies patches, and reports layout once per animation frame. Its
  loaders run on the host's server through `@builder/next`'s edit endpoint.

Supported: inserting from the palette, moving with the selection handle, slot
allow-lists and limits, `placement` and `maxPerPage` constraints, no drops into a
node's own subtree, empty-slot drop zones, auto-scroll near the canvas edges,
Escape to cancel, keyboard moves (Alt+↑/↓), and undo/redo of every drop.

## Method

`e2e/tests/spike.spec.ts`, run with Playwright against the built apps:

- A page with 30 sections, 111 rendered nodes, and 10 odds tables whose data
  comes from host loaders.
- 15 drops: 7 palette inserts at different heights (2 of them components with
  loaders), 5 moves with the selection handle, and 3 inserts that auto-scroll
  the canvas first (the test checks that the canvas did scroll).
- Real pointer input, with 30 pointer moves per drag.
- The editor records three things:
  - the interval between animation frames while dragging;
  - the time to compute a drop target on each pointer move;
  - the time from sending a drop's patch until the host confirms it rendered
    that revision.

The editor runs on `localhost:5173` and the host on `localhost:3000`, so the iframe
is cross-origin, as it will be in production.

## Results

Three runs of the full suite, headless Chromium 141 on the build container:

| Metric | Run 1 | Run 2 | Run 3 | Threshold |
| --- | --- | --- | --- | --- |
| Drop → host rendered, p50 | 27 ms | 34 ms | 32 ms | |
| Drop → host rendered, p95 | 67 ms | 69 ms | 60 ms | < 100 ms |
| Drop-target compute, p95 (≈550 samples) | 0.2 ms | 0.2 ms | 0.2 ms | < 4 ms |
| Drag frame interval, p50 / p95 (≈800 frames) | 16.7 / 16.8 ms | 16.7 / 16.8 ms | 16.7 / 16.8 ms | p50 < 20 ms |

Dragging held 60 fps. Finding the drop target costs a fraction of a millisecond, so
the overlay never lags the pointer. A drop shows up in the host within one or two
frames in the median case, and within about four at p95. One of the 15 drops put
a node back where it already was, so it produced no patch, which is correct. The
test checks that every drop that changed the page was rendered and confirmed.

`pnpm e2e` writes the numbers for each run to `e2e/results/spike.json`. CI uploads
them as the `e2e-results` artifact.

## What the numbers do not cover

- **Loader data after a drop.** A new component that has a loader renders a skeleton
  at once. Its data arrives after a 120 ms debounce plus the host's loader round trip.
  That is network- and tenant-bound, and not part of the drop latency above.
- **Other browsers and devices.** Only Chromium on desktop was tested; Firefox,
  Safari and touch input are not covered yet. Pointer capture and overlay behaviour
  are standard, but they still need a check.
- **Slow machines and large pages.** The host re-renders the whole tree on every
  patch and re-measures every node each frame. At 111 nodes this costs about 30 ms
  per drop. Pages several times larger will need memoised node rendering and layout
  diffs. Both fit the current design without protocol changes.
- **Human feel.** The numbers say the overlay keeps up. Whether the drop zones feel
  right (edge zones, horizontal slots, nested containers) needs a hands-on session.

## Protocol changes made during the spike

The editor–host protocol is v1 as designed, with these additions:

| Direction | Message | Why |
| --- | --- | --- |
| Host → editor | `nodeHover { nodeId }` | Pointer events inside the iframe never reach the editor, so the host reports hover |
| Editor → host | `scrollBy { x, y }` | Auto-scroll while dragging near the canvas edge |
| Host → editor | `ready` on load and in reply to `init` | The editor cannot know when the iframe's bridge is listening; `init` also delivers refreshed edit tokens |
| Host → editor | `error` with `rev_mismatch` / `patch_failed` | The editor answers with `renderTree` to resync |

The host also re-sends its full list of node errors after each `rendered`, so errors
clear as soon as a node is fixed.

## Recommendation

Pass the gate and build publishing (phase 3) on the overlay approach. Before the
pilot tenant, follow up on:

1. A hands-on review of drop feel with someone who edits pages for a living.
2. Firefox and Safari runs in CI.
3. Memoised edit rendering and layout diffs, before pages get much larger than 150 nodes.
