# Compact Records and Session Working Directory Design

## Goal

Restore two capabilities on top of the rolled-back 1.0.10 codebase without building or installing a new APK:

1. `/compact` always leaves a readable success or failure record in the conversation.
2. A new session can use an existing project subdirectory, such as `myclaude/apps/mobile`, as its persistent working directory.

## Architecture

Use the existing session HTTP and event flow. Extend the shared Protocol and Database models with an optional `workingDirectory` relative path. The Gateway owns path validation, persistence, execution-directory resolution, and command-result persistence. The mobile app uses its existing project and directory browser; it does not infer or construct server paths.

No dedicated compact or working-directory endpoint will be added. This keeps session creation, reconnect, event replay, and later messages on one contract.

## Working Directory Flow

- Selecting a project defaults to its root directory.
- The directory picker lists existing directories only, supports entering a child directory and returning to its parent, and never creates files or folders.
- Session creation sends the selected relative directory. The Gateway rejects absolute paths, empty segments, `.`, `..`, NUL characters, missing directories, symlink escapes, and paths outside the configured project root.
- The validated relative directory is stored on the session. Initial execution, later messages, and interrupted-turn recovery resolve the same directory again before starting Claude.
- Existing sessions with no stored directory continue using the project root.

## `/compact` Records

- `/compact` is sent through the normal session message route.
- Claude Agent SDK `system/local_command_output` text is mapped into assistant output and accumulated with normal stream text.
- On success, the Gateway persists a final assistant record containing a clear success label and any returned compact result. If Claude reports success without text, the Gateway still persists a readable success message.
- On failure, the Gateway persists a readable failure record with a sanitized reason. API keys, tokens, authorization values, and sensitive server paths must not be included.
- Compacting Claude context never deletes or hides the mobile conversation history.

## Error Handling

Invalid working directories fail session creation with a specific path-validation response while preserving the user's task text. Command failures complete the turn in a non-running state and remain visible after refresh or reconnect. Duplicate request IDs remain idempotent and must not create duplicate compact records.

## Verification

- Protocol tests: optional working directory and command-event payloads.
- Database tests: migration, persistence, serialization, and legacy-session compatibility.
- Gateway tests: root and nested execution, invalid path rejection, reconnect/recovery, compact output, empty success, sanitized failure, and idempotency.
- Mobile tests: directory traversal, parent navigation, selected-path submission, and readable compact records.
- Run targeted tests, production TypeScript builds, and `git diff --check`.
- Do not build an APK, install an app, or alter the phone's current 1.0.10 installation.

## Delivery

Update the local source and the Gateway service only after verification. Server deployment must use an explicit source whitelist and exclude `apps/gateway/data`, `config.json`, `*.db`, `*.db-wal`, and `*.db-shm`. Verify the database hash before and after deployment and remove temporary deployment artifacts.
