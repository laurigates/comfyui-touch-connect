// Touch Connect — ComfyUI frontend extension.
//
// Served at /extensions/comfyui-touch-connect/index.js — the pack directory
// name IS this URL segment. Do not rename the pack dir without syncing
// EXT_NAME below.
//
// What it does
// ------------
// On touch devices, dragging a link between two node slots is painful: the
// slots are tiny dots and your fingertip sits directly on top of the one you
// are trying to grab or hit. This extension shows a magnifier "loupe" offset
// from the finger while a connection drag is in progress, so you can see what
// is under your fingertip and aim accurately.
//
// How it works (deliberately NOT the widget→modal "vein" of the sibling packs)
// ----------------------------------------------------------------------------
// Node connection dragging is a CANVAS-level interaction owned by LiteGraph's
// LGraphCanvas (the `connecting_links` drag state), not by any node widget. So
// instead of wrapping `widget.onPointerDown`, this extension:
//   1. listens to pointer events on the window (capture phase) to track the
//      live touch position + pointer type, decoupled from LiteGraph internals;
//   2. on a touch pointerdown, briefly watches the LGraphCanvas connection-drag
//      state; if a drag starts, it activates the loupe;
//   3. each animation frame, copies the region of the real canvas under the
//      finger into the loupe canvas, magnified (drawImage canvas→canvas — no
//      getImageData, so no taint/CORS issues), and draws a crosshair;
//   4. ends the loupe on pointerup/cancel or when the drag state clears.
//
// Additive + fail-safe: it never patches LiteGraph methods, never consumes the
// pointer events (passive, pointer-events:none overlay), and silently no-ops if
// the canvas or its drag state cannot be found. Mouse/trackpad input is left
// completely untouched.

import { claimPointer, isModalActive } from "@laurigates/comfy-modal-kit";
import { app } from "/scripts/app.js";

const EXT_NAME = "comfyui-touch-connect";

// Pointer types that get the loupe. Touch only, per design. Add "pen" here if
// stylus users want it too (same occlusion problem, smaller tip).
const ACTIVATE_POINTER_TYPES = new Set(["touch"]);

const CONFIG = {
  zoom: 2.5, // magnification factor of the region under the finger
  size: 168, // loupe diameter in CSS px
  offset: 96, // gap (CSS px) between the fingertip and the near loupe edge
  margin: 8, // keep the loupe at least this far from the viewport edges
  watchMs: 350, // after a touch press, watch this long for a drag to begin

  // Port snapping (issue #23 — link START on touch). On a touch pointerdown
  // near (but not on) a node slot, swallow the real touch and re-dispatch it at
  // the slot centre so LiteGraph grabs the intended port instead of missing it.
  // Set `snap: false` to revert to the original purely-observational behaviour.
  snap: true,
  snapRadius: 30, // px from a slot centre within which a near-miss snaps to it
  snapDeadZone: 14, // px — inside this LiteGraph's own hit-test already wins; don't interfere
};

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

// A DOMRect-like slice — only the members the geometry helpers read. Lets the
// pure functions stay testable with plain objects (the Vitest suite passes
// `{ left, top, width, height }` literals).
interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SourceRectInput {
  clientX: number;
  clientY: number;
  rect: RectLike;
  canvasW: number;
  canvasH: number;
  size: number;
  zoom: number;
}

interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface LoupePositionInput {
  clientX: number;
  clientY: number;
  viewportW: number;
  viewportH: number;
  size: number;
  offset: number;
  margin: number;
}

interface LoupePosition {
  left: number;
  top: number;
  flipped: boolean;
}

// The small structural slice of LiteGraph's LGraphCanvas this pack reaches
// into. The `@comfyorg/comfyui-frontend-types` package does not re-export the
// LGraphCanvas type, so we model only the connection-drag fields + the backing
// canvas element used as the magnify source. Everything else is left off so the
// seam stays narrow.
interface LGraphCanvasLike {
  canvas?: HTMLCanvasElement;
  connecting_links?: unknown[];
  connecting_node?: unknown;
  connecting_output?: unknown;
  connecting_input?: unknown;
  // Used by the port-snap feature to project slot positions to screen space.
  ds?: DragAndScaleLike;
  graph?: GraphLike;
}

