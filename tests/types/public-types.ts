import { createCli, createCliHelp, runCliMain, value } from '../../src/index.ts';
import {
  // @ts-expect-error low-level command lookup belongs to cli-core
  findCliCommand
} from '../../src/index.ts';

void findCliCommand;

const cli = createCli({
  name: 'ship',
  options: {
    verbose: { type: 'boolean', flags: ['-v'] },
    retries: { type: 'integer', flags: ['--retries'], default: 2 },
    quiet: { type: 'count', flags: ['-q'] }
  },
  commands: [{
    name: 'deploy',
    options: {
      region: { type: value.choice(['eu', 'us']), flags: ['--region'], required: true }
    }
  }]
});

const result = cli.parse({ argv: [] });
createCliHelp(cli);
if (result.status === 'parsed') {
  const verbose: boolean | undefined = result.optionValues.verbose;
  const retries: number = result.optionValues.retries;
  const quiet: number = result.optionValues.quiet;
  const region: 'eu' | 'us' | undefined = result.optionValues.region;
  void verbose;
  void retries;
  void quiet;
  void region;
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
    ship: ({ invocation }) => {
      const retries: number = invocation.optionValues.retries;
      return { stdout: String(retries) };
    }
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
