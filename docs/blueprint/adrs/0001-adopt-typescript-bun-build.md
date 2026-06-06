---
id: ADR-0001
date: 2026-06-06
status: Accepted
deciders: Lauri Gates
domain: build-tooling
supersedes: []
relates-to: []
github-issues: []
name: blueprint-derive-adr
---

# ADR-0001: Adopt TypeScript + bun build

## Context

`comfyui-touch-connect` shipped its first releases as a single hand-served
vanilla-JS file (`web/js/touch-connect.js`, served directly via
`WEB_DIRECTORY = "./web"`). That no-bundler / single-file-JS approach was never
captured as a formal ADR in this repo — it was the implicit default carried
over from the sibling packs' early scaffolds. This ADR records the move off it,
and supersedes that implicit decision.

## Decision Drivers

- The pack reaches into the minified ComfyUI frontend's LiteGraph canvas
  objects (`app.canvas`, `lgcanvas.connecting_links` / `connecting_node` /
  `connecting_output` / `connecting_input`, the backing `canvas` element, the
  `drawImage` source-rect math). Those accesses are exactly where a
  frontend-version bump silently breaks the pack. Type checking against
  `@comfyorg/comfyui-frontend-types` turns a class of those breakages into
  compile errors.
- A bun-externalization spike confirmed the toolchain keeps the
  zero-runtime-bundle property: `bun build ./src/index.ts --target browser
  --format esm --outdir web/dist --external '/scripts/*'` emits browser-clean
  ESM with the `/scripts/app.js` runtime import left **unbundled** (resolved at
  runtime against ComfyUI's served module). The browser still loads a plain ES
  module, ComfyUI still serves it as a static file — now from a typed source.
- The pack already carried a `package.json` + a Vitest dev dependency (the pure
  geometry/state helpers `computeSourceRect`, `clampLoupePosition`,
  `isConnecting` are unit-tested), so adding a build step on top of an existing
  dev toolchain is a small delta.
- This mirrors the completed, green TypeScript + bun migration in the sibling
  pack `comfyui-sampler-info` (its ADR-0010). Keeping the family on one
  toolchain reduces per-pack divergence.

## Considered Options

1. **TypeScript source in `src/`, built to `web/dist/` via `bun build`** —
   typed authoring, browser-ESM output, `/scripts/*` externalized.
2. **Stay on single-file vanilla JS** — no build, no types.
3. **TypeScript with `tsc` emit instead of `bun build`** — `tsc` can emit ESM
   but does not understand the `--external '/scripts/*'` runtime-import concept;
   it is a type checker first, a bundler never.

## Decision Outcome

**Chosen option**: "TypeScript source in `src/`, built to `web/dist/` via
`bun build`". The spike proved the output preserves the runtime contract, and
the type checker pays for itself at the frontend seam. `tsc --noEmit` is the
type gate; `bun build` is the emit. The two are decoupled — `tsc` never emits,
`bun` never type-checks — keeping each fast and single-purpose.

### Build & serve mechanics

- **Source**: `src/index.ts` (the port of the former
  `web/js/touch-connect.js`) plus `src/comfyui-shims.d.ts`.
- **Type gate**: `bun run typecheck` → `tsc --noEmit` against
  `@comfyorg/comfyui-frontend-types` (dev dependency).
- **Emit**: `bun run build` →
  `bun build ./src/index.ts --target browser --format esm --outdir web/dist
  --external '/scripts/*'`. This pack ships no static-data corpus, so there is
  no `web/data/` copy step (unlike `comfyui-sampler-info`).
- **Serve**: `__init__.py` sets `WEB_DIRECTORY = "./web/dist"`. ComfyUI serves
  that tree at `/extensions/comfyui-touch-connect/`, so the built JS is at
  `/extensions/comfyui-touch-connect/index.js`. (The served URL segment moved
  from `…/js/touch-connect.js` to `…/index.js`. The pack injects nothing by
  path — it only registers the extension — so no in-code path needed updating.)
- **Distribution**: `web/dist/` is git-ignored (it is generated). The Comfy
  Registry tarball includes it via `[tool.comfy] includes = ["web/dist"]`, and
  CI (`publish.yml`) runs `bun run build` before `publish-node-action` so the
  artifact exists at publish time.

### Type-seam notes (for future maintainers)

- `@comfyorg/comfyui-frontend-types` exports `ComfyApp` at the module root but
  **not** `LGraphCanvas` / the widget interfaces (declared internally,
  un-exported). The pack models the small surface it touches with local
  structural interfaces (`LGraphCanvasLike`, `RectLike`) rather than importing
  un-exportable types.
- TypeScript will not match an ambient `declare module` against a rooted
  (`/scripts/app.js`) path specifier. A `paths` mapping in `tsconfig.json`
  points that import at `src/comfyui-shims.d.ts` for type resolution; the
  emitted import string stays `/scripts/app.js` and `--external '/scripts/*'`
  keeps it unbundled.
- TS does not carry guard-narrowing of a captured outer binding into nested
  closures, so `sourceCanvas` and `lctx` are re-bound to narrowed `const`s after
  their null guards (the `render`/`frame` closures capture the narrowed const).

### Positive Consequences

- Static type checking at the version-sensitive frontend seam — the single
  largest source of silent breakage now has a compile-time gate.
- Output is still plain browser ESM served as a static file; no runtime
  bundler, no framework, no change to how ComfyUI loads the extension.
- The three pure helpers keep their exact export names
  (`computeSourceRect`, `clampLoupePosition`, `isConnecting`), so the Vitest
  suite imports the `.ts` source directly with no build dependency in tests.
- `knip` + `tsc` + Vitest + Biome give a complete local gate chain.

### Negative Consequences

- The "edit → hard-refresh" loop now requires a `bun run build` step (the served
  file is `web/dist/index.js`, not the source). Mitigated by `just build` and a
  fast (~3 ms) incremental build.
- A build artifact must be present for the screenshot pipeline and the registry
  publish; both are wired to build first, but a fresh checkout has no
  `web/dist/` until `bun run build` runs.
- One more dev dependency set (`typescript`, `@comfyorg/comfyui-frontend-types`,
  `knip`) and a `tsconfig.json` to maintain.

## Pros and Cons of Options

### TypeScript + bun build

- ✅ Static types at the frontend seam
- ✅ Browser-ESM output preserves the runtime contract (spike-confirmed)
- ✅ Decoupled type gate (`tsc --noEmit`) and emit (`bun build`)
- ❌ Adds a build step to the edit-refresh loop
- ❌ Generated artifact must be built before publish / screenshots

### Stay on single-file vanilla JS

- ✅ Zero build toolchain
- ❌ No type safety at the exact place breakage happens
- ❌ A `package.json` + Vitest already eroded the "no toolchain" premise

### TypeScript with `tsc` emit

- ✅ Single tool for typecheck + emit
- ❌ `tsc` is not a bundler; the `/scripts/*` externalize concept is a bundler
  feature
- ❌ Worse fit than `bun build` for the browser-ESM-with-external target

## Links

- Sibling-pack precedent: `comfyui-sampler-info` ADR-0010 (same migration).
- Bun externalization spike: `bun build ./src/index.ts --target browser
  --format esm --outdir web/dist --external '/scripts/*'` (PASSED — emits ESM
  with `/scripts/app.js` left external).
- `CLAUDE.md` § "File layout", § "Dev workflow".

---
*Authored as part of the TypeScript + bun build migration.*