// DragAndScale: graph→screen transform. `client = (graph + offset)·scale + rect`.
interface DragAndScaleLike {
  offset: [number, number];
  scale: number;
}

interface GraphLike {
  _nodes?: NodeLike[];
}

// The slim slice of LGraphNode the snap feature reads: slot arrays (for counts)
// and the graph-coordinate slot-centre getters.
interface NodeLike {
  inputs?: unknown[];
  outputs?: unknown[];
  flags?: { collapsed?: boolean };
  getInputPos?(slot: number): [number, number];
  getOutputPos?(slot: number): [number, number];
}

// A slot centre already projected into viewport (client) coordinates.
interface PortPoint {
  clientX: number;
  clientY: number;
}

interface SnapPickInput {
  fingerX: number;
  fingerY: number;
  ports: PortPoint[];
  snapRadius: number;
  deadZone: number;
}

// The `app` import is typed via the tsconfig `paths` shim → `comfyui-shims.d.ts`
// as `ComfyApp`. `app.canvas` is typed there, but `canvasEl` is a legacy
// fallback not on the public type, so reach for it through a structural cast.
interface AppCanvasFallback {
  canvasEl?: HTMLCanvasElement;
}

// --------------------------------------------------------------------------- //
// Pure helpers (exported for unit tests — no DOM access here)
// --------------------------------------------------------------------------- //

/**
 * Region of the SOURCE canvas (in its intrinsic pixel space) to magnify.
 *
 * The canvas element is laid out at `rect` CSS pixels but has `canvasW`×`canvasH`
 * backing-store pixels (devicePixelRatio scaling), so a CSS point maps to the
 * pixel buffer by `canvasW / rect.width`. We sample a `size/zoom` CSS-px window
 * centred on the finger and return it in backing-store coordinates for drawImage.
 */
export function computeSourceRect({
  clientX,
  clientY,
  rect,
  canvasW,
  canvasH,
  size,
  zoom,
}: SourceRectInput): SourceRect {
  const scaleX = rect.width ? canvasW / rect.width : 1;
  const scaleY = rect.height ? canvasH / rect.height : 1;
  const pxX = (clientX - rect.left) * scaleX;
  const pxY = (clientY - rect.top) * scaleY;
  const sw = (size / zoom) * scaleX;
  const sh = (size / zoom) * scaleY;
  return { sx: pxX - sw / 2, sy: pxY - sh / 2, sw, sh };
}

/**
 * Where to place the (position:fixed) loupe in viewport coordinates.
 *
 * Default: horizontally centred on the finger, sitting `offset` px ABOVE it so
 * the hand never covers the loupe. If that would clip the top edge, it flips to
 * below the finger. Both axes are clamped inside the viewport with a margin.
 */
export function clampLoupePosition({
  clientX,
  clientY,
  viewportW,
  viewportH,
  size,
  offset,
  margin,
}: LoupePositionInput): LoupePosition {
  let left = clientX - size / 2;
  let top = clientY - offset - size;
  let flipped = false;
  if (top < margin) {
    top = clientY + offset; // not enough room above → drop below the finger
    flipped = true;
  }
  const maxLeft = Math.max(margin, viewportW - size - margin);
  const maxTop = Math.max(margin, viewportH - size - margin);
  left = Math.min(Math.max(left, margin), maxLeft);
  top = Math.min(Math.max(top, margin), maxTop);
  return { left, top, flipped };
}

