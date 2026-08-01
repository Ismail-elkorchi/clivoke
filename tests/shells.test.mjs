import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createCli, createCompletionScript } from '../dist/index.js';

const execFileAsync = promisify(execFile);
const cli = createCli({ name: 'ship' });

for (const { shell, command, args } of [
  { shell: 'bash', command: 'bash', args: (script) => ['-n', '-c', script] },
  { shell: 'zsh', command: 'zsh', args: (script) => ['-n', '-c', script] },
  { shell: 'fish', command: 'fish', args: (script) => ['-n', '-c', script] },
  {
    shell: 'pwsh',
    command: 'pwsh',
    args: (script) => [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$null = [scriptblock]::Create($args[0])',
      script
    ]
  }
]) {
  test(`${shell} accepts its generated completion script`, async (context) => {
    if (!(await available(command))) {
      context.skip(`${command} is unavailable`);
      return;
    }
    const script = createCompletionScript(cli, shell);
    const result = await execFileAsync(executable(command), args(script));
    assert.equal(result.stderr, '');
  });
}

test('bash transports the complete word vector and cursor to the companion executable', async (context) => {
  if (!(await available('bash'))) {
    context.skip('bash is unavailable');
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-bash-completion-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const recorded = join(workspace, 'arguments.txt');
  const executablePath = join(workspace, 'ship-complete');
  await writeFile(executablePath, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${recorded}'\nprintf '%s\\n' '--region'\n`);
  await chmod(executablePath, 0o755);
  const script = createCompletionScript(cli, 'bash', executablePath);
  const command = `${script}\nCOMP_WORDS=(ship deploy --r)\nCOMP_CWORD=2\n_ship\nprintf '%s\\n' "\${COMPREPLY[@]}"`;
  const result = await execFileAsync(executable('bash'), ['-c', command]);
  assert.equal(result.stdout, '--region\n');
  assert.equal(await readFile(recorded, 'utf8'), '2\nship\ndeploy\n--r\n');
});

async function available(command) {
  try {
    await execFileAsync(executable(command), ['--version']);
    return true;
  } catch {
    return false;
  }
}

function executable(command) {
  return process.platform === 'win32' ? `${command}.exe` : command;
}
