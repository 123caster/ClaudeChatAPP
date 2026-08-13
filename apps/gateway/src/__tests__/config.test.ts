import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadGatewayConfig } from '../config.js';

const directories: string[] = [];

function config(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude-chat-config-'));
  directories.push(directory);
  const path = join(directory, 'config.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('loadGatewayConfig Claude options', () => {
  it('keeps legacy configs on the fake adapter', () => {
    const loaded = loadGatewayConfig(
      config({ projects: [{ displayName: 'Project', path: 'D:\\Projects\\sample' }] }),
    );
    expect(loaded.claude).toEqual({ adapter: 'fake' });
  });

  it('accepts strict Agent SDK configuration', () => {
    const loaded = loadGatewayConfig(
      config({
        claude: {
          adapter: 'agent-sdk',
          executablePath: 'C:\\Tools\\claude.exe',
          model: 'claude-test',
        },
        projects: [{ displayName: 'Project', path: 'D:\\Projects\\sample' }],
      }),
    );
    expect(loaded.claude).toEqual({
      adapter: 'agent-sdk',
      executablePath: 'C:\\Tools\\claude.exe',
      model: 'claude-test',
    });
  });

  it('rejects unknown Claude fields', () => {
    expect(() =>
      loadGatewayConfig(
        config({
          claude: { adapter: 'agent-sdk', bypassPermissions: true },
          projects: [{ displayName: 'Project', path: 'D:\\Projects\\sample' }],
        }),
      ),
    ).toThrow();
  });
});
