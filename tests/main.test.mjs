import assert from 'node:assert/strict';
import test from 'node:test';
import { createCli, runCliCompletion, runCliMain, value } from '../dist/index.js';

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
  assert.match(writes[0][1], /No handler is registered for command ship status/u);
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
    argv: ['3', 'ship', 'deploy', '--region', 'e'],
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
    argv: ['wrong', 'ship'],
    writeStdout(text) { writes.push(['out', text]); },
    writeStderr(text) { writes.push(['err', text]); },
    setExitCode(exitCode) { writes.push(['exit', exitCode]); }
  };
  assert.equal(await runCliCompletion({ cli, host }), 2);
  assert.match(writes[0][1], /cursor/u);
});
