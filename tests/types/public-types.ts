import process from 'node:process';
import {
  completeCliWords,
  createCli,
  createProcessCliHost,
  inspectCliArgv,
  runCliMain,
  type CliDiagnostic,
  value
} from '../../src/index.ts';

type ExpectNever<Value extends never> = Value;
export type UnknownFlagOptionDiagnosticMustBeNever = ExpectNever<Extract<
  CliDiagnostic,
  { readonly source: 'option'; readonly code: 'UNKNOWN_FLAG' }
>>;

const cli = createCli({
  name: 'ship',
  examples: [{ usage: 'ship deploy api --target eu' }],
  options: {
    verbose: { type: 'boolean', flags: ['-v'] },
    retries: { type: 'integer', flags: ['--retries'], default: 2 }
  },
  commands: [{
    name: 'deploy',
    options: {
      target: {
        type: value.choice(['eu', 'us']),
        flags: ['--target'],
        required: true
      }
    },
    positionals: [
      { name: 'service' },
      { name: 'labels', required: false, variadic: true }
    ]
  }, {
    name: 'inspect',
    options: {
      target: { type: 'integer', flags: ['--target'], required: true }
    },
    positionals: [{ name: 'file', required: false }]
  }]
});

const result = cli.parse({ argv: [] });
const inspection = inspectCliArgv(cli, ['deploy', '--target', 'eu', 'api']);
const inspectedPath: readonly string[] = inspection.commandPath;
void inspectedPath;
const cliName: 'ship' = cli.name;
void cliName;
// @ts-expect-error dependency compilation state is not part of the Clivoke API
cli.program;

const parseInputWithExtra = { argv: [], extra: true } as const;
// @ts-expect-error parse settings are closed
cli.parse(parseInputWithExtra);
if (result.status === 'ready') {
  if (result.commandKey === 'ship deploy') {
    const target: 'eu' | 'us' = result.optionValues.target;
    const service: string = result.positionalValues.service;
    const labels: readonly string[] = result.positionalValues.labels;
    void target;
    void service;
    void labels;
  } else if (result.commandKey === 'ship inspect') {
    const target: number = result.optionValues.target;
    const file: string | undefined = result.positionalValues.file;
    void target;
    void file;
  } else {
    const retries: number = result.optionValues.retries;
    // @ts-expect-error root invocations do not contain command-local options
    result.optionValues.target;
    // @ts-expect-error root invocations do not contain command-local positionals
    result.positionalValues.service;
    void retries;
  }
} else {
  // @ts-expect-error rejected invocations have no values
  result.optionValues;
}

void runCliMain({
  cli,
  host: {
    argv: [],
    writeStdout() {},
    writeStderr() {},
    setExitCode() {}
  },
  handlers: {
    ship: ({ invocation }) => ({ stdout: String(invocation.optionValues.retries) }),
    'ship deploy': ({ invocation }) => {
      const target: 'eu' | 'us' = invocation.optionValues.target;
      const service: string = invocation.positionalValues.service;
      return { stdout: `${target}:${service}` };
    },
    'ship inspect': ({ invocation }) => {
      const target: number = invocation.optionValues.target;
      return { stdout: String(target) };
    },
    // @ts-expect-error handlers accept only canonical command keys
    typo: () => undefined
  },
  context: undefined
});

// @ts-expect-error root definitions are closed
createCli({ name: 'ship', typo: true });

// @ts-expect-error example definitions are closed
createCli({ name: 'ship', examples: [{ usage: 'ship', typo: true }] });

createCli({
  name: 'ship',
  commands: [{
    name: 'status',
    // @ts-expect-error command definitions are closed
    typo: true
  }]
});

createCli({
  name: 'ship',
  options: {
    labels: {
      type: 'string',
      flags: ['--label'],
      multiple: true,
      required: true,
      // @ts-expect-error required multiple options cannot advertise a default
      defaultLabel: 'none'
    },
    verbose: {
      type: 'boolean',
      flags: ['--verbose'],
      // @ts-expect-error only value-taking options can be sensitive
      sensitive: true
    }
  }
});

createCli({
  name: 'ship',
  options: {
    source: {
      type: 'string',
      flags: ['--source'],
      // @ts-expect-error option definitions are closed
      typo: true
    }
  }
});

