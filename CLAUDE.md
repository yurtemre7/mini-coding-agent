# mini-coding-agent (MCA)

Electron + React + TypeScript desktop app and `mca` CLI sharing one agent runtime. Read `docs/HANDOVER.md` first (status, architecture, decisions, backlog); `docs/PLAN.md` is the design reference.

## Layout
- `src/core` pure Node runtime (no Electron/React imports); `src/shared` types and the one pure reducer; `src/cli`, `src/main`, `src/preload`, `src/renderer` are frontends.
- IPC: add a channel in `IpcContract` + `INVOKE` (`shared/types.ts`), a validator in `main/validate.ts`, a handler in `main/ipc.ts`.

## Commands
- `npm run lint && npm run typecheck && npm test && npm run build` must pass before every push.
- `npm run dev` runs the desktop app; `node out/cli/index.js` runs the CLI after a build.

## Rules
- English only in UI, CLI output, errors and docs. Prefer shadcn/ui components.
- Every new behaviour gets a test; tests never touch the network (use `FakeProvider`) and use a throwaway `HOME`.
- Security-sensitive code (permissions, trust, paths, Bash rules) is fail-closed: unknown means ask or deny.
- Work on a branch and open a PR to `main`; CI (Ubuntu + macOS + Windows check job) must be green; packaging is manual-dispatch only. Don't push tags or release without being asked.
- Keep `docs/HANDOVER.md` current (decisions, known gaps, backlog). Known container-only failure: `bash.test.ts` process-group timeout.
