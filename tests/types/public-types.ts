import {
  completeCliWords,
  createCli,
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
