import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCli,
  createProcessCliHost,
  createDenoCliHost,
  formatCliDiagnostics,
  runCliCompletion,
  runCliMain,
  value
} from '../dist/index.js';

const cli = createCli({
  name: 'ship',
  commands: [{ name: 'status' }]
});

test('runCliMain applies handler output through an explicit host', async () => {
  const writes = { stdout: '', stderr: '', exitCode: undefined };
  const host = {
    argv: ['status'],
    writeStdout(text) { writes.stdout += text; },
    writeStderr(text) { writes.stderr += text; },
    setExitCode(exitCode) { writes.exitCode = exitCode; }
  };
  const exitCode = await runCliMain({
    cli,
    host,
    handlers: { 'ship status': () => ({ stdout: 'ready' }) },
    context: undefined
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(writes, { stdout: 'ready\n', stderr: '', exitCode: 0 });
});

test('runCliMain renders built-in help and version actions', async () => {
  const releaseCli = createCli({
    name: 'ship',
    version: '1.2.3',
    invokable: false,
    commands: [{ name: 'status' }]
  });
  for (const [argv, expected] of [
    [[], /^Usage: ship \[options\] <command>/u],
    [['--help'], /^Usage: ship \[options\] <command>/u],
    [['help', 'status'], /^Usage: ship status \[options\]/u],
    [['status', '--help'], /^Usage: ship status \[options\]/u],
    [['--version'], /^ship 1\.2\.3\n$/u]
  ]) {
    const writes = { stdout: '', stderr: '', exitCode: undefined };
    const host = {
      argv,
      writeStdout(text) { writes.stdout += text; },
      writeStderr(text) { writes.stderr += text; },
      setExitCode(exitCode) { writes.exitCode = exitCode; }
    };
    assert.equal(await runCliMain({
      cli: releaseCli,
      host,
      handlers: { 'ship status': () => undefined },
      context: undefined
    }), 0);
    assert.match(writes.stdout, expected);
    assert.equal(writes.stderr, '');
    assert.equal(writes.exitCode, 0);
  }
});

test('runCliMain reports parse and handler failures without terminating the process', async () => {
  const writes = [];
  const host = {
    argv: ['unknown'],
    writeStdout(text) { writes.push(['out', text]); },
    writeStderr(text) { writes.push(['err', text]); },
    setExitCode(exitCode) { writes.push(['exit', exitCode]); }
  };
  assert.equal(await runCliMain({ cli, host, handlers: {}, context: undefined }), 2);
  assert.match(writes[0][1], /CLI_UNKNOWN_COMMAND/u);
});

test('runCliMain reports a missing core dispatch handler', async () => {
  const writes = [];
  const host = {
    argv: ['status'],
    writeStdout(text) { writes.push(['out', text]); },
    writeStderr(text) { writes.push(['err', text]); },
    setExitCode(exitCode) { writes.push(['exit', exitCode]); }
  };

  assert.equal(await runCliMain({ cli, host, handlers: {}, context: undefined }), 1);
  assert.match(writes[0][1], /No handler is registered for the selected command/u);
});

test('runCliCompletion uses an explicit cursor and emits grammar-aware values', async () => {
  const completionCli = createCli({
    name: 'ship',
    commands: [{
      name: 'deploy',
      options: {
        region: { type: value.choice(['eu', 'us']), flags: ['--region'] }
      }
    }]
  });
  const writes = { stdout: '', stderr: '', exitCode: undefined };
  const host = {
    argv: ['lines', '3', 'ship', 'deploy', '--region', 'e'],
    writeStdout(text) { writes.stdout += text; },
    writeStderr(text) { writes.stderr += text; },
    setExitCode(exitCode) { writes.exitCode = exitCode; }
  };
  assert.equal(await runCliCompletion({ cli: completionCli, host }), 0);
  assert.deepEqual(writes, { stdout: 'eu\n', stderr: '', exitCode: 0 });
});

test('runCliCompletion rejects malformed protocol input', async () => {
  const writes = [];
  const host = {
    argv: ['lines', 'wrong', 'ship'],
    writeStdout(text) { writes.push(['out', text]); },
    writeStderr(text) { writes.push(['err', text]); },
    setExitCode(exitCode) { writes.push(['exit', exitCode]); }
  };
  assert.equal(await runCliCompletion({ cli, host }), 2);
  assert.match(writes[0][1], /cursor/u);
});

test('the default formatter redacts values and sanitizes terminal controls', () => {
  const secret = 'token-123';
  const sensitiveCli = createCli({
    name: 'login',
    options: {
      token: {
        type: value.custom({
          parse(raw) {
            return { success: false, message: `Rejected ${raw}\u001b[31m` };
          },
          accepts(candidate) {
            return typeof candidate === 'string';
          }
        }),
        flags: ['--token'],
        sensitive: true
      }
    }
  });
  const result = sensitiveCli.parse({ argv: ['--token', secret] });
  assert.equal(result.status, 'invalid');
  const formatted = formatCliDiagnostics(result.diagnostics);
  assert.doesNotMatch(formatted, /token-123/u);
  assert.equal(formatted.includes(String.fromCodePoint(27)), false);
  assert.match(formatted, /Invalid value for sensitive option/u);

  const suggestedSecret = formatCliDiagnostics([{
    source: 'option',
    code: 'INVALID_OPTION_VALUE',
    severity: 'error',
    message: 'Invalid token.',
    option: 'token',
    flag: '--token',
    argvElement: '--token=private',
    argvIndex: 0,
    rawValue: 'private',
    suggestions: ['private-corrected'],
    sensitive: true
  }]);
  assert.doesNotMatch(suggestedSecret, /private/u);

  const controlled = formatCliDiagnostics([{
    source: 'command',
    code: 'TEST_WARNING',
    severity: 'warning',
    message: `line${String.fromCodePoint(10)}escape${String.fromCodePoint(27)}bidi${String.fromCodePoint(0x202e)}`,
    commandPath: [`bell${String.fromCodePoint(7)}`]
  }]);
  assert.equal(controlled.includes(String.fromCodePoint(10)), false);
  assert.equal(controlled.includes(String.fromCodePoint(27)), false);
  assert.equal(controlled.includes(String.fromCodePoint(7)), false);
  assert.equal(controlled.includes(String.fromCodePoint(0x202e)), false);
  assert.match(controlled, /\\u\{000a\}/u);
  assert.match(controlled, /\\u\{202e\}/u);
});

test('successful invocation warnings are rendered before dispatch', async () => {
  const deprecatedCli = createCli({
    name: 'ship',
    commands: [{ name: 'old', deprecated: 'Use status.' }]
  });
  const writes = { stdout: '', stderr: '', exitCode: undefined };
  const host = {
    argv: ['old'],
    writeStdout(text) { writes.stdout += text; },
    writeStderr(text) { writes.stderr += text; },
    setExitCode(exitCode) { writes.exitCode = exitCode; }
  };
  assert.equal(await runCliMain({
    cli: deprecatedCli,
    host,
    handlers: { 'ship old': () => ({ stdout: 'done' }) },
    context: undefined
  }), 0);
  assert.match(writes.stderr, /CLI_DEPRECATED_COMMAND/u);
  assert.equal(writes.stdout, 'done\n');
});

test('unexpected handler details reach only the explicit observer', async () => {
  const writes = { stderr: '', exitCode: undefined };
  let failure;
  const host = {
    argv: ['status'],
    writeStdout() {},
    writeStderr(text) { writes.stderr += text; },
    setExitCode(exitCode) { writes.exitCode = exitCode; }
  };
  assert.equal(await runCliMain({
    cli,
    host,
    handlers: {
      'ship status': () => {
        throw new Error('private upstream response');
      }
    },
    context: undefined,
    observeFailure(observed) {
      failure = observed;
    }
  }), 1);
  assert.equal(failure.kind, 'unexpected');
  assert.match(failure.error.message, /private upstream response/u);
  assert.equal(writes.stderr, 'Command failed.\n');
});

test('completion JSON lines preserve candidate metadata and embedded newlines', async () => {
  const completionCli = createCli({
    name: 'ship',
    positionals: [{ name: 'target', required: false }]
  });
  const writes = { stdout: '', stderr: '', exitCode: undefined };
  const host = {
    argv: ['jsonl', '1', 'ship', ''],
    writeStdout(text) { writes.stdout += text; },
    writeStderr(text) { writes.stderr += text; },
    setExitCode(exitCode) { writes.exitCode = exitCode; }
  };
  assert.equal(await runCliCompletion({
    cli: completionCli,
    host,
    async provideValues() {
      return ['line\nbreak'];
    }
  }), 0);
  const candidates = writes.stdout.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(candidates.find((candidate) => candidate.kind === 'positional-value'), {
    kind: 'positional-value',
    value: 'line\nbreak',
    positional: 'target'
  });
});


test('Deno hosts write every byte and reject stalled or invalid writers', async () => {
  const chunks = [];
  const host = createDenoCliHost({ args: [], exitCode: 0,
    stdout: { async write(bytes) { const part = bytes.slice(0, 2); chunks.push(part); return part.length; } },
    stderr: { async write(bytes) { return bytes.length; } }
  });
  await host.writeStdout('héllo');
  assert.equal(Buffer.concat(chunks).toString(), 'héllo');
  for (const count of [0, -1, NaN, 1.5, 99]) {
    const bad = createDenoCliHost({ args: [], exitCode: 0,
      stdout: { async write() { return count; } }, stderr: { async write() { return count; } }
    });
    await assert.rejects(bad.writeStdout('abc'), /progress/u);
  }
});

test('Node host awaits buffered completion and catches asynchronous stream failure', async () => {
  const { Writable } = await import('node:stream');
  let finish;
  const stdout = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { finish = callback; } });
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const processLike = { argv: ['node', 'app'], stdout, stderr };
  const host = createProcessCliHost(processLike);
  let settled = false;
  const writing = host.writeStdout('buffered').then(() => { settled = true; return undefined; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  finish();
  await writing;
  assert.equal(settled, true);
  const failure = new Error('broken output');
  const broken = new Writable({ write(_chunk, _encoding, callback) { setImmediate(() => callback(failure)); } });
  await assert.rejects(createProcessCliHost({ ...processLike, stdout: broken }).writeStdout('x'), (e) => e === failure);
});

test('output failures are distinct, observed once, and never retry a handler', async () => {
  const outputError = new Error('output failed');
  let calls = 0;
  const failures = [];
  const host = { argv: [], async writeStdout() { throw outputError; }, writeStderr() { throw Error('must not report to broken host'); }, setExitCode() {} };
  await assert.rejects(runCliMain({ cli: createCli({ name: 'app' }), host, context: undefined,
    handlers: { app() { calls++; return { stdout: 'done' }; } },
    observeFailure(failure) { failures.push(failure); throw Error('telemetry failed'); }
  }), (e) => e === outputError);
  assert.equal(calls, 1);
  assert.deepEqual(failures, [{ kind: 'output', error: outputError }]);
});

test('application renderers replace default output using the original classified request', async () => {
  const app = createCli({ name: 'app', version: '1', options: { json: { type: 'boolean', flags: ['--json'] } } });
  for (const argv of [['--json', '--help'], ['--json', '--version'], ['--json', '--bad'], ['--json']]) {
    let stdout = '', stderr = '';
    const render = (kind) => (_value, presentation) => {
      assert.equal(presentation.context, 'context');
      assert.ok(presentation.inspection.options.some((option) => option.option === 'json'));
      return { stdout: JSON.stringify({ kind }), exitCode: kind === 'failure' ? 7 : 0 };
    };
    const code = await runCliMain({ cli: app, context: 'context',
      host: { argv, writeStdout(s) { stdout += s; }, writeStderr(s) { stderr += s; }, setExitCode() {} },
      handlers: { app() { throw Error('domain'); } },
      renderHelp: render('help'), renderVersion: render('version'), renderInvalid: render('invalid'), renderFailure: render('failure')
    });
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).kind, argv[1]?.slice(2) === 'bad' ? 'invalid' : argv[1]?.slice(2) ?? 'failure');
    assert.equal(code, argv.length === 1 ? 7 : 0);
  }
});

