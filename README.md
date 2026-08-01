# Clivoke

Turn one typed command definition into parsed invocations, help, completion,
and explicit execution for Node, Deno, and Bun.

The package provides the small end-to-end CLI layer between raw arguments and
application handlers. Internally, `argv-flags` owns token grammar and typed
option values, while `cli-core` owns command routing, positionals, help,
completion candidates, and dispatch. This package owns their integration plus
explicit process and shell adapters.

It is not a prompt toolkit, terminal UI, configuration system, plugin host, or
effects framework.

## Install

```sh
npm install clivoke
deno add jsr:@ismail-elkorchi/clivoke
```

## Define and parse a CLI

```ts
import { createCli, value } from "clivoke";

const cli = createCli({
  name: "ship",
  version: "1.0.0",
  options: {
    verbose: {
      type: "boolean",
      flags: ["-v", "--verbose"],
      falseFlags: ["--no-verbose"],
    },
  },
  commands: [
    {
      name: "deploy",
      aliases: ["d"],
      options: {
        region: {
          type: value.choice(["eu", "us"]),
          flags: ["-r", "--region"],
          required: true,
        },
      },
      positionals: [{ name: "service" }],
      acceptsAfterDoubleDash: true,
    },
  ],
});

const result = cli.parse({
  argv: ["-v", "deploy", "--region=eu", "api", "--", "--watch"],
});

if (result.status === "parsed") {
  console.log(result.optionValues.region); // "eu"
  console.log(result.positionalValues.service); // "api"
  console.log(result.afterDoubleDash); // ["--watch"]
} else {
  console.error(result.diagnostics);
}
```

Global values retain their inferred types. Command-local values are optional
until runtime command selection is known. Failed results expose diagnostics,
not partial values or defaults. Unknown flags can be rejected or collected with
their complete argv index.

The option grammar is the `argv-flags` grammar: long flags, attached values,
short clusters, explicit false flags, scalar repetition policies, multiple
values, count options, `--`, and interspersed flags.

## Run through an explicit process host

```ts
import {
  createProcessCliHost,
  runCliMain,
} from "clivoke";

await runCliMain({
  cli,
  host: createProcessCliHost(process),
  handlers: {
    "ship deploy": ({ invocation }) => ({
      stdout: `deploying ${String(invocation.positionalValues.service)}`,
    }),
  },
  context: undefined,
});
```

`runCliMain` writes only through the supplied host and sets an exit code without
calling `process.exit()`. `createDenoCliHost(Deno)` provides the corresponding
Deno adapter. Handler output is intentionally small: stdout text, stderr text,
and an exit code. Application services belong in the handler context.

## Help and completion

```ts
import {
  completeCliWords,
  createCliHelp,
  createCompletionScript,
} from "clivoke";

const help = createCliHelp(cli, ["deploy"]);
const candidates = completeCliWords(cli, {
  words: ["ship", "__complete", "deploy", "--r"],
});
const bash = createCompletionScript(cli, "bash");
```

Help remains renderer-neutral. Completion scripts are available for Bash, Zsh,
Fish, and PowerShell and delegate candidate generation back to the CLI. No
files or shell profiles are modified by this package.

## Runtime support

- ESM only
- Node.js 24 or later
- Deno 2.6 or later
- Bun 1.3 or later
- Two focused runtime dependencies: `@ismail-elkorchi/cli-core` and
  `argv-flags`

## License

MIT
