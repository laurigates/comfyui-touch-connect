"""Touch Connect for ComfyUI.

Frontend-only pack: no Python nodes. The whole extension lives in
web/js/touch-connect.js and is loaded via WEB_DIRECTORY below.
"""

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
