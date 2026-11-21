# Design: single-session workbench (post-v0.1.0 roadmap, phase 1)

Status: **draft for approval**. Interpretation note: "B)" was taken to mean approach B ("single-session workbench first") from the roadmap discussion. Local and client only; no backend services.

## Intent
MCA v0.1.0 can run an agent but gives little help *supervising* it. Comparable tools (Claude Code desktop, Antigravity, Paseo, T3 Code) all let you see what changed, comment on it, and watch cost. Phase 1 makes one chat much easier to review and trust, and lays the foundations (a change set per turn, persistent checkpoints, a session id on events) that parallel agents need in phase 2.

## Goals
1. **Diff panel**: per turn and cumulative, per-file unified diffs of what the agent changed (Write/Edit; Bash changes via a git-based snapshot when the workspace is a git repo). Per-line comments that are sent back to the agent as the next prompt. Per-file "revert this file".
2. **Persistent checkpoints**: rewind survives restart and resume; bounded storage (size cap, oldest dropped, user told).
3. **Usage meter**: tokens in/out and estimated cost per turn and per chat (price table per model; "unknown" when no price), plus the existing context-window bar.
4. **Files and preview**: workspace file tree and a read-only viewer; clicking a path in a tool card opens it. Image attachments rendered in the transcript (already accepted on input).
5. **Integrated terminal**: a user-driven shell pane in the workspace (separate from the agent's Bash).
6. Every item keeps CLI parity where it makes sense (`/diff`, `/cost`).

## Non-goals
Parallel sessions and worktrees (phase 2), remote/phone access, any backend, code editing in the app, signing/auto-update (tracked separately), subscription-login providers (see Open decision).

## Anti-goals
Anything that lets the renderer read arbitrary files or run commands without main-process validation; a diff view that can disagree with what is on disk; unbounded disk use.

## Constraints
- Core stays Electron-free; new IPC channels follow the `IpcContract` + `INVOKE` + validator + handler pattern.
- Renderer file access is workspace-scoped and realpath-checked, reusing `core/paths.ts`.
- The terminal uses `node-pty` (native module): must be rebuilt for Electron and unpacked from asar; it is the riskiest dependency and ships last.
- Fail closed: path or size validation errors refuse.

## Approaches considered
- **A. Parallel sessions first**: highest impact but forces the multi-session refactor before there is anything to review with. Deferred to phase 2.
- **B. Workbench first (chosen)**: smaller increments, each independently useful, and it produces the change-set and checkpoint plumbing phase 2 needs.
- **C. Hardening first**: handled as a gate, not a phase: live-API smoke test and the v0.1.0 release happen before phase 1 merges.

Diff source, within B: (1) snapshot files in FileState checkpoints (covers only Write/Edit); (2) `git diff` against a per-turn shadow commit (covers Bash, needs git); (3) both: checkpoint data is the source of truth, git snapshot is added when available. **Chosen: 3**, because it never misses tool edits and also catches Bash changes when possible.

## Design sketch
- `core/checkpoints.ts` persists per-turn before-images under `~/.mca/projects/<ws>/checkpoints/<session>/<turn>/` with a size cap (default 200 MB per workspace); `FileState` reads/writes through it. Resume rebuilds the stack from disk.
- `core/changes.ts` computes `Change[]` (path, status, hunks) for a turn range from before-images vs current files; emits a `changes` AgentEvent after each turn.
- Reducer gains `changes` and `usage` totals; renderer adds `DiffPanel`, `FileTree`, `FileViewer`, `UsagePill`, `TerminalPane`.
- New channels: `changes:get`, `changes:revert`, `files:list`, `files:read`, `terminal:*`. Comments are plain text prompts built from selected lines: no new agent protocol.

```
┌ chats ┬ transcript ────────────────┬ Review ───────────────┐
│       │ ⏺ Edit(src/a.ts)           │ 2 files changed       │
│       │ ⏺ Bash(npm test)           │ src/a.ts  +12 −3  [↶] │
│       │                            │  - old line           │
│       │ > prompt          $0.04    │  + new line  [💬]     │
└───────┴────────────────────────────┴───────────────────────┘
```

## Milestones (each ends with CI green and a demo)
P1.1 Persistent checkpoints + `/diff` in CLI. P1.2 Diff panel with revert. P1.3 Line comments. P1.4 Usage/cost meter. P1.5 File tree + viewer. P1.6 Terminal pane.

## Left to the builder
Diff library choice (`diff` vs own), price table source and update cadence, exact size cap, panel layout details.

## Open decision (yours)
Subscription support. Direct Claude/Antigravity OAuth reuse is prohibited by the providers' terms (secondary sources, Feb 2026). Options: (a) add a CLI-backed Claude provider (drives the user's own `claude`) and a Gemini API-key provider as a separate phase between 1 and 2, (b) defer until terms clarify, (c) API keys only. Recommendation: **(a), off by default with a terms warning**, scheduled after P1.4.
