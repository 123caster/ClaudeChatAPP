import { BUILTIN_COMMANDS } from '@/constants/commands';

describe('built-in chat commands', () => {
  it('lists help, status and compact alongside the existing session commands', () => {
    expect(BUILTIN_COMMANDS.map(({ command }) => command)).toEqual([
      '/help',
      '/status',
      '/clear',
      '/compact',
      '/model',
      '/skill',
      '/schedule',
    ]);
  });
});
