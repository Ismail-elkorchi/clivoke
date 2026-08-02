# Clivoke

Build type-safe command-line applications for Node, Deno, and Bun from one
definition.

Clivoke keeps parsing, command routing, validation, help, completion,
programmatic invocation, and dispatch aligned. Command-specific options and
positionals remain connected to their handlers throughout the TypeScript API.

## Install

```sh
npm install clivoke
deno add jsr:@ismail-elkorchi/clivoke
```

## Quick start

```ts
import { createCli, value } from "clivoke";

const cli = createCli({
  name: "ship",
  invokable: false,
  options: {
    verbose: {
      type: "boolean",
      flags: ["-v", "--verbose"],
      falseFlags: ["--no-verbose"],
      default: false,
    },
  },
  commands: [{
    name: "deploy",
    aliases: ["d"],
    description: "Deploy one service.",
    options: {
      region: {
        type: value.choice(["eu", "us"]),
        flags: ["-r", "--region"],
        required: true,
      },
    },
    positionals: [{ name: "service" }],
    acceptsPassthroughArguments: true,
  }],
});

const result = cli.parse({
  argv: ["-v", "deploy", "--region=eu", "api", "--", "--watch"],
});

if (result.status === "ready" && result.commandKey === "ship deploy") {
  console.log(result.optionValues.region); // "eu"
  console.log(result.positionalValues.service); // "api"
  console.log(result.passthroughArguments); // ["--watch"]
} else if (result.status === "invalid") {
  console.error(result.diagnostics);
}
```

`createCli()` returns an immutable compiled CLI with a stable `name`, `parse()`,
and `invoke()` API. Definitions and parse settings are closed in TypeScript and
validated at runtime.

## Commands and values

The `commandKey` property discriminates successful invocations. Narrowing it to
`"ship deploy"` gives exact types for that command's options and positionals.
Required local options are required in their command branch, and equal option
names on sibling commands retain their distinct value types.

Root options are global. Options declared by a command are inherited by its
descendants, and command-local flags follow the command that declares them.
Root and child commands can define positionals and accept post-`--` arguments.
Set `invokable: false` on a command that groups child commands.

Invalid results contain structured diagnostics and unknown flags. Successful
values are available on ready results.

## Programmatic invocation

Use `cli.invoke()` when an HTTP endpoint, graphical interface, test, or another
adapter already has decoded values:

```ts
const invocation = cli.invoke({
  sourceId: "deployment-api",
  commandPath: ["deploy"],
  optionValues: { verbose: false, region: "eu" },
  specifiedOptions: { verbose: false, region: true },
  positionalValues: { service: "api" },
  passthroughArguments: [],
});
```

The input and result narrow by `commandPath` and use the same required-option,
positional, and passthrough rules as argv parsing.

## Run commands

```ts
import { createProcessCliHost, runCliMain } from "clivoke";

await runCliMain({
  cli,
  host: createProcessCliHost(process),
  handlers: {
    "ship deploy": ({ invocation }) => ({
      stdout: `deploying ${invocation.positionalValues.service}`,
    }),
  },
  context: undefined,
});
```

Handler keys are restricted to invokable canonical command keys, and every
handler receives its command's exact invocation type. `runCliMain()` applies
handler output through the supplied host and sets the exit code.
`createDenoCliHost(Deno)` provides the equivalent Deno host.

## Help and completion

```ts
import { completeCliWords, createCliHelp } from "clivoke";

const help = createCliHelp(cli, ["deploy"]);
const candidates = await completeCliWords(cli, {
  words: ["ship", "deploy", "--region", "e"],
  cursor: 3,
});
```

Help includes aliases, false flags, defaults, repetition, multiplicity, finite
choices, and positional metadata. Unknown command paths return `undefined`.

Completion distinguishes command names, flags, option values, positional
slots, and post-`--` input. Finite choices are suggested automatically.
Asynchronous value providers receive the command path and an immutable partial
invocation, enabling context-aware option, positional, and passthrough values.

`createCompletionScript()` generates Bash, Zsh, Fish, or PowerShell glue for a
dedicated companion executable, named `<program>-complete` by default.
`runCliCompletion()` implements that executable with newline or JSON-lines
output. JSON lines retain candidate metadata and safely represent values that
contain newlines.

## Diagnostics and failures

Set `sensitive: true` on a value option to redact its explicit value, parser
message, and suggestions from default terminal diagnostics. The formatter also
escapes terminal control characters. Applications retain access to structured
diagnostics for custom rendering.

Successful deprecation warnings are rendered before dispatch. Expected
application failures are returned as `CliMainOutput`. Unexpected errors receive
a stable terminal message and can be observed through `observeFailure` for
deliberate logging or telemetry.

## Runtime support

- ESM
- Node.js 24 or later
- Deno 2.6 or later
- Bun 1.3 or later

## License

MIT
