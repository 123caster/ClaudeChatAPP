# Workspace Interaction and Gateway Operations Design

## Goal

Make the mobile client useful as a project workspace and reliable as a remote
Claude control surface: users can browse real files, return through directories
with Android back navigation, read streaming answers without viewport jumps,
respond to Claude questions, and diagnose Gateway behavior from retained logs.

## Workspace Files

The Gateway will list both files and directories inside the configured project
root. A directory request uses a validated project id and a relative path; the
path policy rejects paths outside the configured root. File preview requests
use the same policy and return UTF-8 text only, with a maximum response size.
Binary and oversized files remain visible but are not opened as text.

The mobile workspace keeps a directory-location stack rather than treating
every child as a registered project. It renders folders before files, opens
text files in a read-only preview, and handles Android back gestures and the
header back action by popping that stack before leaving the workspace route.

## Stream Reading Stability

The chat screen uses one coordinator for all programmatic movement. New items,
layout changes, and streamed-content growth request a single scheduled follow
operation. A reader is followed only while already near the latest message;
manual upward scrolling disables following until the latest-message action is
chosen. Stream growth is rate-limited so one response does not schedule several
competing scrolls in the same layout cycle.

## Claude Questions and Permissions

`AskUserQuestion` becomes a durable interaction record rather than being
silently denied. The Gateway persists and emits question-requested and
question-resolved events, the client shows a response card in the conversation,
and the selected or typed answer is returned to the blocked Claude turn.
Pending interactions also surface outside the currently open conversation, so
a waiting session is visible from the session list.

## Gateway Logs

The Gateway writes redacted JSON logs to dated files in its data directory.
Startup and a twelve-hour timer delete matching log files older than three days.
Request secrets, API keys, Authorization headers, and vendor tokens are never
written. Log creation, retention cleanup, question lifecycle, and event-delivery
failures have focused automated coverage.

## Acceptance

- A configured workspace exposes files and nested directories; text files open
  read-only and paths cannot escape a project root.
- Android system Back or the header action moves from a child folder to its
  parent without exiting the app.
- A long streamed answer moves only when needed to remain readable at the end;
  it does not repeatedly jump while the same message grows.
- Claude questions and tool permissions are visible after reconnecting and can
  be resolved from the phone.
- Gateway logs exist on the server, redact secrets, and files older than three
  days are removed.
