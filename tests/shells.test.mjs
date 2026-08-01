import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
