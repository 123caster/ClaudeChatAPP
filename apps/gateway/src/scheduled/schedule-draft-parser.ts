import type { Schedule, ScheduledTaskDraft } from '@claude-chat/protocol';

const weekdays: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

function parseTime(text: string): { hour: number; minute: number } | null {
  const match = text.match(
    /(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?::(\d{2})|点(?:(\d{1,2})分?)?)/,
  );
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3] ?? match[4] ?? 0);
  if (minute > 59 || hour > 23) return null;
  if (['下午', '晚上'].includes(match[1] ?? '') && hour < 12) hour += 12;
  if (match[1] === '中午' && hour < 11) hour += 12;
  if (match[1] === '凌晨' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return { hour, minute };
}

function parseSchedule(text: string): Schedule | null {
  const time = parseTime(text);
  if (!time) return null;

  const once = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|号)?/);
  if (once) {
    return {
      kind: 'once',
      localDate: `${once[1]}-${once[2]!.padStart(2, '0')}-${once[3]!.padStart(2, '0')}`,
      ...time,
    };
  }
  if (/每个?工作日/.test(text)) return { kind: 'weekdays', ...time };
  const weekly = text.match(/每周([一二三四五六日天])/);
  if (weekly) return { kind: 'weekly', weekday: weekdays[weekly[1]!]!, ...time };
  const monthly = text.match(/每月\s*(\d{1,2})(?:日|号)/);
  if (monthly) {
    const day = Number(monthly[1]);
    if (day >= 1 && day <= 31) return { kind: 'monthly', day, ...time };
  }
  if (/每天|每日/.test(text)) return { kind: 'daily', ...time };
  return null;
}

export function parseScheduledTaskDraft(input: {
  text: string;
  timeZone: string;
  projectId?: string | null;
  workingDirectory?: string | null;
  modelId?: string | null;
}): ScheduledTaskDraft {
  const prompt = input.text.replace(/^\s*\/schedule\s*/i, '').trim();
  const schedule = parseSchedule(prompt);
  const missingFields: ScheduledTaskDraft['missingFields'] = [];
  if (!prompt) missingFields.push('prompt');
  if (!schedule) missingFields.push('schedule');
  if (!input.projectId) missingFields.push('projectId');

  return {
    name: prompt ? prompt.slice(0, 40) : null,
    prompt,
    schedule,
    timeZone: input.timeZone,
    projectId: input.projectId ?? null,
    workingDirectory: input.workingDirectory ?? null,
    modelId: input.modelId ?? null,
    allowAutoWrite: false,
    missingFields,
  };
}
