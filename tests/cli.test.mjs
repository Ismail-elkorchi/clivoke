import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CliDefinitionError,
  completeCliWords,
  createCli,
  createCliHelp,
  createCompletionScript,
  formatCliHelp,
  inspectCliArgv,
  value
} from '../dist/index.js';

const cli = createCli({
  name: 'ship',
  examples: [{ usage: 'ship project deploy api --region eu' }],
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
      examples: [{
        usage: 'ship project deploy api --region us',
        description: 'Deploy the API in the US region.'
      }],
      options: {
        region: {
          type: value.choice(['eu', 'us']),
          flags: ['-r', '--region'],
          required: true
        }
      },
      positionals: [{ name: 'service' }],
      acceptsPassthroughArguments: true
    }]
  }]
});

test('a compiled CLI exposes its own stable identity and behavior', () => {
  assert.equal(cli.name, 'ship');
  assert.equal('program' in cli, false);
  assert.equal(typeof cli.parse, 'function');
  assert.equal(typeof cli.invoke, 'function');
});

test('one grammar implementation routes and binds every supported value form', () => {
  for (const argv of [
    ['-vq', 'project', 'd', '--region=eu', 'api', '--', '--watch'],
    ['project', '--config', 'file', 'deploy', '-r', 'eu', 'api'],
    ['project', 'deploy', '-reu', 'api'],
    ['--no-verbose', 'project', 'deploy', '--region', 'eu', 'api']
  ]) {
    const result = cli.parse({ argv });
    assert.equal(result.status, 'ready', JSON.stringify(result));
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
  const unknownIssue = result.diagnostics.find((diagnostic) =>
    diagnostic.code === 'CLI_UNKNOWN_FLAG');
  assert.equal(unknownIssue?.argvIndex, 2);
  assert.equal(unknownIssue?.flag, '--wat');
});

test('unknown-flag suggestions survive the CLI boundary', () => {
  const result = cli.parse({
    argv: ['project', 'deploy', '--regoin', '--region=eu', 'api'],
    unknownFlagPolicy: 'collect'
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.unknownFlags[0]?.suggestions, ['--region']);
});

test('parse settings are a closed, accessor-safe runtime boundary', () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'argv', {
    enumerable: true,
    get() {
      reads += 1;
      return [];
    }
  });
  assert.throws(() => cli.parse(accessor), /data property/u);
  assert.equal(reads, 0);
  assert.throws(
    () => cli.parse({ argv: [], unknownFlagPolicy: 'ignore' }),
    /Unknown-flag policy/u
  );
  assert.throws(() => cli.parse({ argv: [], extra: true }), /Unknown CLI parse input property/u);
  assert.throws(() => cli.parse({ argv: new Array(1) }), /dense array of strings/u);

  const argv = [];
  Object.defineProperty(argv, 0, {
    enumerable: true,
    get() {
      reads += 1;
      return '--verbose';
    }
  });
  assert.throws(() => cli.parse({ argv }), /dense array of strings/u);
  assert.equal(reads, 0);
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
  assert.equal(result.status, 'ready');
  assert.equal(result.optionValues.config, 'file');
});

test('help and completion retain defaults, choices, false flags, and value context', async () => {
  const help = createCliHelp(cli, ['project', 'deploy']);
  assert.ok(help);
  const verbose = help.options.find((option) => option.name === 'verbose');
  const region = help.options.find((option) => option.name === 'region');
  assert.deepEqual(verbose?.falseFlags, ['--no-verbose']);
  assert.equal(verbose?.defaultLabel, 'false');
  assert.deepEqual(region?.valueCandidates, ['eu', 'us']);
  assert.deepEqual(help.examples, [{
    usage: 'ship project deploy api --region us',
    description: 'Deploy the API in the US region.'
  }]);
  const formatted = formatCliHelp(help);
  assert.match(formatted, /\[required; choices: eu, us\]/u);
  assert.match(formatted, /\[default: false\]/u);
  assert.match(formatted, /Examples:\n {2}ship project deploy api --region us/u);
  assert.equal(createCliHelp(cli, ['missing']), undefined);

  assert.deepEqual(
    await completeCliWords(cli, {
      words: ['ship', 'project', 'deploy', '--region', 'e'],
      cursor: 4
    }),
    [{ kind: 'option-value', value: 'eu', option: 'region' }]
  );
  assert.deepEqual(
    await completeCliWords(cli, {
      words: ['ship', 'project', 'deploy', '--region=u'],
      cursor: 3
    }),
    [{ kind: 'option-value', value: '--region=us', option: 'region' }]
  );
  assert.deepEqual(
    (await completeCliWords(cli, {
      words: ['ship', 'project', 'deploy', '--region=eu', 'a'],
      cursor: 4,
      provideValues(context) {
        return context.kind === 'positional' ? ['api', 'worker'] : [];
      }
    })).filter((candidate) => candidate.kind === 'positional-value'),
    [{ kind: 'positional-value', value: 'api', positional: 'service' }]
  );
  assert.doesNotMatch(createCompletionScript(cli, 'bash'), /__complete/u);
  assert.match(createCompletionScript(cli, 'bash'), /ship-complete/u);
});