createCli({
  name: 'ship',
  options: {
    // @ts-expect-error implicit labels require optional-inline value mode
    source: {
      type: 'string',
      flags: ['--source'],
      implicitValueLabel: 'automatic'
    },
    // @ts-expect-error labels cannot advertise a default that does not exist
    verbose: {
      type: 'boolean',
      flags: ['--verbose'],
      defaultLabel: 'off'
    }
  }
});

const structured = cli.invoke({
  sourceId: 'test',
  commandPath: ['deploy'],
  optionValues: { verbose: false, retries: 2, target: 'eu' },
  specifiedOptions: { verbose: false, retries: false, target: true },
  positionalValues: { service: 'api', labels: [] }
});

const structuredInputWithExtra = {
  commandPath: ['deploy'],
  optionValues: { verbose: false, retries: 2, target: 'eu' },
  specifiedOptions: { verbose: false, retries: false, target: true },
  positionalValues: { service: 'api', labels: [] },
  extra: true
} as const;
// @ts-expect-error structured invocation inputs are closed
cli.invoke(structuredInputWithExtra);
if (structured.status === 'ready' && structured.commandKey === 'ship deploy') {
  const target: 'eu' | 'us' = structured.optionValues.target;
  void target;
}

cli.invoke({
  commandPath: ['deploy'],
  optionValues: { verbose: false, retries: 2, target: 'eu' },
  specifiedOptions: {
    verbose: false,
    retries: false,
    // @ts-expect-error required options are necessarily specified
    target: false
  },
  positionalValues: { service: 'api', labels: [] }
});

const grouped = createCli({
  name: 'tool',
  invokable: false,
  commands: [{ name: 'project', invokable: false, commands: [{ name: 'status' }] }]
});
void runCliMain({
  cli: grouped,
  host: {
    argv: [],
    writeStdout() {},
    writeStderr() {},
    setExitCode() {}
  },
  handlers: {
    'tool project status': () => undefined,
    // @ts-expect-error grouping commands cannot have handlers
    'tool project': () => undefined
  },
  context: undefined
});

void completeCliWords(cli, {
  words: ['ship', 'deploy', '--target', 'e'],
  async provideValues(context) {
    const path: readonly string[] = context.partialInvocation.commandPath;
    void path;
    return ['eu'];
  }
});

const completionRequestWithExtra = { words: ['ship'], extra: true } as const;
// @ts-expect-error completion requests are closed
void completeCliWords(cli, completionRequestWithExtra);

createCli({
  name: 'ship',
  options: {
    source: {
      type: 'string',
      flags: ['--source'],
      // @ts-expect-error string defaults must be strings
      default: 1
    }
  }
});

// Reusable and dynamic definitions retain a usable widened boundary.
import type { Cli, CliCommandDefinition, CliDefinition } from '../../src/index.ts';
const dynamicDefinition: CliDefinition = { name: 'dynamic', commands: [{ name: 'run' }] };
const dynamicResult = createCli(dynamicDefinition).parse();
if (dynamicResult.status === 'ready') {
  const dynamicKey: string = dynamicResult.commandKey;
  void dynamicKey;
}
function parseDynamic(cli: Cli) { return cli.parse(); }
void parseDynamic;
const dynamicCommands: readonly CliCommandDefinition[] = [{ name: 'dynamic' }];
const mixedCli = createCli({ name: 'mixed', commands: [{ name: 'fixed' }, ...dynamicCommands] });
const mixedResult = mixedCli.parse();
if (mixedResult.status === 'ready') {
  const mixedKey: string = mixedResult.commandKey;
  void mixedKey;
}

const partialDefinition = createCli({ name: 'partial', commands: [
  { name: 'fixed', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'plugins', commands: dynamicCommands }
] });
const partialResult = partialDefinition.parse();
if (partialResult.status === 'ready' && partialResult.commandKey === 'partial fixed') {
  const exactCount: number = partialResult.optionValues.count;
  void exactCount;
}

// The structural host accepts the actual Node process type.
createProcessCliHost(process);

