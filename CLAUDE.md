# CLAUDE.md

Frontend-only ComfyUI custom-node pack. `__init__.py` is a loader stub; the whole extension lives in `web/js/`.

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

Pure geometry/state helpers (`computeSourceRect`, `clampLoupePosition`,
`isConnecting`) are exported from `touch-connect.js` and unit-tested in the
`node` Vitest env; the DOM/canvas wiring is covered by the manual browser
smoke matrix.

## File layout

| Path | Purpose |
|------|---------|
| `__init__.py` | Loader stub. Empty `NODE_CLASS_MAPPINGS`; exports `WEB_DIRECTORY = "./web"`. |
| `web/js/touch-connect.js` | The extension: pointer tracking + magnifier loupe over the canvas. |
| `pyproject.toml` | Comfy Registry metadata. `PublisherId` + `version` are the fields you touch. |
| `.github/workflows/` | `ci.yml` (ruff/biome/pytest/vitest/gitleaks), `publish.yml` (auto-publish on version bump), `release-please.yml`. |
| `tests/` | pytest backend suite. `tests/js/` Vitest suite for pure JS helpers. |
| `justfile` | `lint`, `format`, `test`, `check` recipes — the local CI gate. |

## Hard rules

- **Pack directory name is part of the URL.** `web/js/touch-connect.js` is
  served at `/extensions/comfyui-touch-connect/js/touch-connect.js`. Renaming the pack dir
  breaks every fetch. If unavoidable, sync `EXT_NAME` in the JS.
- **No Python dependencies. The pack is frontend-only; a feature genuinely needing Python belongs in a separate companion pack.**
- **Additive + non-intrusive only.** Never patch LiteGraph methods; observe via
  passive capture-phase listeners and a `pointer-events:none` overlay. The loupe
  is purely visual — it must never consume or alter the pointer events that
  drive the actual connection.
- **Read the canvas, never `getImageData`.** Magnify with `drawImage` canvas→
  canvas to avoid tainting and keep it origin-agnostic.
- **Detect drag state defensively.** `isConnecting()` checks both the modern
  `connecting_links` array and legacy `connecting_node/_output/_input`; if a
  future frontend renames these, the loupe simply stops activating (no crash).

## Dev workflow

```sh
uv sync --group dev          # ruff, pytest, pre-commit
npm install --no-audit --no-fund   # Vitest (dev-only; nothing ships from node_modules)
pre-commit install
just check                   # lint + test — the local CI gate
```

Iterating on JS/CSS/JSON needs **no ComfyUI restart** — hard-refresh the tab.


### Endpoint reachability check

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8188/extensions/comfyui-touch-connect/js/touch-connect.js
```

## Releases

Bump `version` in `pyproject.toml` and push to `main` →
`Comfy-Org/publish-node-action` publishes to the Comfy Registry. Requires
the `REGISTRY_ACCESS_TOKEN` repo secret. Use conventional commits;
release-please maintains `CHANGELOG.md` and the version bump PR.
