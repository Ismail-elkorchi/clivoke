import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workflowsDirectory = path.join(process.cwd(), '.github', 'workflows');

const violations = [];
for (const fileName of (await readdir(workflowsDirectory)).sort()) {
  if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) continue;
  const source = (await readFile(path.join(workflowsDirectory, fileName), 'utf8'))
    .replace(/\r\n/gu, '\n');
  if (!/^permissions:\s*$/mu.test(source)) {
    violations.push(`${fileName}: missing top-level permissions block`);
  }
  if (/(^|\n)\s*pull_request_target\s*:/mu.test(source)) {
    violations.push(`${fileName}: pull_request_target is forbidden`);
  }
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('uses:') || !trimmed.includes('@')) continue;
    const reference = trimmed.slice(trimmed.lastIndexOf('@') + 1).split('#')[0]?.trim() ?? '';
    if (!/^[0-9a-fA-F]{40}$/u.test(reference)) {
      violations.push(`${fileName}: action ref must be a full commit SHA (${reference || 'empty'})`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`[workflow-policy] violations detected:\n${violations.map((item) =>
    `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
}
