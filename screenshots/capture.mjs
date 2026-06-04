// Playwright driver for the README screenshot.
//
// touch-connect is a CANVAS-GESTURE pack — there is no modal to capture, and
// the magnifier loupe only appears DURING a touch connection-drag. So this
// driver synthesizes that exact state:
//
//   1. load a small connected graph (so the canvas shows slots + a link),
//   2. force the LiteGraph connecting-drag state (canvas.connecting_links),
//   3. dispatch a synthetic *touch* pointer over an input slot — the same
//      window pointer events the pack listens to — which activates the loupe,
//   4. screenshot the loupe overlay element once it is rendering.
//
// The loupe magnifies the real canvas region under the finger via
// drawImage(sourceCanvas, …), so the shot is the genuine pack overlay, not a
// mock-up. A live finger-drag can't be produced headlessly any other way; this
// drives the exact public surface (pointer events + connecting_links) a real
// touch drag would.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = resolve(HERE, "workflow.json");
const OUT_DIR = process.env.OUT_DIR || "/out";
const BASE_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188/";

// Where (viewport CSS px) the synthetic fingertip lands — over node 2's
// `samples` input slot.
const FINGER_X = 560;
const FINGER_Y = 380;
const SCALE = 1.4;

async function dismissStartupDialog(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".p-dialog-mask")) el.remove();
  });
}

async function main() {
  const workflow = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));

  const browser = await chromium.launch({
    args: ["--font-render-hinting=none"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    // Hint the engine that this is a touch device so PointerEvents look native.
    hasTouch: true,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || t === "warning") {
      console.log(`[page:${t}] ${msg.text()}`);
    }
  });

  console.log(`Navigating to ${BASE_URL}…`);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  await page.waitForFunction(
    () => window.app && window.app.graph && Array.isArray(window.app.graph._nodes),
    null,
    { timeout: 30_000 },
  );

  console.log("Loading connected two-node workflow…");
  await page.evaluate((wf) => {
    window.app.loadGraphData(wf, true);
  }, workflow);

  await page.waitForFunction(() => window.app.graph._nodes.length === 2, null, {
    timeout: 10_000,
  });

  await dismissStartupDialog(page);

  // Position the view so node 2's input slot lands under the synthetic finger,
  // and force the connecting-drag state so the pack's isConnecting() is true.
  console.log("Positioning view + forcing connecting-drag state…");
  await page.evaluate(
    ({ fingerX, fingerY, scale }) => {
      const graph = window.app.graph;
      const canvas = window.app.canvas;
      const ds = canvas.ds;
      ds.scale = scale;

      const node1 = graph._nodes.find((n) => n.type === "EmptyLatentImage");
      const node2 = graph._nodes.find((n) => n.type === "VAEDecode");

      // Aim the finger at node 2's first input slot (left edge, ~18px below
      // the body top). Solve the offset so that graph point maps to (fingerX,
      // fingerY): screen = (graph + offset) * scale.
      const gx = node2.pos[0];
      const gy = node2.pos[1] + 18;
      ds.offset[0] = fingerX / scale - gx;
      ds.offset[1] = fingerY / scale - gy;

      // Force the LiteGraph connection-drag state. isConnecting() accepts the
      // modern connecting_links array OR the legacy single-link fields; set
      // both so the loupe activates across frontend variants.
      const out = node1.outputs[0];
      const originScreen = [
        (node1.pos[0] + node1.size[0] + ds.offset[0]) * scale,
        (node1.pos[1] + 18 + ds.offset[1]) * scale,
      ];
      canvas.connecting_links = [
        { node: node1, slot: 0, output: out, pos: originScreen, type: out.type },
      ];
      canvas.connecting_node = node1;
      canvas.connecting_output = out;
      // Best-effort: point the canvas "mouse" at the finger so any drag-line
      // render aims there. Harmless if the fork ignores these.
      canvas.graph_mouse = [gx, gy];
      canvas.canvas_mouse = [fingerX, fingerY];

      canvas.setDirty(true, true);
      canvas.draw(true, true);
    },
    { fingerX: FINGER_X, fingerY: FINGER_Y, scale: SCALE },
  );

  // Dispatch the synthetic touch pointer the pack listens for (window, capture
  // phase). pointerdown with pointerType:"touch" + isConnecting() true makes
  // the loupe activate immediately.
  console.log("Dispatching synthetic touch pointer over the slot…");
  await page.evaluate(
    ({ x, y }) => {
      const fire = (type) =>
        window.dispatchEvent(
          new PointerEvent(type, {
            pointerType: "touch",
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire("pointerdown");
      fire("pointermove");
    },
    { x: FINGER_X, y: FINGER_Y },
  );

  // Wait for the loupe (a position:fixed circular canvas the pack appends to
  // body) to become visible, then tag it so we can screenshot just the loupe.
  console.log("Waiting for the loupe to activate…");
  await page.waitForFunction(
    () => {
      const c = [...document.querySelectorAll("canvas")].find(
        (el) => el.style?.position === "fixed" && el.style?.borderRadius === "50%",
      );
      if (!c || c.style.display === "none") return false;
      c.id = "tc-loupe-shot";
      return true;
    },
    null,
    { timeout: 8_000 },
  );

  // A few frames so the magnified content + crosshair are painted.
  await page.waitForTimeout(500);

  console.log(`Capturing ${OUT_DIR}/loupe.png…`);
  await page.locator("#tc-loupe-shot").screenshot({ path: `${OUT_DIR}/loupe.png` });

  await browser.close();
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