test('help and version are grammar-aware parse actions', () => {
  const releaseCli = createCli({
    name: 'ship',
    version: '1.2.3',
    invokable: false,
    commands: [{
      name: 'deploy',
      options: {
        input: { type: 'string', flags: ['--input'], required: true }
      }
    }]
  });

  assert.deepEqual(releaseCli.parse({ argv: ['--help'] }), {
    status: 'help',
    commandPath: []
  });
  assert.deepEqual(releaseCli.parse({ argv: ['deploy', '-h'] }), {
    status: 'help',
    commandPath: ['deploy']
  });
  assert.deepEqual(releaseCli.parse({ argv: [] }), {
    status: 'help',
    commandPath: []
  });
  assert.deepEqual(releaseCli.parse({ argv: ['help'] }), {
    status: 'help',
    commandPath: []
  });
  assert.deepEqual(releaseCli.parse({ argv: ['help', 'deploy'] }), {
    status: 'help',
    commandPath: ['deploy']
  });
  const unknownHelp = releaseCli.parse({ argv: ['help', 'missing'] });
  assert.equal(unknownHelp.status, 'invalid');
  assert.equal(unknownHelp.diagnostics[0]?.code, 'CLI_UNKNOWN_COMMAND');
  assert.equal(unknownHelp.diagnostics[0]?.token, 'missing');
  assert.deepEqual(releaseCli.parse({ argv: ['--version'] }), {
    status: 'version',
    version: '1.2.3'
  });

  const valueNamedHelp = releaseCli.parse({ argv: ['deploy', '--input', '--help'] });
  assert.equal(valueNamedHelp.status, 'ready');
  assert.equal(valueNamedHelp.optionValues.input, '--help');
  assert.equal(releaseCli.parse({ argv: ['deploy', '--', '--help'] }).status, 'invalid');
  assert.equal(releaseCli.parse({ argv: ['deploy', '--help=value'] }).status, 'invalid');

  const help = createCliHelp(releaseCli, ['deploy']);
  assert.ok(help);
  assert.deepEqual(help.options.map((option) => option.name), ['help', 'version', 'input']);
  assert.match(formatCliHelp(help), /^Usage: ship deploy \[options\]$/mu);
  assert.match(formatCliHelp(help), /-h, --help {2}Show help\./u);
  assert.match(formatCliHelp(help), /--version {2}Show the version\./u);
});

test('argv inspection identifies control flags through the actual grammar', () => {
  const outputCli = createCli({
    name: 'agent',
    invokable: false,
    options: {
      json: { type: 'boolean', flags: ['--json'] }
    },
    commands: [{
      name: 'query',
      options: {
        term: { type: 'string', flags: ['--term'], required: true }
      }
    }]
  });
  const inspection = inspectCliArgv(outputCli, [
    '--json', 'query', '--term', 'knowledge', '--unknown'
  ]);
  assert.equal(Object.isFrozen(inspection), true);
  assert.equal(Object.isFrozen(inspection.argv), true);
  assert.equal(Object.isFrozen(inspection.options), true);
  assert.equal(Object.isFrozen(inspection.options[0]), true);
  assert.deepEqual(inspection.commandPath, ['query']);
  assert.deepEqual(inspection.options.map(({ option, rawValue }) => ({ option, rawValue })), [{
    option: 'json',
    rawValue: undefined
  }, {
    option: 'term',
    rawValue: 'knowledge'
  }]);
  assert.deepEqual(inspection.unknownFlags.map(({ flag }) => flag), ['--unknown']);

  const valueInspection = inspectCliArgv(outputCli, ['query', '--term', '--json']);
  assert.deepEqual(valueInspection.options.map(({ option, rawValue }) => ({ option, rawValue })), [{
    option: 'term',
    rawValue: '--json'
  }]);
});

