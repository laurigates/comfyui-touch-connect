# comfyui-touch-connect

Magnifier loupe under your finger for accurate node-connection dragging on touch devices.

> Part of a family of mobile-first ComfyUI usability packs built on
> [comfy-modal-kit](https://github.com/laurigates/comfy-modal-kit)
> ([gallery-loader](https://github.com/laurigates/comfyui-gallery-loader),
> [model-gallery](https://github.com/laurigates/comfyui-model-gallery),
> [prompt-editor](https://github.com/laurigates/comfyui-prompt-editor),
> [sampler-info](https://github.com/laurigates/comfyui-sampler-info),
> [touch-numeric](https://github.com/laurigates/comfyui-touch-numeric),
> [touch-resize](https://github.com/laurigates/comfyui-touch-resize),
> [touch-tooltips](https://github.com/laurigates/comfyui-touch-tooltips)):
> touch-friendly HTML modals that replace clunky native LiteGraph controls,
> detected by widget name, additive and non-clobbering.

![Magnifier loupe over a connection slot](docs/loupe.png)

*The magnifier loupe follows your fingertip during a connection drag, so the
slot you're aiming at stays visible instead of hiding under your finger. The
crosshair marks the exact pointer point.*

## Install

```sh
cd <ComfyUI>/custom_nodes
git clone https://github.com/laurigates/comfyui-touch-connect
```

Restart ComfyUI; hard-refresh the browser tab (Ctrl+Shift+R / Cmd+Shift+R).

## What it does

TODO — describe the widgets it enhances and the modal it opens.

## Compatibility

- ComfyUI: modern Vue frontend (`comfyui-frontend-package >= 1.40`) for the
  `widget.onPointerDown` interception hook.
- Frontend changes (JS/CSS) take effect on browser hard-refresh — no restart.

## License

MIT — see `LICENSE`.
