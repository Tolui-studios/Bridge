# Bridge

Mission control for a solo Roblox game studio. Bridge sits above a portfolio of game repos and gives one place to switch between games, see each game's current goal and live progress bar (parsed from that repo's `GOALS.md`), and — in later phases — spawn and watch Claude Code agents working inside each game.

Full product brief: [`docs/BRIEF.md`](docs/BRIEF.md). Agent-facing rules: [`CLAUDE.md`](CLAUDE.md). Current roadmap state: [`GOALS.md`](GOALS.md).

## Stack

Electron + electron-vite + React 19 + TypeScript + Tailwind CSS v4, packaged with electron-builder. See `CLAUDE.md` for the version-pin constraints before upgrading anything.

## Development

```
npm install
npm run dev          # launch the app with HMR
npm run test         # vitest (GOALS.md parser)
npm run typecheck    # both node + web tsconfig projects
npm run build        # typecheck + production build to out/
npm run build:win    # NSIS installer to dist/
```

Requires Node >= 22.12 (Node 24 LTS recommended).

The packaged app currently ships with Electron's default icon — `build/icon.ico` is later polish.

## Try it

Register `fixtures/sample-game` via **Add Game** (it has no `.git` — Bridge warns but allows it), or register this repo itself: Bridge's own `GOALS.md` is a live dogfood of the check-bar.
