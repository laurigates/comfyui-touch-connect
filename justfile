# comfyui-touch-connect — task runner. Run `just` (or `just --list`) for recipes.

set positional-arguments

# Show available recipes.
default:
    @just --list

##########
# Quality
##########

# Lint Python + TS/JSON (no changes).
[group: "quality"]
lint:
    uv run ruff check .
    bunx biome check .

# Auto-format Python + TS/JSON.
[group: "quality"]
format:
    uv run ruff format .
    uv run ruff check --fix .
    bunx biome check --write .

# Typecheck the TypeScript source (tsc --noEmit).
[group: "quality"]
typecheck:
    bun run typecheck

# Compile src/index.ts → web/dist/index.js via bun build.
[group: "quality"]
build:
    bun run build

# Dead-code / unused-dependency check.
[group: "quality"]
knip:
    bun run knip

# Run the full test suite (pytest + Vitest) — the local CI gate.
[group: "quality"]
test:
    uv run pytest -v
    bun run test

# Lint + typecheck + build + knip + test in one shot.
[group: "quality"]
check: lint typecheck build knip test

##########
# Documentation artifacts
##########

# Regenerate docs/loupe.png (the magnifier loupe overlay) via the screenshot generator.
[group: "docs"]
screenshots:
    docker build -f screenshots/Dockerfile -t comfyui-touch-connect-screenshots .
    docker run --rm -v "$(pwd)/docs:/out" comfyui-touch-connect-screenshots
