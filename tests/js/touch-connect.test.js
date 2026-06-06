import { describe, expect, it } from "vitest";
import { clampLoupePosition, computeSourceRect, isConnecting } from "../../src/index.ts";

// These exercise the pure geometry/state helpers — the part of the loupe that
// has no DOM dependency. The canvas/overlay wiring is covered by the manual
// browser smoke matrix in CLAUDE.md.

describe("computeSourceRect", () => {
  const rect = { left: 0, top: 0, width: 1000, height: 800 };

  it("centres a size/zoom window on the finger in CSS-pixel canvases (dpr=1)", () => {
    const r = computeSourceRect({
      clientX: 500,
      clientY: 400,
      rect,
      canvasW: 1000,
      canvasH: 800,
      size: 200,
      zoom: 2,
    });
    // 200/2 = 100 CSS px window, scale 1 → 100 backing px, centred on (500,400).
    expect(r.sw).toBe(100);
    expect(r.sh).toBe(100);
    expect(r.sx).toBe(450);
    expect(r.sy).toBe(350);
  });

  it("scales source coords into the backing store on a HiDPI canvas (dpr=2)", () => {
    const r = computeSourceRect({
      clientX: 500,
      clientY: 400,
      rect,
      canvasW: 2000, // 2x backing store
      canvasH: 1600,
      size: 200,
      zoom: 2,
    });
    // CSS point (500,400) → backing (1000,800); 100 CSS-px window → 200 backing px.
    expect(r.sw).toBe(200);
    expect(r.sh).toBe(200);
    expect(r.sx).toBe(900);
    expect(r.sy).toBe(700);
  });

  it("offsets for a canvas not at the viewport origin", () => {
    const r = computeSourceRect({
      clientX: 150,
      clientY: 120,
      rect: { left: 100, top: 100, width: 1000, height: 800 },
      canvasW: 1000,
      canvasH: 800,
      size: 100,
      zoom: 2,
    });
    // local (50,20), 50px window centred → sx=25, sy=-5
    expect(r.sx).toBe(25);
    expect(r.sy).toBe(-5);
  });
});

describe("clampLoupePosition", () => {
  const base = { viewportW: 1000, viewportH: 800, size: 100, offset: 40, margin: 8 };

  it("places the loupe above and horizontally centred on the finger", () => {
    const p = clampLoupePosition({ ...base, clientX: 500, clientY: 400 });
    expect(p.left).toBe(450); // 500 - 100/2
    expect(p.top).toBe(260); // 400 - 40 - 100
    expect(p.flipped).toBe(false);
  });

  it("flips below the finger when there is no room above", () => {
    const p = clampLoupePosition({ ...base, clientX: 500, clientY: 20 });
    expect(p.flipped).toBe(true);
    expect(p.top).toBe(60); // 20 + 40
  });

  it("clamps horizontally so the loupe never leaves the viewport", () => {
    const left = clampLoupePosition({ ...base, clientX: 5, clientY: 400 });
    expect(left.left).toBe(8); // margin
    const right = clampLoupePosition({ ...base, clientX: 995, clientY: 400 });
    expect(right.left).toBe(892); // 1000 - 100 - 8
  });
});

describe("isConnecting", () => {
  it("is false for nullish / idle canvases", () => {
    expect(isConnecting(null)).toBe(false);
    expect(isConnecting({})).toBe(false);
    expect(isConnecting({ connecting_links: [] })).toBe(false);
  });

  it("detects the modern connecting_links array and legacy fields", () => {
    expect(isConnecting({ connecting_links: [{ node: {} }] })).toBe(true);
    expect(isConnecting({ connecting_node: {} })).toBe(true);
    expect(isConnecting({ connecting_output: {} })).toBe(true);
    expect(isConnecting({ connecting_input: {} })).toBe(true);
  });
});
