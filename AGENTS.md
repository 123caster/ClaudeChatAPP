# Repository Guidelines

## Project Structure & Module Organization

This is a `pnpm` monorepo for an Android Claude remote-control client. Keep
product code inside its owning workspace:

- `apps/mobile/`: Expo Router and React Native app. Screens live in
  `src/screens/`, routes in `src/app/`, and UI/state/API code in their matching
  `src/` folders.
- `apps/gateway/`: Fastify gateway, Claude adapter, WebSocket events, and HTTP
  routes. Put unit tests in `src/__tests__/`.
- `packages/protocol/`: shared Zod schemas, events, HTTP types, and errors.
- `packages/database/`: SQLite migrations and repositories.
- `docs/superpowers/`: approved design and implementation specifications.
- `scripts/`: release/build automation. Do not commit generated `dist/`, Expo,
  Android, coverage, or temporary build output.

## Build, Test, and Development Commands

Run commands from the repository root with Node `>=24.16 <25` and pnpm 10:

```powershell
pnpm install
pnpm build                 # build every workspace that defines build
pnpm typecheck             # TypeScript checks across workspaces
pnpm lint                  # ESLint, zero warnings allowed
pnpm test                  # all unit tests
pnpm --filter @claude-chat/gateway dev
pnpm --dir apps/mobile start
pnpm --dir apps/mobile android:release
```

Use focused commands while iterating, for example
`pnpm --filter @claude-chat/gateway test` or `pnpm --dir apps/mobile test`.
Run `pnpm format:check` before review; use `pnpm format` only when its broader
formatting diff is intended.

## Coding Style & Naming Conventions

Write TypeScript with two-space indentation, semicolons, single quotes,
trailing commas, and a 100-character print width; Prettier enforces these
rules. Use `PascalCase` for React components and exported types, `camelCase`
for functions and variables, and kebab-case route/file names where the nearby
code uses them. Keep shared wire contracts in `packages/protocol` rather than
duplicating request or event shapes in mobile and gateway code.

## Testing Guidelines

Gateway, protocol, and database tests use Vitest; mobile tests use Jest with
`jest-expo`. Name tests `*.test.ts` or `*.test.tsx` under `src/__tests__/`.
Add a focused regression test for protocol changes, event ordering, permissions,
streaming/scroll behavior, or Markdown rendering. Tests must remain offline:
use the fake Claude adapter rather than real credentials or LAN services.

## Commit, Pull Request, and Security Guidelines

Follow the existing Conventional Commit pattern: `feat: add workspace browser`,
`fix: preserve streaming scroll position`. Keep commits small and scoped. PRs
need a concise behavior summary, tests run, linked issue when available, and
Android screenshots for visible mobile changes. Never commit `config.json`,
API keys, device tokens, local SQLite data, or build artifacts. Supply Gateway
credentials through local environment variables, and preserve phone-side tool
approval paths when changing Claude integration.
