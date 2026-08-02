import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCli,
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

  const controlled = formatCliDiagnostics([{
    source: 'command',
    code: 'TEST_WARNING',
    severity: 'warning',
    message: `line${String.fromCodePoint(10)}escape${String.fromCodePoint(27)}`,
    commandPath: [`bell${String.fromCodePoint(7)}`]
  }]);
  assert.equal(controlled.includes(String.fromCodePoint(10)), false);
  assert.equal(controlled.includes(String.fromCodePoint(27)), false);
  assert.equal(controlled.includes(String.fromCodePoint(7)), false);
  assert.match(controlled, /\\u\{000a\}/u);
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
  assert.deepEqual(JSON.parse(writes.stdout), {
    kind: 'positional-value',
    value: 'line\nbreak',
    positional: 'target'
  });
});
