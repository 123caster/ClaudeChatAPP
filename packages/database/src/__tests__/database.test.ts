import { describe, expect, it } from 'vitest';

import { closeDatabase, createDatabase } from '../client.js';
import { openDatabaseConnection } from '../connection.js';
import { migrateDatabase, runMigrations } from '../migrate.js';

describe('database', () => {
  it('applies the complete initial schema once', () => {
    const database = openDatabaseConnection(':memory:');
    const now = () => new Date('2026-08-13T08:00:00Z');

    migrateDatabase(database, now);
    migrateDatabase(database, now);

    const tables = database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      'devices',
      'events',
      'messages',
      'permission_requests',
      'projects',
      'schema_migrations',
      'sessions',
      'tool_calls',
    ]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toMatchObject(
      { count: 3 },
    );

    database.close();
  });

  it('uses strict named parameters', () => {
    const database = openDatabaseConnection(':memory:');
    const statement = database.prepare('SELECT $value AS value');

    expect(() => statement.get({ value: 1 })).toThrow();
    expect(() => statement.get({ $unknown: 2, $value: 1 })).toThrow();
    expect(statement.get({ $value: 1 })).toMatchObject({ value: 1 });

    database.close();
  });

  it('rolls back a failed migration and leaves no open transaction', () => {
    const database = openDatabaseConnection(':memory:');

    expect(() =>
      runMigrations(database, [
        {
          version: 1,
          sql: `
            CREATE TABLE should_be_rolled_back (id INTEGER PRIMARY KEY) STRICT;
            INSERT INTO missing_table(id) VALUES (1);
          `,
        },
      ]),
    ).toThrow();

    expect(database.isTransaction).toBe(false);
    expect(
      database
        .prepare(`SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = $name`)
        .get({ $name: 'should_be_rolled_back' }),
    ).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toMatchObject(
      { count: 0 },
    );

    database.close();
  });

  it('closes idempotently', () => {
    const database = createDatabase(':memory:');

    closeDatabase(database);
    expect(database.isOpen).toBe(false);
    expect(() => closeDatabase(database)).not.toThrow();
    expect(() => database.close()).not.toThrow();
  });

  it('persists device token hashes and supports revocation', () => {
    const database = createDatabase(':memory:');
    const devices = database.devices;

    devices.create({
      id: 'device-1',
      name: 'Pixel',
      tokenHash: 'hash-only',
      createdAt: '2026-08-13T08:00:00.000Z',
    });

    expect(devices.countActive()).toBe(1);
    expect(devices.findActiveByTokenHash('hash-only')).toMatchObject({ id: 'device-1' });
    expect(devices.findActiveByTokenHash('plaintext-token')).toBeNull();
    devices.touch('device-1', '2026-08-13T08:30:00.000Z');
    expect(devices.findActiveByTokenHash('hash-only')).toMatchObject({
      lastSeenAt: '2026-08-13T08:30:00.000Z',
    });
    expect(devices.revoke('device-1', '2026-08-13T09:00:00.000Z')).toBe(true);
    expect(devices.revoke('device-1', '2026-08-13T10:00:00.000Z')).toBe(false);
    expect(devices.findActiveByTokenHash('hash-only')).toBeNull();

    closeDatabase(database);
  });

  it('enforces one active device at the database boundary', () => {
    const database = createDatabase(':memory:');
    const devices = database.devices;
    const first = {
      id: 'device-1',
      name: 'First phone',
      tokenHash: 'hash-1',
      createdAt: '2026-08-13T08:00:00.000Z',
    };
    const second = {
      id: 'device-2',
      name: 'Second phone',
      tokenHash: 'hash-2',
      createdAt: '2026-08-13T08:01:00.000Z',
    };

    devices.create(first);
    expect(() => devices.create(second)).toThrow();
    devices.revoke(first.id, '2026-08-13T09:00:00.000Z');
    expect(devices.create(second)).toMatchObject({ id: second.id });

    closeDatabase(database);
  });

  it('upserts and lists configured projects', () => {
    const database = createDatabase(':memory:');
    const projects = database.projects;

    projects.upsert({
      id: 'project-1',
      displayName: 'ClaudeChatAPP',
      rootPath: 'D:\\ouyang\\Projects\\ClaudeChatAPP',
      createdAt: '2026-08-13T08:00:00.000Z',
    });
    projects.upsert({
      id: 'ignored-on-conflict',
      displayName: 'Renamed project',
      rootPath: 'D:\\ouyang\\Projects\\ClaudeChatAPP',
      createdAt: '2026-08-13T09:00:00.000Z',
    });

    expect(projects.list()).toEqual([
      {
        id: 'project-1',
        displayName: 'Renamed project',
        rootPath: 'D:\\ouyang\\Projects\\ClaudeChatAPP',
        createdAt: '2026-08-13T08:00:00.000Z',
      },
    ]);

    closeDatabase(database);
  });

  it('hides projects removed from trusted configuration', () => {
    const database = createDatabase(':memory:');
    const projects = database.projects;
    const first = {
      id: 'project-1',
      displayName: 'First',
      rootPath: 'D:\\Projects\\first',
      createdAt: '2026-08-13T08:00:00.000Z',
    };
    const second = {
      id: 'project-2',
      displayName: 'Second',
      rootPath: 'D:\\Projects\\second',
      createdAt: '2026-08-13T08:00:00.000Z',
    };

    projects.synchronize([first, second]);
    expect(projects.list()).toHaveLength(2);
    projects.synchronize([second]);
    expect(projects.list()).toEqual([second]);

    closeDatabase(database);
  });
});
