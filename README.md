# ClaudeChatAPP

ClaudeChatAPP is a personal Android client for controlling Claude Code through a Gateway running on the user's Windows computer.

The repository is in active development. The approved architecture and staged implementation plan live in:

- `docs/superpowers/specs/2026-08-13-claude-chat-app-design.md`
- `docs/superpowers/plans/2026-08-13-claude-chat-app-implementation.md`

## Workspace

```text
apps/mobile       Expo React Native Android app
apps/gateway      Local Node.js Gateway
packages/protocol Shared runtime protocol and TypeScript types
packages/database SQLite persistence (added in the next implementation stage)
```

## Current Stage

This branch establishes the workspace, protocol validation, Gateway health endpoint, and Android app baseline. Pairing, session persistence, and real Claude Agent SDK control are implemented in later branches after this foundation is merged.