test('a reporting failure retains the original handler error', async () => {
  const original = new Error('domain failure');
  const reporting = new Error('reporting failed');
  await assert.rejects(runCliMain({ cli: createCli({ name: 'app' }), context: undefined,
    host: { argv: [], writeStdout() {}, writeStderr() { throw reporting; }, setExitCode() {} },
    handlers: { app() { throw original; } }
  }), (error) => error instanceof AggregateError && error.cause === reporting && error.errors[0] === original && error.errors[1] === reporting);
});

test('library version output escapes controls while handler output remains untouched', async () => {
  let stdout = '';
  const host = { argv: ['--version'], writeStdout(s) { stdout += s; }, writeStderr() {}, setExitCode() {} };
  await runCliMain({ cli: createCli({ name: 'app', version: '1\u001b[2J' }), host, handlers: {}, context: undefined });
  assert.equal(stdout.includes('\u001b'), false);
  assert.match(stdout, /\\u\{001b\}/u);
});

test('every automatic outcome and warning uses the same output-failure settlement', async () => {
  const app = createCli({ name: 'app', version: '1', commands: [{ name: 'old', deprecated: true }] });
  for (const argv of [['--help'], ['--version'], ['missing'], ['old']]) {
    const original = new Error('delivery');
    const observed = [];
    let calls = 0, exitCode;
    await assert.rejects(runCliMain({ cli: app, context: undefined,
      host: { argv, async writeStdout() { throw original; }, async writeStderr() { throw original; }, setExitCode(code) { exitCode = code; } },
      handlers: { app() { calls++; }, 'app old'() { calls++; } },
      observeFailure(failure) { observed.push(failure); }
    }), (error) => error === original);
    assert.deepEqual(observed, [{ kind: 'output', error: original }]);
    assert.equal(exitCode, 1);
    assert.equal(calls, 0);
  }
});

