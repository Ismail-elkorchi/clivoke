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
  assert.equal(await readFile(recorded, 'utf8'), 'lines\n2\nship\ndeploy\n--r\n');
});

test('PowerShell completion derives the active word from the supplied cursor', () => {
  const script = createCompletionScript(cli, 'pwsh');
  assert.match(script, /Extent\.EndOffset -lt \$cursorPosition/u);
  assert.doesNotMatch(script, /words\.Count - 1/u);
});

test('Zsh transports a mid-line word vector and cursor', async (context) => {
  if (!(await available('zsh'))) {
    context.skip('zsh is unavailable');
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-zsh-completion-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const { executablePath, recorded } = await createRecordingExecutable(workspace);
  const script = createCompletionScript(cli, 'zsh', executablePath);
  const command = `compdef() {}\ncompadd() { print -r -- "$@[-1]" }\n${script}\nwords=(ship deploy --r tail)\nCURRENT=3\nPREFIX=--r\n_ship`;
  const result = await execFileAsync(executable('zsh'), ['-c', command]);
  assert.equal(result.stdout, '--region\n');
  assert.equal(await readFile(recorded, 'utf8'), 'lines\n2\nship\ndeploy\n--r\ntail\n');
});

test('Fish transports an empty current word', async (context) => {
  if (!(await available('fish'))) {
    context.skip('fish is unavailable');
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-fish-completion-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const { executablePath, recorded } = await createRecordingExecutable(workspace);
  const script = createCompletionScript(cli, 'fish', executablePath);
  const command = `function commandline\n  switch $argv[1]\n    case -opc\n      printf '%s\\n' ship deploy\n    case -ct\n      printf ''\n  end\nend\n${script}\n__ship_complete`;
  const result = await execFileAsync(executable('fish'), ['-c', command]);
  assert.equal(result.stdout, '--region\n');
  assert.equal(await readFile(recorded, 'utf8'), 'lines\n2\nship\ndeploy\n\n');
});

test('PowerShell transports the cursor-selected word instead of the final word', async (context) => {
  if (!(await available('pwsh'))) {
    context.skip('pwsh is unavailable');
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-pwsh-completion-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const recorded = join(workspace, 'arguments.txt');
  const executablePath = join(workspace, 'ship-complete.ps1');
  await writeFile(
    executablePath,
    `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$rest)\n[IO.File]::WriteAllLines('${powerShellLiteral(recorded)}', $rest)\n'--region'\n`
  );
  const script = createCompletionScript(cli, 'pwsh', executablePath);
  const command = `${script}\n$result = TabExpansion2 'ship deploy --r tail' 15\n$result.CompletionMatches | ForEach-Object { $_.CompletionText }`;
  const result = await execFileAsync(executable('pwsh'), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command
  ]);
  assert.match(result.stdout, /--region/u);
  assert.equal(await readFile(recorded, 'utf8'), 'lines\n2\nship\ndeploy\n--r\ntail\n');
});

async function createRecordingExecutable(workspace) {
  const recorded = join(workspace, 'arguments.txt');
  const executablePath = join(workspace, 'ship-complete');
  await writeFile(
    executablePath,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${recorded}'\nprintf '%s\\n' '--region'\n`
  );
  await chmod(executablePath, 0o755);
  return { executablePath, recorded };
}

function powerShellLiteral(value) {
  return value.replaceAll("'", "''");
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
