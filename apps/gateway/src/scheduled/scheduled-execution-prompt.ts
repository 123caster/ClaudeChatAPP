export function buildScheduledExecutionPrompt(
  taskPrompt: string,
  scheduledFor: string,
  timeZone: string,
): string {
  return [
    '这是一次已触发的定时任务执行，不是创建或管理定时任务的请求。',
    `已经到达执行时间：${scheduledFor}（时区：${timeZone}）。`,
    '请立即使用当前数据和必要工具完成下面的任务。',
    '原始任务中的“定时”“每天”“推送”等词只描述触发频率；现在只执行内容主体。',
    '不要创建、修改、查看或解释任何定时任务，也不要调用 CronList、CronCreate、CronDelete。',
    '联网时优先使用 WebSearch、WebFetch 等只读工具。',
    '如果只读联网工具不可用，仅可用 curl -s "公开 HTTPS 地址" | head -c 数量读取有限内容；不得使用其他 Bash/Shell 命令、重定向、写文件或执行脚本。',
    '如果工具将大段结果保存在本轮 tool-results 文件中，可用 grep -oE 提取字段，但不得读取其他文件。',
    '不要回复任务已配置、提醒已设置、配置文件位置、有效期、后续建议或询问是否调整。',
    '只返回本次执行产生的实际结果；如果无法完成，返回真实失败原因和已尝试的步骤。',
    '',
    '原始任务：',
    taskPrompt.trim(),
  ].join('\n');
}
