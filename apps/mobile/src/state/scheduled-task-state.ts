import type { ScheduledTask } from '@claude-chat/protocol';

export function mergeScheduledTask(tasks: ScheduledTask[], next: ScheduledTask): ScheduledTask[] {
  return [next, ...tasks.filter(({ id }) => id !== next.id)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}
