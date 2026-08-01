import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const declarationFiles = await findDeclarationFiles(fileURLToPath(new URL('../dist', import.meta.url)));
for (const file of declarationFiles) {
  const source = await readFile(file, 'utf8');
  const rewritten = source.replaceAll(/((?:from|import)\s+['"](?:\.\.?\/[^'"]+))\.ts(['"])/gu, '$1.js$2');
  if (rewritten !== source) await writeFile(file, rewritten);
}

async function findDeclarationFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findDeclarationFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}
