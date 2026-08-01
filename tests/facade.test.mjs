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
  options: {
    verbose: {
      type: 'boolean',
      flags: ['-v', '--verbose'],
      falseFlags: ['--no-verbose'],
      default: false
    },
    quiet: { type: 'count', flags: ['-q'] }
  },
  commands: [{
    name: 'project',
    options: {
      config: { type: 'string', flags: ['--config'] }
    },
    commands: [{
      name: 'deploy',
      aliases: [{ name: 'd', deprecated: 'Use deploy.' }],
      deprecated: 'Use release.',
      description: 'Deploy a service.',
      options: {
        region: {
          type: value.choice(['eu', 'us']),
          flags: ['-r', '--region'],
          required: true
        }
      },
      positionals: [{ name: 'service' }],
      acceptsAfterDoubleDash: true
    }]
  }]
});

test('one grammar implementation routes and binds every supported value form', () => {
  for (const argv of [
    ['-vq', 'project', 'd', '--region=eu', 'api', '--', '--watch'],
    ['project', '--config', 'file', 'deploy', '-r', 'eu', 'api'],
    ['project', 'deploy', '-reu', 'api'],
    ['--no-verbose', 'project', 'deploy', '--region', 'eu', 'api']
  ]) {
    const result = cli.parse({ argv });
    assert.equal(result.status, 'parsed', JSON.stringify(result));
    assert.equal(result.command.key, 'ship project deploy');
    assert.equal(result.optionValues.region, 'eu');
    assert.equal(result.positionalValues.service, 'api');
  }
});

test('failed option parsing retains unknown flags and all useful details', () => {
  const result = cli.parse({
    argv: ['project', 'deploy', '--wat', '--region=other', 'api']
  });
  assert.equal(result.status, 'invalid');
  assert.equal('optionValues' in result, false);
  assert.deepEqual(result.unknownFlags, [{
    argvElement: '--wat',
    flag: '--wat',
    argvIndex: 2
  }]);
  const valueIssue = result.diagnostics.find((diagnostic) =>
    diagnostic.code === 'INVALID_OPTION_VALUE');
  assert.equal(valueIssue?.argvIndex, 3);
  assert.equal(valueIssue?.rawValue, 'other');
});

test('unknown-flag suggestions survive the facade boundary', () => {
  const result = cli.parse({
    argv: ['project', 'deploy', '--regoin', '--region=eu', 'api'],
    unknownFlagPolicy: 'collect'
  });
  assert.equal(result.status, 'parsed');
  assert.deepEqual(result.unknownFlags[0]?.suggestions, ['--region']);
});

test('command-local flags must follow their command in every value form', () => {
  for (const argv of [
    ['--region=eu', 'project', 'deploy', 'api'],
    ['--region', 'eu', 'project', 'deploy', 'api']
  ]) {
    const result = cli.parse({ argv });
    assert.equal(result.status, 'invalid');
    assert.equal(result.diagnostics[0]?.code, 'CLI_UNKNOWN_FLAG');
  }
});

test('ancestor options remain available to nested commands', () => {
  const result = cli.parse({
    argv: ['project', 'deploy', '--config', 'file', '--region', 'eu', 'api']
  });
  assert.equal(result.status, 'parsed');
  assert.equal(result.optionValues.config, 'file');
});

test('help and completion retain defaults, choices, false flags, and value context', () => {
  const help = createCliHelp(cli, ['project', 'deploy']);
  assert.ok(help);
  const verbose = help.options.find((option) => option.name === 'verbose');
  const region = help.options.find((option) => option.name === 'region');
  assert.deepEqual(verbose?.falseFlags, ['--no-verbose']);
  assert.equal(verbose?.defaultLabel, 'false');
  assert.deepEqual(region?.valueCandidates, ['eu', 'us']);
  assert.equal(createCliHelp(cli, ['missing']), undefined);

  assert.deepEqual(
    completeCliWords(cli, {
      words: ['ship', 'project', 'deploy', '--region', 'e'],
      cursor: 4
    }),
    [{ kind: 'option-value', value: 'eu', option: 'region' }]
  );
  assert.deepEqual(
    completeCliWords(cli, {
      words: ['ship', 'project', 'deploy', '--region=u'],
      cursor: 3
    }),
    [{ kind: 'option-value', value: '--region=us', option: 'region' }]
  );
  assert.deepEqual(
    completeCliWords(cli, {
      words: ['ship', 'project', 'deploy', '--region=eu', 'a'],
      cursor: 4,
      provideValues(context) {
        return context.kind === 'positional' ? ['api', 'worker'] : [];
      }
    }).filter((candidate) => candidate.kind === 'positional-value'),
    [{ kind: 'positional-value', value: 'api', positional: 'service' }]
  );
  assert.doesNotMatch(createCompletionScript(cli, 'bash'), /__complete/u);
  assert.match(createCompletionScript(cli, 'bash'), /ship-complete/u);
});

test('special option names remain ordinary own properties', () => {
  const options = Object.fromEntries([[
    '__proto__',
    { type: 'string', flags: ['--prototype'], required: true }
  ]]);
  const special = createCli({ name: 'inspect', options });
  const result = special.parse({ argv: ['--prototype', 'safe'] });
  assert.equal(result.status, 'parsed');
  assert.equal(result.optionValues['__proto__'], 'safe');
  assert.equal(Object.getPrototypeOf(result.optionValues), null);
});

test('one definition error aggregates facade, command, and option issues', () => {
  assert.throws(
    () => createCli({
      name: 'ship',
      typo: true,
      commands: [{
        name: '--invalid',
        options: { broken: { type: 'string', flags: ['invalid'] } }
      }]
    }),
    (error) => error instanceof CliDefinitionError &&
      new Set(error.issues.map((issue) => issue.source)).size === 3
  );
});

test('commands cannot make child names ambiguous with positional values', () => {
  assert.throws(
    () => createCli({
      name: 'ship',
      commands: [{
        name: 'project',
        positionals: [{ name: 'target' }],
        commands: [{ name: 'deploy' }]
      }]
    }),
    (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
      issue.code === 'AMBIGUOUS_COMMAND_INPUT')
  );
});
