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

## Scripts

- `npm run dev` — Start Electron + Vite in development mode
- `npm run build` — Build main, preload, and renderer bundles
- `npm run typecheck` — Run TypeScript typechecking for Node and Web targets
- `npm test` — Run unit and component tests with Vitest
- `npm run package:mac` — Build and package macOS `.dmg` and `.zip` artifacts via `electron-builder`
