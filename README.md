# mini-coding-agent (MCA)

Desktop coding agent built with [Electron](https://www.electronjs.org/), React, TypeScript, Tailwind CSS, and [shadcn/ui](https://ui.shadcn.com/).

## Requirements

- Node.js 22+
- npm 10+
- macOS (primary target)

## Getting Started

```bash
npm install
npm run dev
```

## API Keys

Keys are looked up in this order: environment variables (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`), the macOS Keychain (saved from the desktop Settings), `~/.mca/credentials.json`, then a `.env` file in the directory `mca` or the app is launched from. For local development:

```bash
cp .env.example .env
```

`.env` is git-ignored. It is read last, so a `.env` shipped in a cloned repo never overrides a key you configured yourself.

## Scripts

- `npm run dev` — Start Electron + Vite in development mode
- `npm run build` — Build main, preload, and renderer bundles
- `npm run typecheck` — Run TypeScript typechecking for Node and Web targets
- `npm test` — Run unit and component tests with Vitest
- `npm run package:mac` — Build and package macOS `.dmg` and `.zip` artifacts via `electron-builder`