test('built-in action names and flags cannot be redefined', () => {
  for (const options of [
    { help: { type: 'boolean', flags: ['--other'] } },
    { custom: { type: 'boolean', flags: ['--help'] } },
    { version: { type: 'boolean', flags: ['--other'] } },
    { custom: { type: 'boolean', flags: ['--version'] } }
  ]) {
    assert.throws(
      () => createCli({ name: 'ship', options }),
      (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
        issue.source === 'clivoke' && issue.code === 'INVALID_DEFINITION')
    );
  }
  for (const command of [
    { name: 'help' },
    { name: 'status', aliases: ['help'] },
    { name: 'status', aliases: [{ name: 'help' }] }
  ]) {
    assert.throws(
      () => createCli({ name: 'ship', commands: [command] }),
      (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
        issue.source === 'clivoke' && issue.code === 'INVALID_DEFINITION')
    );
  }
});

test('special option names remain ordinary own properties', () => {
  const options = Object.fromEntries([[
    '__proto__',
    { type: 'string', flags: ['--prototype'], required: true }
  ]]);
  const special = createCli({ name: 'inspect', options });
  const result = special.parse({ argv: ['--prototype', 'safe'] });
  assert.equal(result.status, 'ready');
  assert.equal(result.optionValues['__proto__'], 'safe');
  assert.equal(Object.getPrototypeOf(result.optionValues), null);
});

