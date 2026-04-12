import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeArtifacts({ systemDir, artifacts }) {
  await fs.mkdir(systemDir, { recursive: true });

  await Promise.all(
    Object.entries(artifacts).map(([name, value]) =>
      fs.writeFile(path.join(systemDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    )
  );
}
