# ClaudeChat White Mobile Design

## Intent

Redesign ClaudeChat as a calm white mobile control surface inspired by Happy Coder's remote coding companion positioning, without copying its brand or assets.

## Visual System

- White canvas with `#F7F8F8` grouped sections, `#151A1E` primary text, and `#7B858D` secondary text.
- One restrained teal (`#147D75`) conveys connection, execution, and primary confirmation. Destructive actions remain red.
- Use 8px corners, hairline separators, system typography, and no decorative shadows or gradients.

## Screens

- Connection: compact credential form with a trust statement.
- Sessions: project-aware rows, clear time/status metadata, and one floating create action.
- Chat: left/right conversation flow; inline tool progress; permission approval presented as a bottom sheet.
- New session, workspace, models, and permission modes: grouped settings/list layouts with consistent headers and controls.

## Interaction

- The browser prototype navigates all screens from the bottom bar and session/new-session actions.
- Status tokens preserve semantics: teal for live/connected, amber for approval needed, and red for destructive or failed actions.

## Acceptance

- Every existing mobile workflow has a visual counterpart.
- The interface is legible on a 390px phone viewport without overflowing text.
- Existing network and state behavior remains unchanged when the design is later implemented in Expo.

## Confirmed Implementation Scope

- Apply the white workbench system to connection, sessions, chat, new session,
  workspace, model, and permission-mode screens. Use Android `sans-serif` for
  display text so a device theme font cannot change the product's visual tone.
- Rebuild chat as a compact mobile conversation surface: a fixed utility header,
  quiet left/right message groups, restrained system status, and a stable bottom
  composer. Tool progress and permissions remain inline and keep their existing
  gateway/state behavior.
- Render assistant Markdown as native mobile content. Support headings, bold,
  emphasis, inline and fenced code, bullets, numbered lists, quotes, links,
  dividers, and GFM-style tables. Tables scroll horizontally rather than leaking
  pipe syntax or overflowing the conversation width.
- Provide one Android release build command. It builds from a short-lived,
  short-path working copy, retains only the final APK under the project `dist`
  directory, and removes its copied sources, dependencies, Gradle/CMake output,
  and logs whether the build succeeds or fails.
