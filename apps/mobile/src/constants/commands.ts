export type BuiltinCommand = {
  command: string;
  description: string;
};

// Built-in slash commands available in any Claude Code session.
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { command: '/help', description: '查看手机端可用命令和说明' },
  { command: '/status', description: '查看会话、模型、模式和连接状态' },
  { command: '/clear', description: '清空当前会话上下文' },
  { command: '/compact', description: '压缩 Claude 后续上下文，保留聊天记录' },
  { command: '/model', description: '查看或切换当前模型' },
  { command: '/skill', description: '选择并插入 Claude 技能命令' },
  { command: '/schedule', description: '把自然语言任务转换为待确认的定时任务' },
];
