# CLAUDE.md

Frontend-only ComfyUI custom-node pack. `__init__.py` is a loader stub
(`WEB_DIRECTORY = "./web/dist"`); the extension is authored in TypeScript
(`src/index.ts`) and compiled to browser ESM via `bun build` (see ADR-0001).

## Documentation & Design Records

**Architecture Decisions:**

| ID | Title | Domain |
|----|----|--------|
| [ADR-0001](docs/blueprint/adrs/0001-adopt-typescript-bun-build.md) | Adopt TypeScript + bun build (supersedes the implicit single-file-JS / no-bundler default) | build-tooling |

## The pattern

A mobile-first ComfyUI usability pack. Unlike the sibling packs
(`comfyui-gallery-loader`, `comfyui-sampler-info`) this one does **not** use
the widget→modal "vein" — node-connection dragging is a **canvas-level**
interaction owned by LiteGraph's `LGraphCanvas` (`connecting_links` drag
state), not a node widget.

Instead the extension shows a magnifier **loupe** offset from the fingertip
while a connection drag is in progress, so the user can see the slot they are
grabbing/aiming at instead of having it hidden under their finger.

- **Decoupled from LiteGraph internals.** It listens to `pointer*` events on
  `window` (capture phase, passive) to track the live touch position + pointer
  type, and *polls* the canvas drag state (`isConnecting()`) rather than
  patching `processMouseDown/Move/Up` (whose names drift across the
  `@comfyorg/litegraph` fork).
- **Live magnification.** Each animation frame it copies the region of the real
  canvas under the finger into the loupe via `drawImage(sourceCanvas, …)`
  (canvas→canvas, so no `getImageData` and no taint/CORS issues), magnified by
  `CONFIG.zoom`, with a crosshair at the exact pointer point. LiteGraph's own
  redraw during the drag means the loupe shows the real link + highlighted
  compatible slots.
- **Touch only + fail-safe.** Activates only for `pointerType` in
  `ACTIVATE_POINTER_TYPES` (`touch`). Mouse/trackpad input is untouched. The
  overlay is `pointer-events:none` and listeners are passive, so it never
  interferes with LiteGraph's handling of the same events.

### Port snapping — link START (issue #23)

The loupe assists the **end** of a link drag but cannot help the **start**: a
purely-visual overlay can't fix a source slot that LiteGraph already committed
under the finger on `pointerdown`. So `CONFIG.snap` (touch only, on by default)
adds the one deliberate exception to "never alter pointer events":

- Our `window` capture-phase `pointerdown` listener runs **before** LiteGraph's
  own `canvas`-element capture listener. When a touch lands *near but not on* a
  slot, we `stopImmediatePropagation()` + `preventDefault()` the real touch and
  re-dispatch an identical `pointerdown` at the slot centre — same `pointerId`,
  so LiteGraph's `setPointerCapture(pointerId)` still routes the live finger's
  move/up to the canvas. **Only `pointerdown` is corrected; move/up pass through
  untouched**, so the link follows the real fingertip.
- "Near but not on" = `pickSnapPort`: nearest slot whose distance to the finger
  is `> CONFIG.snapDeadZone` (inside that, LiteGraph's native hit already wins —
  don't interfere) and `≤ CONFIG.snapRadius` (beyond that it's a genuine miss /
  deliberate node-drag — leave it). Slot centres come from `node.getInputPos` /
  `getOutputPos` (graph coords) projected to client px via `ds.offset`/`ds.scale`.
- **Fail-safe + reversible.** Missing `ds`/`graph` → no candidates → no-op. Set
  `CONFIG.snap = false` to restore the original purely-observational behaviour.
- ⚠️ **Needs on-device confirmation.** The synthetic-pointer re-dispatch
  (`pointerId` reuse + `setPointerCapture` on the live touch) is the risk point;
  `snapRadius`/`snapDeadZone` are tuning knobs to settle on real touch hardware.

Pure geometry/state helpers (`computeSourceRect`, `clampLoupePosition`,
`isConnecting`, `pickSnapPort`) are exported from `src/index.ts` and unit-tested
in the `node` Vitest env; the DOM/canvas wiring is covered by the manual browser
smoke matrix.

### Verified frontend API (recheck on `comfyui-frontend-package` bump)

Confirmed against the bundled `api-*.js.map` sourcemap (see the path-scoped
`comfyui-frontend-api` rule). Current package verified at the version installed
in `.venv` as of issue #23.