// Flat siblings must not spend one recursive instantiation per command.
const wideCommands = [
  { name: 'c0', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c1', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c2', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c3', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c4', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c5', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c6', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c7', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c8', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c9', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c10', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c11', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c12', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c13', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c14', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c15', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c16', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c17', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c18', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c19', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c20', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c21', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c22', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c23', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c24', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c25', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c26', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c27', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c28', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c29', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c30', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c31', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c32', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c33', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c34', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c35', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c36', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c37', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c38', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c39', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c40', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c41', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c42', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c43', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c44', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c45', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c46', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c47', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c48', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c49', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c50', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c51', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c52', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c53', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c54', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c55', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c56', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c57', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c58', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
  { name: 'c59', options: { count: { type: 'integer', flags: ['--count'], required: true } } },
 ] as const;
const wideCli = createCli({ name: 'wide', commands: wideCommands });
const wideResult = wideCli.parse();
if (wideResult.status === 'ready' && wideResult.commandKey === 'wide c59') {
  const count: number = wideResult.optionValues.count;
  // @ts-expect-error a sibling command does not add arbitrary options
  wideResult.optionValues.missing;
  void count;
}

const branchA = { name: 'a', options: { count: { type: 'integer', flags: ['--count'], required: true } } } as const;
const branchB = { name: 'b', options: { label: { type: 'string', flags: ['--label'], required: true } } } as const;
const unionCommands: readonly [typeof branchA | typeof branchB] = [Math.random() > 0.5 ? branchA : branchB];
const unionCli = createCli({ name: 'app', commands: unionCommands });
const unionResult = unionCli.parse();
if (unionResult.status === 'ready' && unionResult.commandKey === 'app a') {
  const count: number = unionResult.optionValues.count;
  // @ts-expect-error options from branch b are not available on branch a
  unionResult.optionValues.label;
  // @ts-expect-error branch a has numeric count, not string
  const text: string = unionResult.optionValues.count;
  void count;
  void text;
}
if (unionResult.status === 'ready' && unionResult.commandKey === 'app b') {
  const label: string = unionResult.optionValues.label;
  // @ts-expect-error options from branch a are not available on branch b
  unionResult.optionValues.count;
  void label;
}

// A known prefix is retained when only the tail is dynamically supplied.
const prefixedCommands: readonly [typeof branchA, ...CliCommandDefinition[]] = [branchA, ...dynamicCommands];
const prefixed = createCli({ name: 'prefix', commands: prefixedCommands }).parse();
if (prefixed.status === 'ready' && prefixed.commandKey === 'prefix a') {
  // The dynamic tail can overlap a known key, so it must not be asserted numeric.
  // @ts-expect-error dynamic command options are not necessarily numbers
  const count: number = prefixed.optionValues.count;
  void count;
}
const prefixedReady = null as unknown as Extract<typeof prefixed, { commandKey: 'prefix a' }>;
const prefixedCount: number = prefixedReady.optionValues.count;
// @ts-expect-error the known prefix keeps its original numeric option
const prefixedText: string = prefixedReady.optionValues.count;
void prefixedCount;
void prefixedText;

const widePrefixed = createCli({ name: 'widePrefix', commands: [...wideCommands, ...dynamicCommands] }).parse();
const widePrefixedReady = null as unknown as Extract<typeof widePrefixed, { commandKey: 'widePrefix c59' }>;
const widePrefixedCount: number = widePrefixedReady.optionValues.count;
// @ts-expect-error wide variadic prefixes must preserve exact option types
const widePrefixedText: string = widePrefixedReady.optionValues.count;
void widePrefixedCount;
void widePrefixedText;

// Exported invocation types also accept unions of differently sized tuples.
import type { CliInvocationSuccess } from '../../src/index.ts';
type TupleUnion = readonly [typeof branchA] | readonly [typeof branchA, typeof branchB];
type TupleUnionReady = CliInvocationSuccess<{ readonly name: 'tuple'; readonly commands: TupleUnion }>;
const tupleUnionB = null as unknown as Extract<TupleUnionReady, { commandKey: 'tuple b' }>;
const tupleUnionLabel: string = tupleUnionB.optionValues.label;
// @ts-expect-error tuple union branch b does not acquire branch a options
const tupleUnionCount: number = tupleUnionB.optionValues.count;
void tupleUnionLabel;
void tupleUnionCount;

// Non-slot array metadata cannot manufacture invokable command branches.
type CommandsWithMetadata = readonly [typeof branchA] & { readonly metadata: typeof branchB };
type MetadataReady = CliInvocationSuccess<{ readonly name: 'metadata'; readonly commands: CommandsWithMetadata }>;
type PhantomCommand = Extract<MetadataReady, { commandKey: 'metadata b' }>;
const noPhantomCommand: [PhantomCommand] extends [never] ? true : false = true;
void noPhantomCommand;