test('one definition error aggregates Clivoke, command, and option issues', () => {
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

test('root invocations and grouping commands have explicit command semantics', () => {
  const rootCli = createCli({
    name: 'format',
    positionals: [{ name: 'files', variadic: true }],
    acceptsPassthroughArguments: true
  });
  const root = rootCli.parse({ argv: ['one.ts', 'two.ts', '--', '--check'] });
  assert.equal(root.status, 'ready');
  assert.deepEqual(root.positionalValues.files, ['one.ts', 'two.ts']);
  assert.deepEqual(root.passthroughArguments, ['--check']);

  const grouped = createCli({
    name: 'ship',
    invokable: false,
    commands: [{
      name: 'project',
      invokable: false,
      commands: [{ name: 'status' }]
    }]
  });
  const group = grouped.parse({ argv: ['project'] });
  assert.equal(group.status, 'invalid');
  assert.equal(group.diagnostics[0]?.code, 'CLI_SUBCOMMAND_REQUIRED');
  assert.equal(grouped.parse({ argv: ['project', 'status'] }).status, 'ready');
});

test('structured invocation uses the same command-specific semantic validation', () => {
  const invocation = cli.invoke({
    sourceId: 'test',
    commandPath: ['project', 'deploy'],
    optionValues: {
      verbose: false,
      quiet: 0,
      region: 'eu'
    },
    specifiedOptions: {
      verbose: false,
      quiet: false,
      config: false,
      region: true
    },
    positionalValues: { service: 'api' },
    passthroughArguments: ['--watch']
  });
  assert.equal(invocation.status, 'ready');
  assert.deepEqual(invocation.source, { kind: 'structured', sourceId: 'test' });
  assert.equal(invocation.optionValues.region, 'eu');

  let reads = 0;
  const accessorInput = {};
  Object.defineProperty(accessorInput, 'commandPath', {
    enumerable: true,
    get() {
      reads += 1;
      return ['project', 'deploy'];
    }
  });
  const invalid = cli.invoke(accessorInput);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.diagnostics[0]?.code, 'CLI_INVALID_STRUCTURED_INVOCATION');
  assert.equal(reads, 0);
});

test('definition inputs reject accessors and cycles without evaluating accessors', () => {
  let accessed = false;
  const accessorDefinition = { name: 'ship' };
  Object.defineProperty(accessorDefinition, 'description', {
    enumerable: true,
    get() {
      accessed = true;
      return 'unsafe';
    }
  });
  assert.throws(
    () => createCli(accessorDefinition),
    (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
      issue.code === 'INVALID_DEFINITION')
  );
  assert.equal(accessed, false);

  let arrayReads = 0;
  const flags = [];
  Object.defineProperty(flags, 0, {
    enumerable: true,
    get() {
      arrayReads += 1;
      return '--unsafe';
    }
  });
  assert.throws(
    () => createCli({ name: 'ship', options: { unsafe: { type: 'string', flags } } }),
    (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
      issue.code === 'INVALID_DEFINITION')
  );
  assert.equal(arrayReads, 0);

  const cyclic = { name: 'ship', commands: [] };
  cyclic.commands.push(cyclic);
  assert.throws(
    () => createCli(cyclic),
    (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
      issue.code === 'INVALID_DEFINITION' && /cycles/u.test(issue.message))
  );
});

test('value parser objects keep their structural argv-flags contract', () => {
  class UppercaseParser {
    parse(raw) {
      return { success: true, value: raw.toUpperCase() };
    }

    accepts(candidate) {
      return typeof candidate === 'string';
    }

    snapshot(candidate) {
      return candidate;
    }
  }

  const structural = createCli({
    name: 'inspect',
    options: { name: { type: new UppercaseParser(), flags: ['--name'] } }
  });
  const result = structural.parse({ argv: ['--name=casey'] });
  assert.equal(result.status, 'ready');
  assert.equal(result.optionValues.name, 'CASEY');

  let reads = 0;
  const accessorParser = {
    accepts: (candidate) => typeof candidate === 'string',
    snapshot: (candidate) => candidate
  };
  Object.defineProperty(accessorParser, 'parse', {
    get() {
      reads += 1;
      return () => ({ success: true, value: 'unreachable' });
    }
  });
  assert.throws(
    () => createCli({
      name: 'inspect',
      options: { name: { type: accessorParser, flags: ['--name'] } }
    }),
    (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
      issue.source === 'option' && issue.code === 'INVALID_VALUE_PARSER')
  );
  assert.equal(reads, 0);
});

test('option declaration failures are reported once at their origin', () => {
  assert.throws(
    () => createCli({
      name: 'ship',
      options: { broken: { type: 'string', flags: ['not-a-flag'] } },
      commands: [{ name: 'one' }, { name: 'two' }]
    }),
    (error) => error instanceof CliDefinitionError &&
      error.issues.filter((issue) => issue.source === 'option').length === 1 &&
      error.issues.find((issue) => issue.source === 'option')?.commandPath.length === 0
  );
  assert.throws(
    () => createCli({
      name: 'ship',
      options: {
        source: {
          type: 'string',
          flags: ['--source'],
          implicitValueLabel: 'automatic'
        }
      }
    }),
    (error) => error instanceof CliDefinitionError && error.issues.some((issue) =>
      issue.source === 'clivoke' && /optional-inline/u.test(issue.message))
  );
  assert.throws(
    () => createCli({
      name: 'ship',
      options: {
        labels: {
          type: 'string',
          flags: ['--label'],
          multiple: true,
          required: true,
          defaultLabel: 'none'
        },
        verbose: {
          type: 'boolean',
          flags: ['--verbose'],
          sensitive: true
        }
      }
    }),
    (error) => error instanceof CliDefinitionError &&
      error.issues.filter((issue) => issue.source === 'clivoke').length === 2
  );
});

test('required multiple options are not presented as defaulted', () => {
  const requiredMultipleCli = createCli({
    name: 'tag',
    options: {
      labels: {
        type: 'string',
        flags: ['--label'],
        multiple: true,
        required: true
      }
    }
  });
  const option = createCliHelp(requiredMultipleCli)?.options[0];
  assert.equal(option?.hasDefault, false);
  const missing = requiredMultipleCli.parse({ argv: [] });
  assert.equal(missing.status, 'invalid');
  assert.equal(missing.diagnostics[0]?.code, 'MISSING_REQUIRED_OPTION');
});

test('completion providers are asynchronous and receive immutable scan context', async () => {
  let observed;
  const candidates = await completeCliWords(cli, {
    words: ['ship', '-v', 'project', 'deploy', '--region', 'e', 'later'],
    cursor: 5,
    async provideValues(context) {
      observed = context;
      return ['east'];
    }
  });
  assert.equal(observed.kind, 'option-value');
  assert.equal(observed.option, 'region');
  assert.equal(observed.partialInvocation.cursor, 5);
  assert.equal(observed.partialInvocation.words.at(-1), 'later');
  assert.ok(observed.partialInvocation.options.some((option) => option.option === 'verbose'));
  assert.deepEqual(observed.partialInvocation.positionalArguments, []);
  assert.equal(Object.isFrozen(observed.partialInvocation), true);
  assert.ok(candidates.some((candidate) => candidate.value === 'east'));
});

test('completion handles aliases, hidden options, empty words, and spaced values', async () => {
  const completionCli = createCli({
    name: 'ship',
    invokable: false,
    commands: [{
      name: 'deploy',
      aliases: ['d'],
      options: {
        visible: { type: 'boolean', flags: ['--visible'] },
        secret: { type: 'boolean', flags: ['--secret'], hidden: true }
      },
      positionals: [{ name: 'service', required: false }]
    }]
  });
  let positionalContext;
  const ordinary = await completeCliWords(completionCli, {
    words: ['ship', 'd', ''],
    cursor: 2,
    async provideValues(context) {
      positionalContext = context;
      return ['api worker'];
    }
  });
  assert.ok(ordinary.some((candidate) => candidate.value === '--visible'));
  assert.ok(ordinary.some((candidate) => candidate.value === 'api worker'));
  assert.deepEqual(
    positionalContext.partialInvocation.positionalArguments.map((argument) => argument.value),
    ['']
  );
  assert.equal(ordinary.some((candidate) => candidate.value === '--secret'), false);
  const includingHidden = await completeCliWords(completionCli, {
    words: ['ship', 'd', '--s'],
    cursor: 2,
    includeHidden: true
  });
  assert.ok(includingHidden.some((candidate) => candidate.value === '--secret'));
  await assert.rejects(
    completeCliWords(completionCli, { words: ['ship'], cursor: 2 }),
    (error) => error instanceof RangeError && /cursor/u.test(error.message)
  );

  let reads = 0;
  const accessor = { words: ['ship'] };
  Object.defineProperty(accessor, 'includeHidden', {
    enumerable: true,
    get() {
      reads += 1;
      return true;
    }
  });
  await assert.rejects(completeCliWords(completionCli, accessor), /data property/u);
  assert.equal(reads, 0);

  const words = [];
  Object.defineProperty(words, 0, {
    enumerable: true,
    get() {
      reads += 1;
      return 'ship';
    }
  });
  await assert.rejects(completeCliWords(completionCli, { words }), /dense array of strings/u);
  assert.equal(reads, 0);
  await assert.rejects(
    completeCliWords(completionCli, { words: ['ship'], includeHidden: 'yes' }),
    /includeHidden/u
  );
  await assert.rejects(
    completeCliWords(completionCli, { words: ['ship'], extra: true }),
    /Unknown completion request property/u
  );
});

test('completion script generation rejects invalid adapter settings', () => {
  assert.throws(() => createCompletionScript(cli, 'other'), /Completion shell/u);
  assert.throws(() => createCompletionScript(cli, 'bash', ''), /Completion executable/u);
});

test('commands may provide completion after the option terminator', async () => {
  const candidates = await completeCliWords(cli, {
    words: ['ship', 'project', 'deploy', '--region=eu', 'api', '--', '--wa'],
    cursor: 6,
    async provideValues(context) {
      assert.equal(context.kind, 'passthrough');
      assert.deepEqual(context.partialInvocation.passthroughArguments.map((entry) => entry.value), [
        '--wa'
      ]);
      return ['--watch', '--write'];
    }
  });
  assert.deepEqual(candidates, [
    { kind: 'passthrough-value', value: '--watch' }
  ]);
});

test('explicit presentation labels cover values the parser cannot describe generically', () => {
  const presentationCli = createCli({
    name: 'ship',
    options: {
      region: {
        type: 'string',
        flags: ['--region'],
        valueMode: 'optional-inline',
        implicitValue: 'auto',
        default: 'eu',
        valueDescription: 'Deployment region or auto selection.',
        implicitValueLabel: 'auto',
        defaultLabel: 'configured region'
      }
    }
  });
  const option = createCliHelp(presentationCli)?.options[0];
  assert.equal(option?.valueDescription, 'Deployment region or auto selection.');
  assert.equal(option?.implicitValueLabel, 'auto');
  assert.equal(option?.defaultLabel, 'configured region');
});


test('sensitive declarations validate their policy and do not publish raw defaults or choices', async () => {
  assert.throws(() => createCli({ name: 'ship', options: {
    token: { type: 'string', flags: ['--token'], sensitive: 'true' }
  } }), CliDefinitionError);
  const sensitiveCli = createCli({ name: 'ship', options: {
    token: { type: value.choice(['SECRET-A', 'SECRET-B']), flags: ['--token'], sensitive: true, default: 'SECRET-A' }
  } });
  const help = createCliHelp(sensitiveCli);
  assert.doesNotMatch(JSON.stringify(help), /SECRET/u);
  assert.doesNotMatch(formatCliHelp(help), /SECRET/u);
  assert.deepEqual(await completeCliWords(sensitiveCli, { words: ['ship', '--token', ''] }), []);
  assert.equal(sensitiveCli.parse().optionValues.token, 'SECRET-A');
});


test('malformed global options retain child grammar and cannot promote values to controls', () => {
  const app = createCli({ name: 'app', version: '1', options: {
    progress: { type: 'string', flags: ['--progress'] },
    json: { type: 'boolean', flags: ['--json'] },
    debug: { type: 'boolean', flags: ['--debug'] }
  }, commands: [{ name: 'query', options: { term: { type: 'string', flags: ['--term'] } } }] });
  for (const term of ['--help', '--version', '--json', '--debug']) {
    const argv = ['query', '--term', term, '--progress'];
    const result = app.parse({ argv });
    assert.equal(result.status, 'invalid');
    assert.deepEqual(result.command.path, ['query']);
    assert.equal(result.diagnostics.some((issue) => issue.code === 'CLI_UNKNOWN_FLAG'), false);
    const inspection = inspectCliArgv(app, argv);
    assert.deepEqual(inspection.commandPath, ['query']);
    assert.equal(inspection.options.some((option) => option.flag === term), false);
    assert.equal(inspection.options.find((option) => option.option === 'term').rawValue, term);
  }
  assert.equal(app.parse({ argv: ['query', '--progress', '--help', '--help'] }).status, 'help');
});

test('uncertain command syntax stays unclassified and never enables suffix controls', async () => {
  const app = createCli({ name: 'app', version: '1', commands: [{ name: 'query' }] });
  for (const argv of [['--unknown', 'query', '--version'], ['unknown', '--term', '--help']]) {
    assert.equal(app.parse({ argv }).status, 'invalid');
    const inspection = inspectCliArgv(app, argv);
    assert.ok(inspection.unclassifiedArguments.length > 0);
    assert.equal(inspection.options.length, 0);
    assert.deepEqual(await completeCliWords(app, { words: ['app', ...argv, ''] }), []);
  }
  assert.ok((await completeCliWords(app, { words: ['/usr/bin/app', 'qu'] })).some((item) => item.value === 'query'));
});

test('help and version classify without decoding or materializing invocation values', () => {
  let calls = 0;
  const app = createCli({ name: 'app', version: '1', options: {
    token: { type: value.custom({ parse(raw) { calls++; return { success: true, value: raw }; }, accepts(x) { return typeof x === 'string'; } }), flags: ['--token'] }
  } });
  assert.equal(app.parse({ argv: ['--token', 'value', '--help'] }).status, 'help');
  assert.equal(app.parse({ argv: ['--token', 'value', '--version'] }).status, 'version');
  assert.equal(calls, 0);
  assert.equal(app.parse({ argv: ['--token', 'value'] }).status, 'ready');
  assert.equal(calls, 1);
});

test('defaults are compiled once per declaration rather than per inherited scope', () => {
  let snapshots = 0;
  const app = createCli({ name: 'app', options: { token: {
    type: value.custom({ parse(raw) { return { success: true, value: raw }; }, accepts(x) { return typeof x === 'string'; }, snapshot(x) { snapshots++; return x; } }),
    flags: ['--token'], default: 'default'
  } }, commands: [{ name: 'one' }, { name: 'two' }] });
  assert.equal(snapshots, 1);
  assert.equal(app.parse({ argv: ['one'] }).status, 'ready');
});


test('scalar custom array defaults remain parser-owned across inherited scopes', () => {
  class Labels extends Array {}
  const initial = new Labels('one');
  const labels = value.custom({
    parse(raw) { return { success: true, value: Object.freeze(new Labels(raw)) }; },
    accepts(candidate) { return candidate instanceof Labels; },
    snapshot(candidate) { return Object.freeze(new Labels(...candidate)); }
  });
  const app = createCli({ name: 'app', options: {
    labels: { type: labels, flags: ['--labels'], default: initial, defaultLabel: 'initial labels' }
  }, commands: [{ name: 'child' }] });
  initial.push('later');
  const result = app.parse({ argv: ['child'] });
  assert.equal(result.status, 'ready');
  assert.ok(result.optionValues.labels instanceof Labels);
  assert.deepEqual([...result.optionValues.labels], ['one']);
});


test('transport help metadata cannot mutate future grammar or completion', async () => {
  const app = createCli({ name: 'app', version: '1' });
  const help = createCliHelp(app);
  const control = help.options.find((option) => option.name === 'help');
  assert.ok(Object.isFrozen(control.flags));
  assert.throws(() => control.flags.push('--mutated'), TypeError);
  assert.equal(app.parse({ argv: ['--help'] }).status, 'help');
  assert.ok((await completeCliWords(app, { words: ['app', '--h'] })).some((candidate) => candidate.value === '--help'));
});

test('genuine global controls remain recognizable after an unknown command', () => {
  const app = createCli({ name: 'app', version: '1', options: {
    json: { type: 'boolean', flags: ['--json'] }, debug: { type: 'boolean', flags: ['--debug'] }
  }, commands: [{ name: 'query', options: { term: { type: 'string', flags: ['--term'] } } }] });
  assert.equal(app.parse({ argv: ['unknown', '--help'] }).status, 'help');
  assert.equal(app.parse({ argv: ['unknown', '--version'] }).status, 'version');
  const invalid = app.parse({ argv: ['unknown', '--json', '--debug'] });
  assert.equal(invalid.status, 'invalid');
  assert.deepEqual(inspectCliArgv(app, ['unknown', '--json', '--debug']).options.map((item) => item.option), ['json', 'debug']);
  const uncertain = inspectCliArgv(app, ['unknown', '--json', '--term', '--debug']);
  assert.deepEqual(uncertain.options.map((item) => item.option), ['json']);
  assert.ok(uncertain.unclassifiedArguments.some((item) => item.value === '--debug'));
});


test('partial malformed clusters never become actionable controls or permit guessed suffixes', () => {
  const app = createCli({ name: 'app', version: '1', options: {
    verbose: { type: 'count', flags: ['-v'] }, json: { type: 'boolean', flags: ['--json'] }
  }, commands: [{ name: 'query' }] });
  for (const argv of [['-v?', '--help'], ['-h?', '--version'], ['unknown', '-v?', '--json']]) {
    const result = app.parse({ argv });
    assert.equal(result.status, 'invalid');
    assert.ok(result.diagnostics.some((issue) => issue.code === 'INVALID_FLAG_SYNTAX'));
    const inspection = inspectCliArgv(app, argv);
    assert.equal(inspection.options.length, 0);
    assert.ok(inspection.unclassifiedArguments.some((argument) => argument.value.endsWith('?')));
    assert.ok(inspection.unclassifiedArguments.some((argument) => argument.value === argv.at(-1)));
  }
});
