import { createCli, runCliMain, value } from '../../src/index.ts';

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
if (result.status === 'parsed') {
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
    source: {
      type: 'string',
      flags: ['--source'],
      // @ts-expect-error string defaults must be strings
      default: 1
    }
  }
});
