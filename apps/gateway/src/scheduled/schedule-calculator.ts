import { DateTime, IANAZone } from 'luxon';
import type { Schedule } from '@claude-chat/protocol';

export class InvalidScheduleError extends Error {}

function assertTimeZone(timeZone: string): void {
  if (!IANAZone.isValidZone(timeZone)) {
    throw new InvalidScheduleError(`Invalid IANA time zone: ${timeZone}`);
  }
}

function candidateForDate(date: DateTime, hour: number, minute: number): DateTime | null {
  const candidate = DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour, minute, second: 0, millisecond: 0 },
    { zone: date.zone },
  );
  if (
    !candidate.isValid ||
    candidate.year !== date.year ||
    candidate.month !== date.month ||
    candidate.day !== date.day ||
    candidate.hour !== hour ||
    candidate.minute !== minute
  ) {
    return null;
  }

  // A repeated wall-clock time during DST fallback is one logical occurrence.
  return candidate
    .getPossibleOffsets()
    .sort((left, right) => left.toMillis() - right.toMillis())[0]!;
}

function matchesDay(schedule: Schedule, date: DateTime): boolean {
  switch (schedule.kind) {
    case 'once':
      return date.toFormat('yyyy-LL-dd') === schedule.localDate;
    case 'daily':
      return true;
    case 'weekdays':
      return date.weekday <= 5;
    case 'weekly':
      return date.weekday === schedule.weekday;
    case 'monthly':
      return date.day === schedule.day;
  }
}

function searchLimit(schedule: Schedule): number {
  return schedule.kind === 'monthly' ? 3_700 : schedule.kind === 'once' ? 2 : 3_700;
}

export function nextOccurrence(schedule: Schedule, timeZone: string, after: Date): Date | null {
  assertTimeZone(timeZone);
  const afterMillis = after.getTime();
  let date = DateTime.fromMillis(afterMillis, { zone: timeZone }).startOf('day');

  for (let offset = 0; offset < searchLimit(schedule); offset += 1) {
    if (matchesDay(schedule, date)) {
      const candidate = candidateForDate(date, schedule.hour, schedule.minute);
      if (candidate && candidate.toMillis() > afterMillis) return candidate.toJSDate();
    }
    if (schedule.kind === 'once' && date.toFormat('yyyy-LL-dd') >= schedule.localDate) return null;
    date = date.plus({ days: 1 });
  }

  throw new InvalidScheduleError('Could not find the next occurrence within the search window.');
}

export function previousOccurrence(
  schedule: Schedule,
  timeZone: string,
  atOrBefore: Date,
): Date | null {
  assertTimeZone(timeZone);
  const limitMillis = atOrBefore.getTime();
  let date = DateTime.fromMillis(limitMillis, { zone: timeZone }).startOf('day');

  for (let offset = 0; offset < searchLimit(schedule); offset += 1) {
    if (matchesDay(schedule, date)) {
      const candidate = candidateForDate(date, schedule.hour, schedule.minute);
      if (candidate && candidate.toMillis() <= limitMillis) return candidate.toJSDate();
    }
    if (schedule.kind === 'once' && date.toFormat('yyyy-LL-dd') <= schedule.localDate) return null;
    date = date.minus({ days: 1 });
  }

  throw new InvalidScheduleError(
    'Could not find the previous occurrence within the search window.',
  );
}

export function latestMissedOccurrence(
  schedule: Schedule,
  timeZone: string,
  afterExclusive: Date,
  throughInclusive: Date,
): Date | null {
  if (throughInclusive.getTime() <= afterExclusive.getTime()) return null;
  const latest = previousOccurrence(schedule, timeZone, throughInclusive);
  return latest && latest.getTime() > afterExclusive.getTime() ? latest : null;
}
