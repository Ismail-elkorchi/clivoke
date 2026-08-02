import { basename, join } from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distRoot = fileURLToPath(new URL('../dist', import.meta.url));
const files = await findFiles(distRoot);
const fileSet = new Set(files);

for (const file of files.filter((candidate) => candidate.endsWith('.d.ts'))) {
  const source = await readFile(file, 'utf8');
  const rewritten = source.replaceAll(
    /((?:from|import)\s+['"](?:\.\.?\/[^'"]+))\.ts(['"])/gu,
    '$1.js$2'
  );
  if (rewritten !== source) await writeFile(file, rewritten);
}

for (const file of files.filter((candidate) => candidate.endsWith('.js'))) {
  const declaration = `${file.slice(0, -3)}.d.ts`;
  if (!fileSet.has(declaration)) continue;
  const source = await readFile(file, 'utf8');
  await writeFile(file, `// @ts-self-types="./${basename(declaration)}"\n${source}`);

  const sourceMapPath = `${file}.map`;
  if (!fileSet.has(sourceMapPath)) continue;
  const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
  if (typeof sourceMap.mappings === 'string') {
    sourceMap.mappings = `;${sourceMap.mappings}`;
    await writeFile(sourceMapPath, `${JSON.stringify(sourceMap)}\n`);
  }
}

async function findFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}
