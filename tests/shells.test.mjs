import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  return value.replaceAll(/['\u2018-\u201b]/gu, '$&$&');
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
    const insecureFunctions = join(workspace, 'untrusted-functions');
    if (shell === 'zsh') {
      // Empty disposable directory: compinit must skip it, never trust it or prompt.
      await mkdir(insecureFunctions);
      await chmod(insecureFunctions, 0o777);
    }
    const common = `ship(){ printf '%s\\0' "$@" > ${shellLiteral(join(workspace, 'accepted.txt'))}; }; source ${shellLiteral(script)}`;
    // The driver uses Emacs cursor keys; EDITOR/VISUAL may otherwise select vi.
    const setup = shell === 'bash'
      ? `PS1='CLIVOKE_''READY> '; PS2='INCOMPLETE> '; set -o emacs; bind 'set enable-bracketed-paste off'; ${common}`
      : `PROMPT='CLIVOKE_''READY> '; PROMPT2='INCOMPLETE> '; untrusted_fpath=${shellLiteral(insecureFunctions)}; fpath=("$untrusted_fpath" $fpath); autoload -Uz compinit; compinit -D -i; [[ \${fpath[(Ie)$untrusted_fpath]} == 0 ]] || exit 1; bindkey -e; setopt COMPLETE_IN_WORD; ${common}`;
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
  const candidate = '$(printf CANARY); (printf CANARY) "quote" \\ \'‘’‚‛“”„ * é';
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
    ['ship ‘a b’ --r', '--region', ['ship', 'a b', '--r']],
    ['ship ‚a‛‛b‚ --r', '--region', ['ship', 'a‛b', '--r']],
    ['ship “a””b„ --r', '--region', ['ship', 'a”b', '--r']],
    ['ship "a`u{1F600}b" --r', '--region', ['ship', 'a😀b', '--r']],
    ['ship 01 0x10 -01 1.00 --r', '--region', ['ship', '01', '0x10', '-01', '1.00', '--r']],
    ['ship -v --r', '--region', ['ship', '-v', '--r']],
    ['ship --region=euZZ tail', '--region=eu west', ['ship', '--region=eu'], 7],
    ['ship --region ', 'literal', ['ship', '--region', '']],
    ['ship "', "a'b $(Write-Output CANARY); `n | & é", ['ship', '']],
    ...[0x2018, 0x2019, 0x201a, 0x201b].map((codePoint) => [
      'ship ', `OOPS${String.fromCodePoint(codePoint)};Write-Output CANARY;#`, ['ship', '']
    ]),
    ['ship ', "'‘’‚‛“”„`;$()\\é", ['ship', '']]
  ]) {
    await writeFile(candidateFile, candidate);
    const { stdout } = await execFileAsync(executable('pwsh'), ['-NoProfile', '-NonInteractive', '-Command', `${script}
$result = TabExpansion2 '${powerShellLiteral(line)}' ${line.length - left}
$match = $result.CompletionMatches[0]
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($match.CompletionText, [ref]$tokens, [ref]$errors)
$expression = $ast.EndBlock.Statements[0].PipelineElements[0].Expression
@{ Text = $match.CompletionText; Literal = $expression.Value; Type = $expression.GetType().Name; Errors = $errors.Count; Statements = $ast.EndBlock.Statements.Count } | ConvertTo-Json -Compress
`]);
    assert.deepEqual(JSON.parse(await readFile(recorded, 'utf8')), ['lines', String(expected.length - 1), ...expected]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.Literal, candidate);
    assert.equal(parsed.Type, 'StringConstantExpressionAst');
    assert.equal(parsed.Errors, 0);
    assert.equal(parsed.Statements, 1);
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

test('PowerShell program and executable literals preserve every quote delimiter', async (context) => {
  if (!(await available('pwsh'))) return context.skip('pwsh is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-pwsh-literals-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const name = "ship'‘’‚‛;$global:clivoke_canary=1;#";
  const companion = join(workspace, "complete'‘’‚‛;Write-Output CANARY;#`$().ps1");
  const recorded = join(workspace, 'request.json');
  await writeFile(companion, `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$rest)
[IO.File]::WriteAllText('${powerShellLiteral(recorded)}', (ConvertTo-Json -InputObject $rest -Compress))
'LITERAL_CANDIDATE'
`);
  const script = createCompletionScript(createCli({ name }), 'pwsh', companion);
  const { stdout, stderr } = await execFileAsync(executable('pwsh'), ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
$global:clivoke_canary = 0
function Register-ArgumentCompleter {
  param([switch]$Native, [string]$CommandName, [scriptblock]$ScriptBlock)
  $script:registeredName = $CommandName
  $script:registeredCompleter = $ScriptBlock
}
${script}
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput('ship ', [ref]$tokens, [ref]$errors)
$match = & $script:registeredCompleter '' $ast.EndBlock.Statements[0].PipelineElements[0] 5
@{ Name = $script:registeredName; Canary = $global:clivoke_canary; Matches = @($match.CompletionText) } | ConvertTo-Json -Compress
`]);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { Name: name, Canary: 0, Matches: ["'LITERAL_CANDIDATE'"] });
  assert.deepEqual(JSON.parse(await readFile(recorded, 'utf8')), ['lines', '1', name, '']);
});

test('Fish program and executable literals preserve quotes, slashes and shell syntax', async (context) => {
  if (!(await available('fish'))) return context.skip('fish is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-fish-literals-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const name = "ship'\\;echo(CANARY);#‘’‚‛“”„";
  const companion = join(workspace, "complete'\\;printf CANARY;#‘’‚‛“”„");
  const recorded = join(workspace, 'request.bin');
  await writeFile(companion, `#!/usr/bin/env bash
printf '%s\\0' "$@" > ${shellLiteral(recorded)}
printf 'LITERAL_CANDIDATE\\n'
`);
  await chmod(companion, 0o755);
  const script = createCompletionScript(createCli({ name }), 'fish', companion);
  const { stdout, stderr } = await execFileAsync(executable('fish'), ['--no-config', '-c', `
function commandline
  if test "$argv[1]" = -opc
    printf 'ship\\n'
  end
end
${script}
${completionFunction(script)}
`]);
  assert.equal(stderr, '');
  assert.equal(stdout, 'LITERAL_CANDIDATE\n');
  assert.deepEqual((await readFile(recorded, 'utf8')).split('\0'), ['lines', '1', name, '', '']);
});

test('PowerShell mixed doubled quote pairs match its native lexer', async (context) => {
  if (!(await available('pwsh'))) return context.skip('pwsh is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-pwsh-quote-pairs-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const recorded = join(workspace, 'request.json');
  const companion = join(workspace, 'companion.ps1');
  await writeFile(companion, `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$rest)
[IO.File]::WriteAllText('${powerShellLiteral(recorded)}', (ConvertTo-Json -InputObject $rest -Compress))
'--region'
`);
  const script = createCompletionScript(cli, 'pwsh', companion);
  const { stdout, stderr } = await execFileAsync(executable('pwsh'), ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
${script}
$count = 0; $mixed = 0
$tables = @(@{ Quotes = [char[]](39, 8216, 8217, 8218, 8219) }, @{ Quotes = [char[]](34, 8220, 8221, 8222) })
foreach ($table in $tables) {
  foreach ($first in $table.Quotes) {
    foreach ($second in $table.Quotes) {
      $word = [string]$table.Quotes[0] + 'a' + $first + $second + 'b' + $table.Quotes[0]
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseInput($word, [ref]$tokens, [ref]$errors)
      $native = $ast.EndBlock.Statements[0].PipelineElements[0].Expression.Value
      if ($errors.Count -ne 0 -or $native -cne ('a' + $second + 'b')) { throw 'Unexpected native quote semantics' }
      $line = 'ship ' + $word + ' --r'
      $result = TabExpansion2 $line $line.Length
      $request = [IO.File]::ReadAllText('${powerShellLiteral(recorded)}') | ConvertFrom-Json
      if ($result.CompletionMatches.Count -ne 1 -or $request.Count -ne 5 -or $request[3] -cne $native) {
        throw ('Quote pair mismatch: {0:X4}, {1:X4}' -f [int]$first, [int]$second)
      }
      $count++
      if ($first -cne $second) { $mixed++ }
    }
  }
}
$line = 'ship "a' + [char]8223 + 'b" --r'
$null = TabExpansion2 $line $line.Length
$request = [IO.File]::ReadAllText('${powerShellLiteral(recorded)}') | ConvertFrom-Json
@{ Count = $count; Mixed = $mixed; Ordinary = $request[3] } | ConvertTo-Json -Compress
`]);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { Count: 41, Mixed: 32, Ordinary: 'a\u201fb' });
});

