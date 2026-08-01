import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CliDefinitionError,
  completeCliWords,
  createCli,
  createCliHelp,
  createCompletionScript,
  value
} from '../dist/index.js';

const cli = createCli({
  name: 'ship',
  version: '1.0.0',
  options: {
    verbose: { type: 'boolean', flags: ['-v', '--verbose'], falseFlags: ['--no-verbose'] },
    quiet: { type: 'count', flags: ['-q'] }
  },
  commands: [{
    name: 'deploy',
    aliases: ['d'],
    description: 'Deploy a service.',
    options: {
      region: { type: value.choice(['eu', 'us']), flags: ['-r', '--region'], required: true }
    },
    positionals: [{ name: 'service' }],
    acceptsAfterDoubleDash: true
  }]
});

test('createCli composes command routing with strict argv parsing', () => {
  const result = cli.parse({
    argv: ['-vq', 'd', '--region=eu', 'api', '--', '--watch']
  });
  assert.equal(result.status, 'parsed');
  assert.equal(result.command.key, 'ship deploy');
  assert.deepEqual(result.optionValues, { verbose: true, quiet: 1, region: 'eu' });
  assert.deepEqual(result.positionalValues, { service: 'api' });
  assert.deepEqual(result.afterDoubleDash, ['--watch']);
});

test('invalid explicit values do not expose values or defaults', () => {
  const result = cli.parse({ argv: ['deploy', '--region=other', 'api'] });
  assert.equal(result.status, 'invalid');
  assert.equal('optionValues' in result, false);
  assert.equal(result.diagnostics[0].code, 'INVALID_OPTION_VALUE');
  assert.equal(result.diagnostics[0].details.argvIndex, 1);
});

test('unknown flags retain complete invocation indexes', () => {
  const result = cli.parse({
    argv: ['deploy', '--wat', '--region', 'eu', 'api'],
    unknownFlagPolicy: 'collect'
  });
  assert.equal(result.status, 'parsed');
  assert.deepEqual(result.unknownFlags, [{ argvElement: '--wat', flag: '--wat', argvIndex: 1 }]);
});

test('help and shell completion are derived from the same definition', () => {
  assert.deepEqual(createCliHelp(cli, ['deploy']).options.map((option) => option.name), [
    'verbose',
    'quiet',
    'region'
  ]);
  assert.deepEqual(
    completeCliWords(cli, { words: ['ship', '__complete', 'deploy', '--r'] }),
    [{ kind: 'flag', value: '--region', option: 'region' }]
  );
  assert.deepEqual(
    completeCliWords(cli, { words: ['ship', '__complete', '-v', 'deploy', '--r'] }),
    [{ kind: 'flag', value: '--region', option: 'region' }]
  );
  assert.match(createCompletionScript(cli, 'bash'), /__complete/u);
  assert.match(createCompletionScript(cli, 'fish'), /commandline/u);
  assert.match(createCompletionScript(cli, 'zsh'), /compdef/u);
  assert.match(createCompletionScript(cli, 'pwsh'), /Register-ArgumentCompleter/u);
});

test('facade and argv definition objects reject unknown properties at runtime', () => {
  assert.throws(
    () => createCli({ name: 'ship', typo: true }),
    (error) => error instanceof CliDefinitionError
      && error.issues.some((issue) => issue.code === 'UNKNOWN_PROPERTY')
  );
  assert.throws(() => createCli({
    name: 'ship',
    options: { verbose: { type: 'boolean', flags: ['-v'], typo: true } }
  }));
});
