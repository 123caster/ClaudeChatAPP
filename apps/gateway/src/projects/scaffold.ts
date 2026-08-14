import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeScaffold(rootPath: string, folderName: string): void {
  mkdirSync(rootPath, { recursive: true });

  const packageJson = {
    name: folderName,
    version: '0.0.0',
    private: true,
    type: 'module',
  };

  writeFileSync(path.join(rootPath, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(path.join(rootPath, '.gitignore'), 'node_modules/\ndist/\n.env\n');
  writeFileSync(path.join(rootPath, 'README.md'), `# ${folderName}\n`);
}
