"""Touch Connect for ComfyUI.

Frontend-only pack: no Python nodes. The extension is authored in
TypeScript (src/index.ts), compiled to ESM via `bun build` and emitted
to web/dist/. ComfyUI serves WEB_DIRECTORY as the extension root. See
ADR-0001 (TypeScript + bun build).
"""

WEB_DIRECTORY = "./web/dist"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
