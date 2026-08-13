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

## Gateway

Copy `apps/gateway/config.example.json` to a local `config.json`, then keep that local file out of Git. Set `claude.adapter` to `agent-sdk` for real Claude Code or `fake` for deterministic development. `executablePath` and `model` are optional; the environment variables `CLAUDE_CODE_EXECUTABLE` and `CLAUDE_MODEL` override them.

The real adapter requires an Agent SDK credential supplied through the local process environment, such as `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, or a supported cloud provider. A normal interactive Claude Code `/login` is intentionally not treated as SDK authentication. Never put credentials in `config.json` or Git.

The adapter runs with filesystem settings sources disabled so project/user allow rules and hooks cannot bypass phone approval. This also means `CLAUDE.md`, local skills, and local hooks are not loaded in this initial remote-control mode. It never enables bypass-permissions mode.

```powershell
pnpm --filter @claude-chat/gateway build
$env:GATEWAY_CONFIG = 'D:\path\to\config.json'
pnpm --filter @claude-chat/gateway start
```

`GET /v1/health` reports whether Claude Code is ready, signed out, or unavailable. Unit tests keep the fake adapter; real account and network smoke checks are explicit scripts rather than part of the normal test suite.
