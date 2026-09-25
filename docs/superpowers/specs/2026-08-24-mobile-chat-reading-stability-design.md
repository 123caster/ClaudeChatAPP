# Mobile Chat Reading Stability Design

## Goal

Make long Claude conversations read naturally on a phone without changing the
Gateway protocol: streamed text must not make the view jump, older history must
remain incremental, and large Markdown blocks must not monopolize the screen.

## Scope

- Coalesce `assistant.delta` events in the mobile screen for a short frame-sized
  interval before updating chat state.
- Keep following the timeline only while the reader is already at the latest
  message. A reader who scrolls up stays at that position and can use the
  existing latest-message control to return to the end.
- Preserve the existing 50-item initial timeline window and earlier-message
  batches. This is UI-side windowing over the already loaded session detail;
  no Gateway pagination contract changes in this iteration.
- Reduce the maximum visible height of code blocks and tables, retaining their
  independent vertical and horizontal scrolling.

## Data Flow

Gateway events continue to enter through `sessions.subscribe`. Persistent
events are dispatched immediately. Streaming deltas are queued only when the
streaming switch is enabled, then dispatched in arrival order every 50ms. The
queue is flushed before unmount and reset on session changes. A content-size
callback scrolls to the end only when `followTailRef` is true.

## Acceptance

- A long streamed answer updates in readable chunks instead of per-token
  layout churn.
- Manually scrolling upward never snaps the reader back to the latest answer.
- Opening a lengthy session still starts from its recent 50 timeline items and
  can expose earlier items on demand.
- Code and tables stay constrained within a compact mobile viewport while all
  content remains reachable by scrolling.