| Symbol | Finding |
|---|---|
| `LGraphCanvas` pointerdown listener | `canvas.addEventListener('pointerdown', cb, true)` — **capture phase, on the canvas element**. A `window` capture listener fires first, so `stopImmediatePropagation()` there gates the real touch before LiteGraph sees it. |
| `CanvasPointer.down()` | Calls `element.setPointerCapture(e.pointerId)`. Re-dispatching with the **same `pointerId`** keeps move/up routed to the canvas. |
| `connecting_links` | `@deprecated` — populated for legacy extensions but **ignored** by LiteGraph; the live drag state is owned by `LinkConnector`. Still a valid *read* signal for `isConnecting()`. |
| Source-slot grab | On pointerdown LiteGraph hit-tests `isInRectangle(x, y, link_pos[0]-15, link_pos[1]-10, 30, 20)` per output slot, then `linkConnector.dragNewFromOutput(graph, node, output)`. A near-miss on the node body instead starts a **node drag** (`_startDraggingItems`). |
| `node.getInputPos(slot)` / `getOutputPos(slot)` | Return the slot-centre `Point` in **graph coords**. |
| `ds.offset` / `ds.scale` (`DragAndScale`) | Project graph→client px: `client = (graph + offset)·scale + rect.{left,top}`. |
| `graph._nodes` | Array of nodes; `node.flags.collapsed` hides slots (skip when collecting snap candidates). |

## File layout

| Path | Purpose |
|------|---------|
| `__init__.py` | Loader stub. Empty `NODE_CLASS_MAPPINGS`; exports `WEB_DIRECTORY = "./web/dist"`. |
| `src/index.ts` | The whole extension — TypeScript source (port of the former single-file JS). Compiled to `web/dist/index.js`. |
| `src/comfyui-shims.d.ts` | Types the `/scripts/app.js` runtime import (see ADR-0001 type-seam notes). |
| `web/dist/` | **Generated** — `bun build` output (`index.js`). Git-ignored; force-shipped to the registry via `[tool.comfy] includes`. Do not edit by hand. |
| `tsconfig.json` | TypeScript config — strict, `tsc --noEmit` type gate, `/scripts/app.js` paths shim. |
| `knip.json` | Dead-code / unused-dependency check config. |
| `pyproject.toml` | Comfy Registry metadata. `PublisherId` + `version` are the fields you touch; `[tool.comfy] includes = ["web/dist"]`. |
| `.github/workflows/` | `ci.yml` (ruff/biome/typecheck+build/pytest/vitest/gitleaks), `publish.yml` (build then auto-publish on version bump), `release-please.yml`. |
| `tests/` | pytest backend suite (loader stub). `tests/js/` Vitest suite for the pure helpers in `src/index.ts`. |
| `package.json` | Dev toolchain — `bun build`, `tsc`, Vitest, Biome, knip. |
| `vitest.config.js` | Vitest configuration (Node env; aliases `/scripts/app.js` to the mock; imports `src/index.ts`). |
| `justfile` | `lint`, `typecheck`, `build`, `knip`, `test`, `check` recipes — the local CI gate. |

## Hard rules

- **Pack directory name is part of the URL.** The built `web/dist/index.js` is
  served at `/extensions/comfyui-touch-connect/index.js`. Renaming the pack dir
  changes that URL. If unavoidable, sync `EXT_NAME` in `src/index.ts`.
- **No Python dependencies. The pack is frontend-only; a feature genuinely needing Python belongs in a separate companion pack.**
- **Additive + non-intrusive only.** Never patch LiteGraph methods; observe via
  passive capture-phase listeners and a `pointer-events:none` overlay. The loupe
  is purely visual — it must never consume or alter the pointer events that
  drive the actual connection. **One sanctioned exception:** the `CONFIG.snap`
  port-snap (issue #23) corrects the `pointerdown` *coordinates* by swallowing
  and re-dispatching the touch (never patches a LiteGraph method, never touches
  move/up). It is gated behind `CONFIG.snap` and reversible to the
  purely-observational behaviour. Do not broaden this into method-patching or
  altering move/up.
- **Read the canvas, never `getImageData`.** Magnify with `drawImage` canvas→
  canvas to avoid tainting and keep it origin-agnostic.
- **Detect drag state defensively.** `isConnecting()` checks both the modern
  `connecting_links` array and legacy `connecting_node/_output/_input`; if a
  future frontend renames these, the loupe simply stops activating (no crash).

## Dev workflow

```sh
uv sync --group dev          # ruff, pytest, pre-commit
bun install                  # typescript, types, Vitest, Biome, knip (dev-only)
pre-commit install
just check                   # lint + typecheck + build + knip + test — local CI gate
```

### Build

```sh
bun run build                # compile src/index.ts → web/dist/index.js
bun run typecheck            # tsc --noEmit type gate
just build                   # same as `bun run build`
```

The served file is `web/dist/index.js` — `web/dist/` is git-ignored and
generated. After editing `src/index.ts` you must `bun run build` before
hard-refreshing the tab (no ComfyUI restart needed).

### Gates before commit

```sh
bun run typecheck
bun run build
bunx biome check .
bun run knip
uv run pytest -v
bun run test
```

### Endpoint reachability check

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8188/extensions/comfyui-touch-connect/index.js
```

## Releases

Bump `version` in `pyproject.toml` and push to `main` →
`Comfy-Org/publish-node-action` publishes to the Comfy Registry. Requires
the `REGISTRY_ACCESS_TOKEN` repo secret. Use conventional commits;
release-please maintains `CHANGELOG.md` and the version bump PR.
