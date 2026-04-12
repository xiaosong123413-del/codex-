import fs from 'node:fs/promises';
import path from 'node:path';

const sourceDir = 'C:/Users/Administrator/Desktop/xiaosong的知识库/ai知识库（第二大脑）/.wiki-system';
const targetDir = 'C:/Users/Administrator/Documents/New project/.worktrees/second-brain-web-workspace/wiki-ui/generated';

await fs.mkdir(targetDir, { recursive: true });

for (const file of await fs.readdir(sourceDir)) {
  await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file));
}

console.log('wiki-ui generated artifacts synced');