test('warning renderers cannot silently supply an exit code', async () => {
  let called = false;
  await assert.rejects(runCliMain({
    cli: createCli({ name: 'app', commands: [{ name: 'old', deprecated: true }] }), context: undefined,
    host: { argv: ['old'], writeStdout() {}, writeStderr() {}, setExitCode() {} },
    handlers: { 'app old'() { called = true; } },
    renderWarnings() { return { stderr: 'warning', exitCode: 7 }; }
  }), /only produce stdout and stderr/u);
  assert.equal(called, false);
});


test('host writes retain their receiver', async () => {
  const host = { argv: [], output: '', exitCode: undefined,
    writeStdout(text) { this.output += text; }, writeStderr(text) { this.output += text; },
    setExitCode(code) { this.exitCode = code; }
  };
  await runCliMain({ cli: createCli({ name: 'app' }), host, context: undefined,
    handlers: { app() { return { stdout: 'hello', stderr: 'warning' }; } }
  });
  assert.equal(host.output, 'hello\nwarning\n');
  assert.equal(host.exitCode, 0);
});


test('line completion omits terminal format controls while JSONL remains lossless', async () => {
  const app = createCli({ name: 'app', positionals: [{ name: 'target', required: false }] });
  const candidates = ['safe', 'bidi\u202econtrol', 'unicode\u2028line'];
  let stdout = '';
  const host = { argv: ['lines', '1', 'app', ''], writeStdout(text) { stdout += text; }, writeStderr() {}, setExitCode() {} };
  await runCliCompletion({ cli: app, host, provideValues() { return candidates; } });
  assert.match(stdout, /safe/u);
  assert.doesNotMatch(stdout, /bidi|unicode/u);
  stdout = '';
  await runCliCompletion({ cli: app, host, argv: ['jsonl', '1', 'app', ''], provideValues() { return candidates; } });
  assert.deepEqual(stdout.trimEnd().split('\n').map((line) => JSON.parse(line)).filter((candidate) => candidate.kind === 'positional-value').map((candidate) => candidate.value), candidates);
});

test('leading help never dispatches a domain handler with passthrough', async () => {
  const cli = createCli({ name: 'app', commands: [{ name: 'deploy', acceptsPassthroughArguments: true }] });
  let calls = 0;
  const writes = { stdout: '', stderr: '', exitCode: undefined };
  const host = {
    argv: ['help', 'deploy', '--', '--force'],
    writeStdout(text) { writes.stdout += text; },
    writeStderr(text) { writes.stderr += text; },
    setExitCode(code) { writes.exitCode = code; }
  };
  await runCliMain({ cli, host, handlers: { 'app deploy': () => { calls += 1; } }, context: undefined });
  assert.equal(calls, 0);
  assert.match(writes.stdout, /^Usage: app deploy/u);
});
