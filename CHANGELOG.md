# Changelog

## 0.2.2 (2026-11-26)

### TL;DR

- Pin chats from any workspace to a Pinned list at the top of the sidebar. Pins last for the session; pin again to keep them after restarts. Unpin with one click.
- Newest folders skip folders whose names start with `_`.
- Dependency security updates (`npm audit fix`), including Electron 45.

### Changelog

#### Changed

- Newest folders now skip names starting with `_` (such as archives), like hidden `.` folders. Settings says so.
- Updated Electron 36 → 45, electron-builder to 26.18 and Vitest 3 → 5 with `npm audit fix`.

#### Fixed

- The Bash timeout test no longer flakes on Windows CI (test only).

## 0.2.1 (2026-11-25)

### TL;DR

- Phone CiP opens at 404 × 710 by default.
- In phone CiP, mode, model, effort and Rewind fold behind one settings button under the message field.
- First published release with the 0.2.0 features (the 0.2.0 build could not upload).

## 0.2.0 (2026-11-25)

### TL;DR

- **CiP (Chat in Picture):** a small, always-on-top chat window with no title bar, in phone or normal size (Ctrl/Cmd+Shift+P).
- **Right-click menu** with quick actions everywhere.
- **Newest folders** from folders you allow, one click to open.
- **Compact tool rows:** repeated tool calls fold into one line like "Bash ×3".

### Changelog

#### Added
- **CiP (Chat in Picture)**
  - Opens from the header button, View menu, right-click menu or Ctrl/Cmd+Shift+P. The main window hides while CiP is open and comes back when you leave it.
  - Two sizes, switched in Settings → General ("CiP in normal size") or with the size button in the CiP header:
    - **Phone:** tall and one column; double-click opens the sidebar on top of the chat.
    - **Normal:** the full window layout.
  - Each size remembers its own position and size, also after a restart.
  - Resize grips in both bottom corners.
  - See-through while you work in another app, at an opacity you set in Settings ("CiP opacity", 20–100 %). Fully visible again when focused.
  - Quick folder picker in the CiP header.
- **Right-click menu** wherever nothing else uses right-click:
  - Cut/Copy/Paste/Select All in text fields, Copy on selected text.
  - CiP, New Chat, Open Workspace, Focus Message Field, Stop the Agent.
  - Sidebar and tools panel toggles, Show Changes/Git/Terminal, Zoom, Settings.
- **Newest folders**
  - Add allowed folders in Settings → General → "Newest folders from".
  - Their direct subfolders (one level only, hidden ones skipped) are listed newest first when you hover **New workspace** and in the CiP folder picker. Opening one still asks the trust question.

#### Changed
- Tool calls in the chat are compact: one tool shows only its name, repeated calls fold into one row, and you expand to see commands and output.

#### Notes
- CiP see-through mode has no effect on Linux.
