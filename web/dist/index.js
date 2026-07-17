/* web/dist bundle built by bun from src/ in this repository (see package.json). Inlines @laurigates/comfy-modal-kit (MIT) - a first-party library by the same publisher, published to npm with provenance attestation: https://www.npmjs.com/package/@laurigates/comfy-modal-kit */

// node_modules/@laurigates/comfy-modal-kit/dist/index.js
var KEY = Symbol.for("laurigates.comfyModalKit");
function getKit() {
  const g = globalThis;
  let kit = g[KEY];
  if (!kit) {
    kit = { fieldProviders: [], activeModal: null, pointerClaim: null };
    g[KEY] = kit;
  }
  return kit;
}
function isModalActive() {
  return getKit().activeModal !== null;
}
function claimPointer(id) {
  getKit().pointerClaim = id;
}

// src/index.ts
import { app } from "/scripts/app.js";
var EXT_NAME = "comfyui-touch-connect";
var ACTIVATE_POINTER_TYPES = new Set(["touch"]);
var CONFIG = {
  zoom: 2.5,
  size: 168,
  offset: 96,
  margin: 8,
  watchMs: 350,
  snap: true,
  snapRadius: 30,
  snapDeadZone: 14
};
function computeSourceRect({
  clientX,
  clientY,
  rect,
  canvasW,
  canvasH,
  size,
  zoom
}) {
  const scaleX = rect.width ? canvasW / rect.width : 1;
  const scaleY = rect.height ? canvasH / rect.height : 1;
  const pxX = (clientX - rect.left) * scaleX;
  const pxY = (clientY - rect.top) * scaleY;
  const sw = size / zoom * scaleX;
  const sh = size / zoom * scaleY;
  return { sx: pxX - sw / 2, sy: pxY - sh / 2, sw, sh };
}
function clampLoupePosition({
  clientX,
  clientY,
  viewportW,
  viewportH,
  size,
  offset,
  margin
}) {
  let left = clientX - size / 2;
  let top = clientY - offset - size;
  let flipped = false;
  if (top < margin) {
    top = clientY + offset;
    flipped = true;
  }
  const maxLeft = Math.max(margin, viewportW - size - margin);
  const maxTop = Math.max(margin, viewportH - size - margin);
  left = Math.min(Math.max(left, margin), maxLeft);
  top = Math.min(Math.max(top, margin), maxTop);
  return { left, top, flipped };
}
function pickSnapPort({
  fingerX,
  fingerY,
  ports,
  snapRadius,
  deadZone
}) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0;i < ports.length; i++) {
    const port = ports[i];
    if (!port)
      continue;
    const dist = Math.hypot(port.clientX - fingerX, port.clientY - fingerY);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  if (best < 0)
    return null;
  if (bestDist <= deadZone || bestDist > snapRadius)
    return null;
  return best;
}
function isConnecting(lgcanvas) {
  if (!lgcanvas)
    return false;
  return !!(Array.isArray(lgcanvas.connecting_links) && lgcanvas.connecting_links.length || lgcanvas.connecting_node || lgcanvas.connecting_output || lgcanvas.connecting_input);
}
function createLoupe() {
  const lg = app.canvas;
  const maybeCanvas = lg?.canvas ?? app.canvasEl;
  if (!lg || !maybeCanvas) {
    console.warn(`[${EXT_NAME}] no LGraphCanvas found; loupe disabled`);
    return;
  }
  const sourceCanvas = maybeCanvas;
  const lgCanvas = lg;
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
    background: "#1a1a1a"
  });
  document.body.appendChild(loupe);
  const maybeCtx = loupe.getContext("2d");
  if (!maybeCtx) {
    console.warn(`[${EXT_NAME}] no 2d context; loupe disabled`);
    return;
  }
  const lctx = maybeCtx;
  const state = {
    active: false,
    pointerDown: false,
    clientX: 0,
    clientY: 0,
    raf: 0
  };
  function render() {
    const rect = sourceCanvas.getBoundingClientRect();
    const { sx, sy, sw, sh } = computeSourceRect({
      clientX: state.clientX,
      clientY: state.clientY,
      rect,
      canvasW: sourceCanvas.width,
      canvasH: sourceCanvas.height,
      size: CONFIG.size,
      zoom: CONFIG.zoom
    });
    lctx.fillStyle = "#1a1a1a";
    lctx.fillRect(0, 0, loupe.width, loupe.height);
    if (sw > 0 && sh > 0) {
      try {
        lctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, loupe.width, loupe.height);
      } catch {}
    }
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
  function position() {
    const { left, top } = clampLoupePosition({
      clientX: state.clientX,
      clientY: state.clientY,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      size: CONFIG.size,
      offset: CONFIG.offset,
      margin: CONFIG.margin
    });
    loupe.style.left = `${left}px`;
    loupe.style.top = `${top}px`;
  }
  function frame() {
    if (!state.active)
      return;
    if (!isConnecting(lg)) {
      deactivate();
      return;
    }
    position();
    render();
    state.raf = requestAnimationFrame(frame);
  }
  function activate() {
    if (state.active)
      return;
    state.active = true;
    loupe.style.display = "block";
    state.raf = requestAnimationFrame(frame);
  }
  function deactivate() {
    if (!state.active && loupe.style.display === "none")
      return;
    state.active = false;
    if (state.raf)
      cancelAnimationFrame(state.raf);
    state.raf = 0;
    loupe.style.display = "none";
  }
  function watchForDrag(deadline) {
    if (state.active || !state.pointerDown)
      return;
    if (isConnecting(lg)) {
      activate();
      return;
    }
    if (performance.now() < deadline)
      requestAnimationFrame(() => watchForDrag(deadline));
  }
  function onPointerDown(e) {
    state.clientX = e.clientX;
    state.clientY = e.clientY;
    if (!ACTIVATE_POINTER_TYPES.has(e.pointerType))
      return;
    if (isModalActive())
      return;
    state.pointerDown = true;
    watchForDrag(performance.now() + CONFIG.watchMs);
  }
  function onPointerMove(e) {
    state.clientX = e.clientX;
    state.clientY = e.clientY;
  }
  function onPointerEnd() {
    state.pointerDown = false;
    deactivate();
  }
  function collectPorts(rect) {
    const ds = lgCanvas.ds;
    const nodes = lgCanvas.graph?._nodes;
    if (!ds || !Array.isArray(nodes))
      return [];
    const out = [];
    for (const node of nodes) {
      if (node.flags?.collapsed)
        continue;
      const toClient = (gp) => ({
        clientX: (gp[0] + ds.offset[0]) * ds.scale + rect.left,
        clientY: (gp[1] + ds.offset[1]) * ds.scale + rect.top
      });
      const inputs = node.inputs ?? [];
      for (let i = 0;i < inputs.length; i++) {
        try {
          const p = node.getInputPos?.(i);
          if (p)
            out.push(toClient(p));
        } catch {}
      }
      const outputs = node.outputs ?? [];
      for (let i = 0;i < outputs.length; i++) {
        try {
          const p = node.getOutputPos?.(i);
          if (p)
            out.push(toClient(p));
        } catch {}
      }
    }
    return out;
  }
  let dispatchingSynthetic = false;
  function onPointerDownSnap(e) {
    if (dispatchingSynthetic)
      return;
    if (!CONFIG.snap)
      return;
    if (!ACTIVATE_POINTER_TYPES.has(e.pointerType))
      return;
    if (e.target !== sourceCanvas)
      return;
    if (isModalActive())
      return;
    const rect = sourceCanvas.getBoundingClientRect();
    const ports = collectPorts(rect);
    const idx = pickSnapPort({
      fingerX: e.clientX,
      fingerY: e.clientY,
      ports,
      snapRadius: CONFIG.snapRadius,
      deadZone: CONFIG.snapDeadZone
    });
    if (idx == null)
      return;
    const target = ports[idx];
    if (!target)
      return;
    claimPointer("touch-connect");
    e.stopImmediatePropagation();
    e.preventDefault();
    dispatchingSynthetic = true;
    try {
      sourceCanvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        clientX: target.clientX,
        clientY: target.clientY,
        button: 0,
        buttons: 1,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    } finally {
      dispatchingSynthetic = false;
    }
  }
  if (CONFIG.snap) {
    window.addEventListener("pointerdown", onPointerDownSnap, { capture: true, passive: false });
  }
  const opts = { capture: true, passive: true };
  window.addEventListener("pointerdown", onPointerDown, opts);
  window.addEventListener("pointermove", onPointerMove, opts);
  window.addEventListener("pointerup", onPointerEnd, opts);
  window.addEventListener("pointercancel", onPointerEnd, opts);
}
app.registerExtension({
  name: "comfy.touch-connect",
  async setup() {
    try {
      createLoupe();
    } catch (e) {
      console.warn(`[${EXT_NAME}] failed to install loupe`, e);
    }
  }
});
export {
  pickSnapPort,
  isConnecting,
  computeSourceRect,
  clampLoupePosition
};