test('PowerShell native argument parsing owns the full literal prefix and declines expressions', async (context) => {
  if (!(await available('pwsh'))) return context.skip('pwsh is unavailable');
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-pwsh-native-boundary-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const recorded = join(workspace, 'request.json');
  const companion = join(workspace, 'companion.ps1');
  const casesFile = join(workspace, 'cases.json');
  const allowed = [
    ['', ''], ['""', ''], ["'unterminated", 'unterminated'],
    ['"a`u{1F600}b"', 'a😀b'], ['--region="eu', '--region=eu'],
    ['a` b', 'a b'], ['foo`;bar', 'foo;bar'], ['foo<#comment#>', 'foo<#comment#>'], ['"a`$HOME"', 'a$HOME'],
    ["'literal $(Write-Output CANARY)'", 'literal $(Write-Output CANARY)'],
    ['-v', '-v'], ['--', '--'], ['–v', '–v'],
    ['-r:"x y"', '-r:x y'], ['–r:"x y"', '–r:x y'], ['-r:01', '-r:01'],
    ...['42', '01', '0x10', '1e2', '-01', '1.00'].map((value) => [value, value])
  ];
  const rejected = [
    '$HOME', '"$HOME"', 'foo$HOME', '$(Write-Output CANARY)', '@values',
    '@(1,2)', '(1+2)', '1,2', 'foo;Write-Output CANARY', 'foo|Write-Output CANARY',
    'foo && Write-Output CANARY', 'foo > clivoke-unused', '2>clivoke-unused',
    'foo #comment', 'foo <#comment#>', '#comment', 'foo bar', 'foo ', ' foo',
    '-r: "x y"', '-r: 01',
    '"unterminated$HOME', '"bad`u{110000}"', '--%', 'foo\nWrite-Output CANARY',
    'foo &', 'foo; trap { Write-Output CANARY }'
  ];
  const cases = [
    ...allowed.map(([Text, Value]) => ({ Text, Value, Allowed: true })),
    ...rejected.map((Text) => ({ Text, Allowed: false }))
  ];
  await writeFile(casesFile, JSON.stringify(cases));
  await writeFile(companion, `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$rest)
[IO.File]::WriteAllText('${powerShellLiteral(recorded)}', (ConvertTo-Json -InputObject $rest -Compress))
'--region'
`);
  const script = createCompletionScript(cli, 'pwsh', companion);
  const { stdout, stderr } = await execFileAsync(executable('pwsh'), ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
function Register-ArgumentCompleter {
  param([switch]$Native, [string]$CommandName, [scriptblock]$ScriptBlock)
  $script:registeredCompleter = $ScriptBlock
}
${script}
$cases = [IO.File]::ReadAllText('${powerShellLiteral(casesFile)}') | ConvertFrom-Json
foreach ($case in $cases) {
  Remove-Item -LiteralPath '${powerShellLiteral(recorded)}' -ErrorAction SilentlyContinue
  # Supply the exact raw word span to exercise the generated callback's boundary,
  # including text that the interactive engine would usually filter out first.
  $requestAst = [pscustomobject]@{
    Redirections = @()
    CommandElements = @(
      [pscustomobject]@{ Extent = [pscustomobject]@{ Text = 'ship'; StartOffset = 0; EndOffset = 4 } },
      [pscustomobject]@{ Extent = [pscustomobject]@{ Text = $case.Text; StartOffset = 5; EndOffset = 5 + $case.Text.Length } }
    )
  }
  $matches = @(& $script:registeredCompleter '' $requestAst (5 + $case.Text.Length))
  $called = Test-Path -LiteralPath '${powerShellLiteral(recorded)}'
  if ($called -ne $case.Allowed -or $matches.Count -ne [int]$case.Allowed) {
    throw ('Unexpected native boundary decision: ' + $case.Text)
  }
  if ($called) {
    $request = [IO.File]::ReadAllText('${powerShellLiteral(recorded)}') | ConvertFrom-Json
    if ($request.Count -ne 4 -or $request[3] -cne $case.Value) { throw ('Changed literal: ' + $case.Text) }
  }
}
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput('ship x > clivoke-unused --r', [ref]$tokens, [ref]$errors)
Remove-Item -LiteralPath '${powerShellLiteral(recorded)}' -ErrorAction SilentlyContinue
$matches = @(& $script:registeredCompleter '' $ast.EndBlock.Statements[0].PipelineElements[0] 28)
if ($matches.Count -ne 0 -or (Test-Path -LiteralPath '${powerShellLiteral(recorded)}')) { throw 'Redirection was accepted' }
@{ Cases = $cases.Count; Allowed = @($cases | Where-Object Allowed).Count } | ConvertTo-Json -Compress
`]);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { Cases: cases.length, Allowed: allowed.length });
});
