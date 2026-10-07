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
  { shell: 'fish', command: 'fish', args: (script) => ['--no-config', '-n', '-c', script] },
  {
    shell: 'pwsh',
    command: 'pwsh',
    args: (script) => [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$null = [scriptblock]::Create('${powerShellLiteral(script)}')`
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
  const command = `${script}\nCOMP_LINE='ship deploy --r'\nCOMP_POINT=15\nCOMP_WORDS=(ship deploy --r)\nCOMP_CWORD=2\n${completionFunction(script)}\nprintf '%s\\n' "\${COMPREPLY[@]}"`;
  const result = await execFileAsync(executable('bash'), ['-c', command]);
  assert.equal(result.stdout, '--region\n');
  assert.equal(await readFile(recorded, 'utf8'), 'lines\n2\nship\ndeploy\n--r\n');
});

test('PowerShell completion derives the active word from the supplied cursor', () => {
  const script = createCompletionScript(cli, 'pwsh');
  assert.match(script, /Extent\.EndOffset -lt \$cursorPosition/u);
  assert.match(script, /cursorPosition - \$element\.Extent\.StartOffset/u);
  assert.match(script, /CompletionResult\]::new/u);
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
  const command = `compdef() {}\ncompadd() { print -r -- "$@[-1]" }\n${script}\nwords=(ship deploy --r tail)\nCURRENT=3\nPREFIX=--r\n${completionFunction(script)}`;
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
  const command = `function commandline\n  switch $argv[1]\n    case -opc\n      printf '%s\\n' ship deploy\n    case -ct\n      printf ''\n  end\nend\n${script}\n${completionFunction(script)}`;
  const result = await execFileAsync(executable('fish'), ['--no-config', '-c', command]);
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
  assert.equal(await readFile(recorded, 'utf8'), 'lines\n2\nship\ndeploy\n--r\n');
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

for (const shell of ['bash', 'zsh']) {
  test(`${shell} accepts literal candidates through a real terminal`, async (context) => {
    if (process.platform === 'win32' || !(await available(shell)) || !(await available('python3'))) {
      context.skip('A POSIX shell and Python PTY support are required');
      return;
    }
    const workspace = await mkdtemp(join(tmpdir(), `clivoke-${shell}-pty-`));
    context.after(() => rm(workspace, { recursive: true, force: true }));
    const companion = join(workspace, 'complete');
    await writeFile(companion, `#!/usr/bin/env bash
printf '%s\\0' "$@" > ${shellLiteral(join(workspace, 'request.bin'))}
cat ${shellLiteral(join(workspace, 'candidates.txt'))}
`);
    await chmod(companion, 0o755);
    const script = join(workspace, 'completion');
    await writeFile(script, createCompletionScript(cli, shell, companion));
    const programPath = join(workspace, 'ship');
    await writeFile(programPath, `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > ${shellLiteral(join(workspace, 'accepted.txt'))}\n`);
    await chmod(programPath, 0o755);
    const common = `ship(){ printf '%s\\0' "$@" > ${shellLiteral(join(workspace, 'accepted.txt'))}; }; source ${shellLiteral(script)}`;
    // The driver uses Emacs cursor keys; EDITOR/VISUAL may otherwise select vi.
    const setup = shell === 'bash'
      ? `PS1='CLIVOKE_''READY> '; PS2='INCOMPLETE> '; set -o emacs; bind 'set enable-bracketed-paste off'; ${common}`
      : `PROMPT='CLIVOKE_''READY> '; PROMPT2='INCOMPLETE> '; autoload -Uz compinit; compinit -D; bindkey -e; setopt COMPLETE_IN_WORD; ${common}`;
    const cases = [
      ['ship --region=eu', '--region=eu west', ['--region=eu']],
      ['ship --region="eu', '--region=eu west', ['--region=eu']],
      ['ship "ab c', 'ab cd', ['ab c']],
      ["ship 'ab c", "ab cd'ef", ['ab c']],
      ['ship ab"c d', 'abc def', ['abc d']],
      ['ship a\\ b', 'a bc', ['a b']],
      ['ship "a\\q', 'a\\query', ['a\\q']],
      ['ship ', '$(printf CANARY)', ['']],
      ['ship "', '$(printf CANARY)', ['']],
      ["ship '", "a'b $(printf CANARY)", ['']],
      ['ship "', '!!', ['']],
      ['ship ', '`printf CANARY`; $HOME * ? [x] # ~ & | < >', ['']],
      ['ship ', 'é東京 space', ['']],
      ['ship é --r', '--region', ['é', '--r']],
      [`${programPath} --r`, '--region', ['--r']],
      ['echo ignored; ship --r', '--region', ['--r']],
      ['echo ignored | ship --r', '--region', ['--r']],
      ['CLIVOKE_TEST=x ship --r', '--region', ['--r']],
      ['ship "a b" --region=eu', '--region=eu west', ['a b', '--region=eu']],
      ['ship --region="eu"', '--region=eu west', ['--region=eu']],
      ['ship --url=http://ab', '--url=http://abc:de', ['--url=http://ab']],
      ['ship --region=eu tail', '--region=eu west', ['--region=eu'], 5],
      ['ship --region=euZZ tail', '--region=eu westZZ', ['--region=eu'], 7]
    ].map(([line, candidate, words, left]) => ({
      line,
      candidate,
      left,
      request: ['lines', String(words.length), 'ship', ...words,
        ...(shell === 'zsh' && left ? ['tail'] : [])],
      accepted: [...words.slice(0, -1), candidate + (shell === 'bash' && left === 7 ? 'ZZ' : ''),
        ...(left ? ['tail'] : [])]
    }));
    const { stdout } = await execFileAsync('python3', ['-c', ptyDriver, JSON.stringify({
      command: executable(shell),
      args: shell === 'bash' ? [executable(shell), '--noprofile', '--norc', '-i'] : [executable(shell), '-f'],
      shell,
      workspace,
      setup,
      cases
    })], { timeout: 60_000 });
    assert.equal(JSON.parse(stdout).cases, cases.length);
  });
}

test('Bash ignores COMP_WORDS wordbreaks and reads only the logical cursor prefix', async (context) => {
  if (!(await available('bash'))) return context.skip('bash is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-bash-words-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const { executablePath, recorded } = await createRecordingExecutable(workspace);
  const script = createCompletionScript(cli, 'bash', executablePath);
  for (const { line, point, expected } of [
    { line: './ship --region=eu-west tail', point: 18, expected: ['ship', '--region=eu'] },
    { line: '/opt/bin/ship "a b" --region="eu', expected: ['ship', 'a b', '--region=eu'] },
    { line: '  ship   "" a\\ b ', expected: ['ship', '', 'a b', ''] },
    { line: 'ship é --region=eu', expected: ['ship', 'é', '--region=eu'] }
  ]) {
    await execFileAsync(executable('bash'), ['-c', `${script}
COMP_LINE=${shellLiteral(line)}
COMP_POINT=${point ?? '${#COMP_LINE}'}
COMP_WORDS=(deliberately incorrect words)
COMP_CWORD=99
${completionFunction(script)}
`]);
    assert.equal(await readFile(recorded, 'utf8'),
      `${['lines', String(expected.length - 1), ...expected].join('\n')}\n`);
  }
});

test('Fish native completion normalizes quotes and keeps candidate syntax literal', async (context) => {
  if (!(await available('fish'))) return context.skip('fish is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-fish-engine-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const { executablePath, recorded } = await createRecordingExecutable(workspace);
  const script = createCompletionScript(cli, 'fish', executablePath);
  for (const [line, expected] of [
    ['ship --region="eu', ['ship', '--region=eu']],
    ['ship "a b" --r', ['ship', 'a b', '--r']],
    ['ship a\\ b', ['ship', 'a b']],
    ['./ship --r', ['ship', '--r']],
    ['ship --region ', ['ship', '--region', '']]
  ]) {
    await execFileAsync(executable('fish'), ['--no-config', '-c', `${script}\ncomplete -C ${fishLiteral(line)}`]);
    assert.equal(await readFile(recorded, 'utf8'), `lines\n${expected.length - 1}\n${expected.join('\n')}\n`);
  }
  const candidate = '$(printf CANARY); (printf CANARY) "quote" \\ é';
  await writeFile(executablePath, `#!/usr/bin/env bash\nprintf '%s\\n' ${shellLiteral(candidate)}\n`);
  const { stdout } = await execFileAsync(executable('fish'), ['--no-config', '-c', `${script}
set -l values (complete --escape -C 'ship ')
for value in $values
  string unescape -- "$value"
end
`]);
  assert.equal(stdout, `${candidate}\n`);
});