/**
 * Pick the slot a near-miss touch should snap to, or null to leave the touch
 * alone. Returns the index of the closest port whose distance to the finger is
 * inside `snapRadius` but outside `deadZone`:
 *   - dist ≤ deadZone  → null: LiteGraph's own hit-test already grabs it; don't interfere.
 *   - dist > snapRadius → null: a genuine miss (empty canvas / deliberate node-drag).
 *   - in between        → snap to the nearest port.
 * Pure: callers project slot centres to client px and pass them in `ports`.
 */
export function pickSnapPort({
  fingerX,
  fingerY,
  ports,
  snapRadius,
  deadZone,
}: SnapPickInput): number | null {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < ports.length; i++) {
    const port = ports[i];
    if (!port) continue;
    const dist = Math.hypot(port.clientX - fingerX, port.clientY - fingerY);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  if (best < 0) return null;
  if (bestDist <= deadZone || bestDist > snapRadius) return null;
  return best;
}

/** True when the LGraphCanvas is mid connection-drag (covers fork + legacy). */
export function isConnecting(lgcanvas: LGraphCanvasLike | null | undefined): boolean {
  if (!lgcanvas) return false;
  return !!(
    (Array.isArray(lgcanvas.connecting_links) && lgcanvas.connecting_links.length) ||
    lgcanvas.connecting_node ||
    lgcanvas.connecting_output ||
    lgcanvas.connecting_input
  );
}

// --------------------------------------------------------------------------- //
// Loupe controller (DOM/canvas — only constructed in the browser via setup())
// --------------------------------------------------------------------------- //

interface LoupeState {
  active: boolean;
  pointerDown: boolean;
  clientX: number;
  clientY: number;
  raf: number;
}

