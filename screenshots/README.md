# README screenshot pipeline

Containerized [Playwright](https://playwright.dev) + ComfyUI generator that
regenerates the README screenshot (`docs/loupe.png`) reproducibly, so the
shot doesn't depend on whatever theme/frontend a particular dev machine
happens to have.

## Run

From the repo root:

```sh
just screenshots
```

First build is ~4 min (clones ComfyUI, installs CPU torch + ComfyUI deps,
pulls the npm driver dep on top of the pre-baked Chromium). Cached rebuilds
are ~30s. The PNG lands at `docs/loupe.png`.

## How it works — gesture pack, no modal

touch-connect is a **canvas-gesture** pack: the magnifier loupe only appears
*during a touch connection-drag*. There is no dialog to screenshot, and a
live finger-drag can't be produced headlessly any other way — so the driver
synthesizes exactly that state through the pack's real public surface:

1. `Dockerfile` builds on the official Playwright image, clones a pinned
   ComfyUI release, and installs CPU-only torch + ComfyUI's requirements.
2. `entrypoint.sh` launches ComfyUI headless on `:8188` (`--cpu`), waits for
   `/system_stats`, then runs the capture driver.
3. `capture.mjs` (Playwright) loads `workflow.json` (a small connected graph,
   so the canvas shows slots + a link), forces the LiteGraph connecting-drag
   state (`canvas.connecting_links`), and dispatches a synthetic **touch**
   pointer over an input slot — the same window pointer events the pack
   listens to. That activates the loupe, which magnifies the real canvas
   region under the finger via `drawImage(sourceCanvas, …)`. The driver then
   screenshots the loupe overlay element.
4. The shot is the genuine pack overlay, not a mock-up.
5. The driver writes to `/out`, which the `just` recipe mounts to `docs/`.

| File | Purpose |
|------|---------|
| `Dockerfile` | Single-stage build (Playwright base + ComfyUI + CPU torch). |
| `Dockerfile.dockerignore` | Keeps the build context lean. |
| `entrypoint.sh` | Boots ComfyUI, waits for ready, runs the driver, asserts `$EXPECTED_OUTPUTS` exist. |
| `capture.mjs` | Playwright driver — forces the drag state, fires a touch pointer, shoots the loupe. |
| `workflow.json` | Connected two-node graph (EmptyLatentImage → VAEDecode) the driver loads. |
| `package.json` | Pins the Playwright npm version for the driver. |

## Pins (bump deliberately)

- **`ARG COMFYUI_REF`** (`Dockerfile`) — the ComfyUI release. The canvas is
  rendered by the frontend bundle that ships with this release; `v0.22.0`
  ships `comfyui-frontend-package==1.43.18`.
- **Playwright version** — pinned in BOTH `Dockerfile` (`FROM
  mcr.microsoft.com/playwright:v1.49.1-noble`) and `package.json`. Keep them
  in lockstep: the base-image tag pins the Chromium revision (the largest
  source of cross-host font-rendering drift) and the npm dep is the driver
  API. Bump both together.

## Don't hand-edit `docs/loupe.png`

It's generated. To change it, edit `capture.mjs` / `workflow.json` and
re-run `just screenshots`.
