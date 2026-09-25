import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { SkillSummary } from '@claude-chat/protocol';

// Extracts the `name` and `description` keys from YAML-style frontmatter
// (`---\nname: x\ndescription: y\n---`) at the top of a SKILL.md / command file.
function parseFrontmatter(
  source: string,
  fallbackName: string,
): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return { name: fallbackName, description: source.trim().split('\n')[0] ?? '' };

  const body = match[1] ?? '';
  const nameMatch = /^name:\s*(.+)$/m.exec(body);
  const descMatch = /^description:\s*(.+)$/m.exec(body);
  return {
    name: (nameMatch?.[1] ?? fallbackName).trim(),
    description: (descMatch?.[1] ?? '').trim(),
  };
}

function listUserSkills(root: string): SkillSummary[] {
  const skillsDir = path.join(root, 'skills');
  if (!existsSync(skillsDir)) return [];
  const results: SkillSummary[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      const { name, description } = parseFrontmatter(readFileSync(skillFile, 'utf8'), entry.name);
      if (name && description) {
        results.push({ name, description: description.slice(0, 500), kind: 'skill' });
      }
    } catch {
      // Skip unreadable skill files.
    }
  }
  return results;
}

function listUserCommands(root: string): SkillSummary[] {
  const commandsDir = path.join(root, 'commands');
  if (!existsSync(commandsDir)) return [];
  const results: SkillSummary[] = [];
  const readCommands = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        readCommands(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const commandName = entry.name.slice(0, -3);
        try {
          const { name, description } = parseFrontmatter(
            readFileSync(fullPath, 'utf8'),
            `/${commandName}`,
          );
          results.push({
            name: name.startsWith('/') ? name : `/${name}`,
            description: description.slice(0, 500),
            kind: 'command',
          });
        } catch {
          // Skip unreadable command files.
        }
      }
    }
  };
  try {
    readCommands(commandsDir);
  } catch {
    // Ignore unreadable command directory.
  }
  return results;
}

export class SkillService {
  public constructor(private readonly claudeDir: string = path.join(homedir(), '.claude')) {}

  public list(): SkillSummary[] {
    try {
      const skills: SkillSummary[] = [
        ...listUserSkills(this.claudeDir),
        ...listUserCommands(this.claudeDir),
      ];
      skills.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
      return skills;
    } catch {
      return [];
    }
  }
}
