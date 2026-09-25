import { describe, expect, it } from 'vitest';

import {
  InvalidScheduleError,
  latestMissedOccurrence,
  nextOccurrence,
  previousOccurrence,
} from '../scheduled/schedule-calculator.js';

describe('schedule calculator', () => {
  it('calculates one-time, daily, weekday and weekly occurrences', () => {
    expect(
      nextOccurrence(
        { kind: 'once', localDate: '2026-09-20', hour: 9, minute: 30 },
        'Asia/Shanghai',
        new Date('2026-09-19T00:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-09-20T01:30:00.000Z');
    expect(
      nextOccurrence(
        { kind: 'daily', hour: 9, minute: 0 },
        'Asia/Shanghai',
        new Date('2026-09-16T01:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-09-17T01:00:00.000Z');
    expect(
      nextOccurrence(
        { kind: 'weekdays', hour: 9, minute: 0 },
        'Asia/Shanghai',
        new Date('2026-09-18T02:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-09-21T01:00:00.000Z');
    expect(
      nextOccurrence(
        { kind: 'weekly', weekday: 1, hour: 9, minute: 0 },
        'Asia/Shanghai',
        new Date('2026-09-21T01:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-09-28T01:00:00.000Z');
  });

  it('skips months that do not contain the requested day', () => {
    expect(
      nextOccurrence(
        { kind: 'monthly', day: 31, hour: 9, minute: 0 },
        'UTC',
        new Date('2027-01-31T10:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2027-03-31T09:00:00.000Z');
  });

  it('skips a nonexistent DST wall-clock time', () => {
    expect(
      nextOccurrence(
        { kind: 'daily', hour: 2, minute: 30 },
        'America/New_York',
        new Date('2026-03-07T08:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-03-09T06:30:00.000Z');
  });

  it('treats repeated DST wall-clock time as one occurrence', () => {
    const schedule = { kind: 'daily' as const, hour: 1, minute: 30 };
    expect(
      nextOccurrence(
        schedule,
        'America/New_York',
        new Date('2026-10-31T12:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      nextOccurrence(
        schedule,
        'America/New_York',
        new Date('2026-11-01T05:30:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-11-02T06:30:00.000Z');
  });

  it('finds the latest missed occurrence without replaying every missed run', () => {
    const schedule = { kind: 'daily' as const, hour: 9, minute: 0 };
    expect(
      latestMissedOccurrence(
        schedule,
        'Asia/Shanghai',
        new Date('2026-09-12T01:00:00.000Z'),
        new Date('2026-09-16T03:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-09-16T01:00:00.000Z');
    expect(
      previousOccurrence(
        schedule,
        'Asia/Shanghai',
        new Date('2026-09-16T00:59:59.000Z'),
      )?.toISOString(),
    ).toBe('2026-09-15T01:00:00.000Z');
  });

  it('rejects invalid IANA time zones', () => {
    expect(() =>
      nextOccurrence({ kind: 'daily', hour: 9, minute: 0 }, 'Mars/Olympus', new Date()),
    ).toThrow(InvalidScheduleError);
  });
});
