---
id: ADR-0002
date: 2026-07-02
status: Accepted
deciders: Lauri Gates
domain: api-design
supersedes: []
relates-to: [ADR-0001]
github-issues: []
name: adopt-kit-pointer-claim-protocol
---

# ADR-0002: Adopt the comfy-modal-kit pointer-claim protocol

## Context

This pack is a **window-level gesture pack**: it installs capture-phase
`pointerdown` listeners on `window` to observe touch drags (the loupe) and, with
`CONFIG.snap`, to swallow + re-dispatch a near-miss touch at the intended slot
centre (issue #23). The sibling packs in the family are **modal packs** — they
open touch-friendly HTML modals over the canvas.

`@laurigates/comfy-modal-kit` (kit ADR-0001, `laurigates/comfy-modal-kit#8`,
kit tracking issue `laurigates/comfy-modal-kit#9`) defines a **pointer-claim
protocol** so a modal pack and a gesture pack sharing the same page don't both
act on one tap:

- `isModalActive()` — whether *any* pack's modal is currently on screen. All
  inlined kit copies share one global via `Symbol.for("laurigates.comfyModalKit")`,
  so the signal is cross-pack: a modal opened by any family pack is visible here.
- `claimPointer(id)` — advisory announcement that a gesture pack has taken a
  pointer, stored for diagnostics / future arbitration.

The kit modal already renders a full-screen `position: fixed; inset: 0`
backdrop that dismisses (and `stopPropagation`s) any tap landing outside the
dialog, and this pack's snap path already excludes non-canvas targets
(`e.target !== sourceCanvas`). So a tap over an open modal already lands on the
backdrop and this pack already bails. **There is no live reproducible bug.**

## Decision Drivers

- **Explicit protocol over incidental safety.** The current non-interference is
  a side effect of the backdrop + the target-canvas guard. Making the veto an
  explicit `if (isModalActive()) return;` states the intent in the code, so a
  future refactor of either guard can't silently re-introduce cross-pack tap
  contention.
- **Defense-in-depth.** Two independent mechanisms (kit backdrop + this pack's
  own veto) are strictly safer than one, at negligible cost (a boolean read).
- **Observability.** `claimPointer("touch-connect")` at the moment the snap
  commits gives peers a record of who owns the gesture — the gesture-pack half
  of the protocol the modal packs already participate in.
- **Family consistency.** Adopting the shared kit protocol keeps this pack on
  the same coordination contract as its siblings rather than relying on
  pack-local invariants.

## Considered Options

1. **Adopt the kit pointer-claim protocol** — depend on `@laurigates/comfy-modal-kit`,
   veto both gesture entry points with `isModalActive()`, and `claimPointer()` on
   snap commit.
2. **Do nothing** — rely on the kit backdrop and the existing target-canvas guard
   to keep taps over a modal away from this pack.
3. **Hand-roll a private cross-pack modal flag** — duplicate the kit's
   `Symbol.for` global locally instead of consuming the published primitive.

## Decision Outcome

**Chosen option**: "Adopt the kit pointer-claim protocol". The kit is added as
the pack's first runtime dependency (`@laurigates/comfy-modal-kit@^0.4.0`, which
exports `isModalActive` and `claimPointer`). It is **inlined at build** — `bun
build --target browser` bundles it into `web/dist/index.js` (ADR-0001), so
nothing ships from `node_modules` at runtime and the zero-runtime-bundle
property is preserved.

Integration points (`src/index.ts`):

- `onPointerDown` (passive loupe observation) — early `if (isModalActive()) return;`
  so `watchForDrag` never starts behind an open modal.
- `onPointerDownSnap` (`CONFIG.snap`) — `if (isModalActive()) return;` alongside
  the existing stand-down guards, and `claimPointer("touch-connect")` at the point
  the gesture commits a real snap (just before it swallows + re-dispatches the
  synthetic pointerdown).

This is **defense-in-depth plus an explicit protocol and observability**, not a
fix for a live reproducible bug.

### Positive Consequences

- Cross-pack non-interference is now an explicit, self-documenting contract, not
  an emergent property of two unrelated guards.
- Peer packs can observe pointer ownership via the shared claim.
- The pack joins the family's shared coordination protocol; the `Symbol.for`
  global means the veto respects modals opened by *any* family pack.

### Negative Consequences

- First runtime dependency for the pack (previously dev-only). Mitigated by
  build-time inlining — no runtime `node_modules` footprint, one bundled copy.
- A minified copy of the kit's coordinator is bundled into `web/dist/index.js`;
  each family pack carries its own inlined copy that reconcile via the shared
  global, by design.

## Pros and Cons of Options

### Adopt the kit pointer-claim protocol

- ✅ Explicit, self-documenting cross-pack veto
- ✅ Defense-in-depth over the incidental backdrop guarantee
- ✅ `claimPointer` observability; family-consistent
- ❌ Adds a (build-inlined) runtime dependency

### Do nothing

- ✅ Zero change
- ❌ Non-interference stays incidental — a guard refactor can silently regress it
- ❌ No pointer-ownership signal for peers

### Hand-roll a private cross-pack flag

- ✅ No dependency
- ❌ Duplicates the kit's `Symbol.for` contract — drifts from the published one
- ❌ Reinvents a maintained primitive (against DRY)

## Links

- Kit protocol: `laurigates/comfy-modal-kit` ADR-0001 (`laurigates/comfy-modal-kit#8`),
  kit tracking issue `laurigates/comfy-modal-kit#9`.
- Relates to ADR-0001 (TypeScript + bun build) — the build-inlining that
  preserves the zero-runtime-bundle property for this dependency.
- `CLAUDE.md` § "The pattern", § "Hard rules".

---
*Authored as part of the kit pointer-claim protocol adoption.*