test('PowerShell native completion preserves quoted words, cursor prefixes and literal values', async (context) => {
  if (!(await available('pwsh'))) return context.skip('pwsh is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-pwsh-engine-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const recorded = join(workspace, 'request.json');
  const candidateFile = join(workspace, 'candidate.txt');
  const companion = join(workspace, 'companion.ps1');
  await writeFile(companion, `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$rest)
[IO.File]::WriteAllText('${powerShellLiteral(recorded)}', (ConvertTo-Json -InputObject $rest -Compress))
[IO.File]::ReadAllText('${powerShellLiteral(candidateFile)}')
`);
  const script = createCompletionScript(cli, 'pwsh', companion);
  for (const [line, candidate, expected, left = 0] of [
    ['ship --region=eu', '--region=eu west', ['ship', '--region=eu']],
    ['ship --region="eu', '--region=eu west', ['ship', '--region=eu']],
    ['ship "a b" --r', '--region', ['ship', 'a b', '--r']],
    ["ship 'a''b' --r", '--region', ['ship', "a'b", '--r']],
    ['ship "a""b" --r', '--region', ['ship', 'a"b', '--r']],
    ['ship "a`Nb" --r', '--region', ['ship', 'aNb', '--r']],
    ['ship --region=euZZ tail', '--region=eu west', ['ship', '--region=eu'], 7],
    ['ship --region ', 'literal', ['ship', '--region', '']],
    ['ship "', "a'b $(Write-Output CANARY); `n | & é", ['ship', '']]
  ]) {
    await writeFile(candidateFile, candidate);
    const { stdout } = await execFileAsync(executable('pwsh'), ['-NoProfile', '-NonInteractive', '-Command', `${script}
$result = TabExpansion2 '${powerShellLiteral(line)}' ${line.length - left}
$match = $result.CompletionMatches[0]
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($match.CompletionText, [ref]$tokens, [ref]$errors)
$expression = $ast.EndBlock.Statements[0].PipelineElements[0].Expression
@{ Text = $match.CompletionText; Literal = $expression.Value; Type = $expression.GetType().Name; Errors = $errors.Count } | ConvertTo-Json -Compress
`]);
    assert.deepEqual(JSON.parse(await readFile(recorded, 'utf8')), ['lines', String(expected.length - 1), ...expected]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.Literal, candidate);
    assert.equal(parsed.Type, 'StringConstantExpressionAst');
    assert.equal(parsed.Errors, 0);
  }
});

function shellLiteral(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishLiteral(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function completionFunction(script) {
  return /^(?:function )?(_[A-Za-z0-9_]+)/u.exec(script)?.[1];
}

// Python uses only its standard library; no PTY package is a runtime dependency.
const ptyDriver = String.raw`import json, os, pathlib, pty, select, signal, sys, time
config=json.loads(sys.argv[1]); shell=config['shell']; workspace=pathlib.Path(config['workspace'])
pid,fd=pty.fork()
if pid==0:
 os.environ['TERM']='xterm'
 os.execvp(config['command'],config['args'])
def send(s): os.write(fd,s.encode())
def until(marker):
 data=b'';end=time.monotonic()+10
 while marker not in data:
  if time.monotonic()>end: raise RuntimeError('terminal timed out: '+repr(data[-3000:]))
  ready,_,_=select.select([fd],[],[],.1)
  if ready:
   try:data+=os.read(fd,65536)
   except OSError:raise RuntimeError('terminal closed: '+repr(data[-3000:]))
 return data
try:
 send(config['setup']+'\n');until(b'CLIVOKE_READY> ')
 for case in config['cases']:
  (workspace/'candidates.txt').write_text(case['candidate']+'\n')
  (workspace/'accepted.txt').unlink(missing_ok=True)
  send(case['line'])
  if case.get('left'):send('\x1b[D'*case['left'])
  send('\t')
  # A user may accept a completion and then move to the end before Enter.
  send('\x05\n');until(b'CLIVOKE_READY> ')
  received=(workspace/'request.bin').read_bytes().decode().split('\0')[:-1]
  accepted=(workspace/'accepted.txt').read_bytes().decode().split('\0')[:-1]
  if received != case['request']:raise AssertionError((shell,case,received))
  if accepted != case['accepted']:raise AssertionError((shell,case,accepted))
 print(json.dumps({'cases':len(config['cases'])}))
finally:
 os.kill(pid,signal.SIGKILL)
 os.waitpid(pid,0)
 os.close(fd)
`;

test('generated helpers cannot collide after punctuation is encoded', () => {
  for (const shell of ['bash', 'zsh', 'fish']) {
    const hyphen = createCompletionScript(createCli({ name: 'foo-bar' }), shell);
    const underscore = createCompletionScript(createCli({ name: 'foo_bar' }), shell);
    assert.notEqual(completionFunction(hyphen), completionFunction(underscore));
    assert.doesNotMatch(hyphen, /\beval\b/u);
  }
});

test('Bash declines nonliteral shell syntax without executing or guessing it', async (context) => {
  if (!(await available('bash'))) return context.skip('bash is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-bash-nonliteral-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const { executablePath, recorded } = await createRecordingExecutable(workspace);
  const script = createCompletionScript(cli, 'bash', executablePath);
  for (const line of [
    'ship > /tmp/clivoke-unused --r',
    'ship 2>/tmp/clivoke-unused --r',
    'ship $HOME --r',
    'ship "$(printf CANARY)" --r',
    'ship `printf CANARY` --r',
    'ship *.txt --r'
  ]) {
    const { stdout } = await execFileAsync(executable('bash'), ['-c', `${script}
COMP_LINE=${shellLiteral(line)}
COMP_POINT=\${#COMP_LINE}
COMPREPLY=(stale)
${completionFunction(script)}
printf '%s' "\${#COMPREPLY[@]}"
`]);
    assert.equal(stdout, '0');
    await assert.rejects(readFile(recorded), { code: 'ENOENT' });
  }
});
