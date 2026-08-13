import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { HealthResponse } from '@claude-chat/protocol';

const execFileAsync = promisify(execFile);
export type ClaudeHealth = HealthResponse['claude'];

type AuthStatus = { loggedIn?: boolean };

export function hasAgentSdkCredential(environment: NodeJS.ProcessEnv = process.env): boolean {
  return [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  ].some((name) => Boolean(environment[name]?.trim()));
}

export class ClaudeHealthMonitor {
  private state: ClaudeHealth = { status: 'starting' };
  private inFlight: Promise<ClaudeHealth> | null = null;

  public constructor(
    private readonly executablePath: string,
    private readonly probe: (executablePath: string) => Promise<AuthStatus> = async (path) => {
      const executable =
        process.platform === 'win32' && path.toLowerCase().endsWith('.cmd')
          ? (process.env.ComSpec ?? 'cmd.exe')
          : path;
      const args =
        executable === path
          ? ['auth', 'status', '--json']
          : ['/d', '/s', '/c', path, 'auth', 'status', '--json'];
      const { stdout } = await execFileAsync(executable, args, {
        timeout: 10_000,
        windowsHide: true,
      });
      return JSON.parse(stdout) as AuthStatus;
    },
    private readonly credentialAvailable: () => boolean = () => hasAgentSdkCredential(),
  ) {}

  public snapshot(): ClaudeHealth {
    return this.state;
  }

  public refresh(): Promise<ClaudeHealth> {
    if (this.inFlight) return this.inFlight;
    if (!this.credentialAvailable()) {
      this.state = {
        status: 'unauthenticated',
        message: 'Configure an Agent SDK credential on this computer.',
      };
      return Promise.resolve(this.state);
    }
    this.inFlight = this.probe(this.executablePath)
      .then((status): ClaudeHealth =>
        typeof status.loggedIn !== 'boolean'
          ? { status: 'incompatible', message: 'Claude Code returned an unsupported status.' }
          : status.loggedIn
            ? { status: 'ready' }
            : { status: 'unauthenticated', message: 'Claude Code is not signed in.' },
      )
      .catch((): ClaudeHealth => ({
        status: 'unavailable',
        message: 'Claude Code is unavailable on this computer.',
      }))
      .then((state) => {
        this.state = state;
        return state;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