function createLoupe(): void {
  // `app.canvas` is the LGraphCanvas; model it structurally for the fields used.
  const lg = app.canvas as unknown as LGraphCanvasLike | undefined;
  const maybeCanvas = lg?.canvas ?? (app as unknown as AppCanvasFallback).canvasEl;
  if (!lg || !maybeCanvas) {
    console.warn(`[${EXT_NAME}] no LGraphCanvas found; loupe disabled`);
    return;
  }
  // Bind the narrowed values to consts so the nested closures (render/frame/
  // snap) keep the non-undefined type — TS does not carry guard-narrowing of a
  // captured outer binding into inner functions.
  const sourceCanvas: HTMLCanvasElement = maybeCanvas;
  const lgCanvas: LGraphCanvasLike = lg;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const loupe = document.createElement("canvas");
  loupe.width = Math.round(CONFIG.size * dpr);
  loupe.height = Math.round(CONFIG.size * dpr);
  Object.assign(loupe.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${CONFIG.size}px`,
    height: `${CONFIG.size}px`,
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.85)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    pointerEvents: "none",
    zIndex: "10000",
    display: "none",
    overflow: "hidden",
    background: "#1a1a1a",
  });
  document.body.appendChild(loupe);
  const maybeCtx = loupe.getContext("2d");
  if (!maybeCtx) {
    console.warn(`[${EXT_NAME}] no 2d context; loupe disabled`);
    return;
  }
  // Same closure-narrowing reason as `sourceCanvas` above.
  const lctx: CanvasRenderingContext2D = maybeCtx;

  const state: LoupeState = {
    active: false,
    pointerDown: false,
    clientX: 0,
    clientY: 0,
    raf: 0,
  };

  function render(): void {
    const rect = sourceCanvas.getBoundingClientRect();
    const { sx, sy, sw, sh } = computeSourceRect({
      clientX: state.clientX,
      clientY: state.clientY,
      rect,
      canvasW: sourceCanvas.width,
      canvasH: sourceCanvas.height,
      size: CONFIG.size,
      zoom: CONFIG.zoom,
    });

    lctx.fillStyle = "#1a1a1a";
    lctx.fillRect(0, 0, loupe.width, loupe.height);
    if (sw > 0 && sh > 0) {
      try {
        lctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, loupe.width, loupe.height);
      } catch {
        // Source rect can momentarily fall outside the canvas; skip this frame.
      }
    }

    // Crosshair marking the exact pointer point (loupe centre).
    const cx = loupe.width / 2;
    const cy = loupe.height / 2;
    const r = 9 * dpr;
    lctx.strokeStyle = "rgba(255,80,80,0.9)";
    lctx.lineWidth = 1.5 * dpr;
    lctx.beginPath();
    lctx.arc(cx, cy, r, 0, Math.PI * 2);
    lctx.moveTo(cx - r - 5 * dpr, cy);
    lctx.lineTo(cx - 3 * dpr, cy);
    lctx.moveTo(cx + 3 * dpr, cy);
    lctx.lineTo(cx + r + 5 * dpr, cy);
    lctx.moveTo(cx, cy - r - 5 * dpr);
    lctx.lineTo(cx, cy - 3 * dpr);
    lctx.moveTo(cx, cy + 3 * dpr);
    lctx.lineTo(cx, cy + r + 5 * dpr);
    lctx.stroke();
  }

  function position(): void {
    const { left, top } = clampLoupePosition({
      clientX: state.clientX,
      clientY: state.clientY,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      size: CONFIG.size,
      offset: CONFIG.offset,
      margin: CONFIG.margin,
    });
    loupe.style.left = `${left}px`;
    loupe.style.top = `${top}px`;
  }

  function frame(): void {
    if (!state.active) return;
    if (!isConnecting(lg)) {
      deactivate();
      return;
    }
    position();
    render();
    state.raf = requestAnimationFrame(frame);
  }

  function activate(): void {
    if (state.active) return;
    state.active = true;
    loupe.style.display = "block";
    state.raf = requestAnimationFrame(frame);
  }

  function deactivate(): void {
    if (!state.active && loupe.style.display === "none") return;
    state.active = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    loupe.style.display = "none";
  }

  function watchForDrag(deadline: number): void {
    if (state.active || !state.pointerDown) return;
    if (isConnecting(lg)) {
      activate();
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(() => watchForDrag(deadline));
  }

  function onPointerDown(e: PointerEvent): void {
    state.clientX = e.clientX;
    state.clientY = e.clientY;
    if (!ACTIVATE_POINTER_TYPES.has(e.pointerType)) return;
    // Stand down while any pack's modal is open (isModalActive() reflects modals
    // opened by any inlined kit copy via the shared Symbol.for global) — don't
    // start watching for a connection drag behind an open modal.
    if (isModalActive()) return;
    state.pointerDown = true;
    watchForDrag(performance.now() + CONFIG.watchMs);
  }

  function onPointerMove(e: PointerEvent): void {
    state.clientX = e.clientX;
    state.clientY = e.clientY;
  }

  function onPointerEnd(): void {
    state.pointerDown = false;
    deactivate();
  }

  // ------------------------------------------------------------------------- //
  // Port snapping (issue #23): link START on touch.
  //
  // A purely-visual loupe cannot fix the *start* of a link: LiteGraph commits
  // the source slot synchronously on pointerdown (hit-testing e.canvasX/Y),
  // before any drag/loupe feedback exists — so a near-miss is locked in. The
  // smallest effective intervention is to correct the pointerdown coordinates:
  // LiteGraph listens in the CAPTURE phase on the canvas element, and this
  // listener is on `window` (also capture), so it runs first. When a touch
  // lands near — but not on — a slot, we swallow it and re-dispatch an identical
  // pointerdown at the slot centre, with the SAME pointerId so LiteGraph's
  // `setPointerCapture(pointerId)` still routes the live finger's move/up to the
  // canvas. Only pointerdown is corrected; move/up pass through untouched, so
  // the link follows the real fingertip. This is the one place the pack departs
  // from "never alter pointer events" — gated behind CONFIG.snap.
  // ------------------------------------------------------------------------- //

  /** Project every (non-collapsed) node's input + output slot centres to client px. */
  function collectPorts(rect: DOMRect): PortPoint[] {
    const ds = lgCanvas.ds;
    const nodes = lgCanvas.graph?._nodes;
    if (!ds || !Array.isArray(nodes)) return [];
    const out: PortPoint[] = [];
    for (const node of nodes) {
      if (node.flags?.collapsed) continue; // slots are hidden behind the collapse dot
      const toClient = (gp: [number, number]): PortPoint => ({
        clientX: (gp[0] + ds.offset[0]) * ds.scale + rect.left,
        clientY: (gp[1] + ds.offset[1]) * ds.scale + rect.top,
      });
      const inputs = node.inputs ?? [];
      for (let i = 0; i < inputs.length; i++) {
        try {
          const p = node.getInputPos?.(i);
          if (p) out.push(toClient(p));
        } catch {
          // Defensive: a fork may throw on an odd slot; just skip it.
        }
      }
      const outputs = node.outputs ?? [];
      for (let i = 0; i < outputs.length; i++) {
        try {
          const p = node.getOutputPos?.(i);
          if (p) out.push(toClient(p));
        } catch {
          // As above.
        }
      }
    }
    return out;
  }

  // Re-entrancy guard: our synthetic pointerdown re-enters this same window
  // capture listener; skip it so we don't recurse or double-snap.
  let dispatchingSynthetic = false;

  function onPointerDownSnap(e: PointerEvent): void {
    if (dispatchingSynthetic) return;
    if (!CONFIG.snap) return;
    if (!ACTIVATE_POINTER_TYPES.has(e.pointerType)) return;
    if (e.target !== sourceCanvas) return; // only correct touches on the graph canvas itself
    // Kit pointer-claim protocol (defense-in-depth): stand down while any pack's
    // modal is open. The kit's own backdrop already swallows taps landing over an
    // open modal, and the target-canvas guard above excludes non-canvas targets,
    // so this is an explicit, robust veto rather than a fix for a live bug.
    if (isModalActive()) return;

    const rect = sourceCanvas.getBoundingClientRect();
    const ports = collectPorts(rect);
    const idx = pickSnapPort({
      fingerX: e.clientX,
      fingerY: e.clientY,
      ports,
      snapRadius: CONFIG.snapRadius,
      deadZone: CONFIG.snapDeadZone,
    });
    if (idx == null) return; // genuine miss or already on-target → leave the touch alone

    const target = ports[idx];
    if (!target) return;
    // The gesture is committing a real snap — announce the claim so peer packs
    // can observe who owns this pointer (kit pointer-claim protocol; advisory).
    claimPointer("touch-connect");
    // Swallow the real touch (stops the canvas's capture listener too)…
    e.stopImmediatePropagation();
    e.preventDefault();
    // …and replay it at the slot centre so LiteGraph grabs the intended port.
    dispatchingSynthetic = true;
    try {
      sourceCanvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          isPrimary: e.isPrimary,
          clientX: target.clientX,
          clientY: target.clientY,
          button: 0,
          buttons: 1,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    } finally {
      dispatchingSynthetic = false;
    }
  }

  // Snap runs first (non-passive so it can preventDefault); the observation
  // listeners below stay passive. When snap fires it calls
  // stopImmediatePropagation on the real touch, then the synthetic re-dispatch
  // feeds the observation listeners so the loupe still activates.
  if (CONFIG.snap) {
    window.addEventListener("pointerdown", onPointerDownSnap, { capture: true, passive: false });
  }

  // Capture phase + passive: observe without ever interfering with LiteGraph's
  // own handling of the same events.
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener("pointerdown", onPointerDown, opts);
  window.addEventListener("pointermove", onPointerMove, opts);
  window.addEventListener("pointerup", onPointerEnd, opts);
  window.addEventListener("pointercancel", onPointerEnd, opts);
}

app.registerExtension({
  name: "comfy.touch-connect",
  // setup() runs after the canvas exists, so app.canvas is available.
  async setup() {
    try {
      createLoupe();
    } catch (e) {
      console.warn(`[${EXT_NAME}] failed to install loupe`, e);
    }
  },
});
