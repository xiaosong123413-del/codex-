import fs from 'node:fs/promises';
import path from 'node:path';

const generatedRoot = path.join(process.cwd(), 'generated');

async function readJsonFile(name) {
  const raw = await fs.readFile(path.join(generatedRoot, name), 'utf8');
  return JSON.parse(raw);
}

export function loadTaxonomy() {
  return readJsonFile('taxonomy.json');
}

export function loadBacklinks() {
  return readJsonFile('_backlinks.json');
}

export function loadPageMeta() {
  return readJsonFile('page-meta.json');
}

export function loadAbsorbLog() {
  return readJsonFile('_absorb_log.json');
}
