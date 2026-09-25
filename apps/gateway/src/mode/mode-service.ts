import type { PermissionMode } from '@claude-chat/protocol';

export class ModeService {
  private current: PermissionMode = 'default';

  public get(): PermissionMode {
    return this.current;
  }

  public set(mode: PermissionMode): PermissionMode {
    this.current = mode;
    return this.current;
  }
}
