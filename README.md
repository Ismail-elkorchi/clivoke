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
  version: "1.2.3",
  invokable: false,
  examples: [{
    usage: "ship deploy api --region eu",
    description: "Deploy the API service in Europe.",
  }],
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
} else if (result.status === "help") {
  console.log(result.commandPath);
} else {
  console.log(result.version);
}
```

`createCli()` returns an immutable compiled CLI with a stable `name`, `parse()`,
and `invoke()` API. Definitions and parse settings are closed in TypeScript and
validated at runtime. Every CLI recognizes `-h`, `--help`, `help`, and
`help <command>`; defining `version` also enables `--version`. A non-invokable
root shows help when invoked without arguments.

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
positional, and passthrough rules as argv parsing. This is a trusted decoded-value
boundary: adapters must validate their domain values before calling `invoke()`;
Clivoke does not run argv value codecs on this input.

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
`createDenoCliHost(Deno)` provides the equivalent Deno host. Both hosts await
complete output delivery. Output failures are observed as `kind: "output"` and
propagate separately from handler failures; handlers are never retried.

Applications can replace the default presentation policy with `renderHelp`,
`renderVersion`, `renderInvalid`, `renderWarnings`, and `renderFailure`. Each
callback receives its corresponding value and a presentation object containing
`cli`, `context`, `result`, and the same grammar-aware `inspection` used by the
parse. Renderers return `CliMainOutput`, synchronously or asynchronously;
`renderWarnings` returns only `stdout` and `stderr`, never an exit code.
`renderFailure` centrally maps application errors to output and exit codes,
replacing the safe default message. `observeFailure` remains telemetry only.
Applications retain ownership of JSON schemas, domain exit codes, progress,
locks, and cancellation. They can also continue to orchestrate `parse()` and
handlers directly.

## Help and completion

```ts
import { completeCliWords, createCliHelp, formatCliHelp } from "clivoke";

const help = createCliHelp(cli, ["deploy"]);
if (help !== undefined) console.log(formatCliHelp(help));
const candidates = await completeCliWords(cli, {
  words: ["ship", "deploy", "--region", "e"],
  cursor: 3,
});
```

Help includes examples and the built-in help and version flags alongside
aliases, required markers, false flags, defaults, repetition, multiplicity,
finite choices, and positional metadata. Unknown command paths return
`undefined`. `cli.parse()` reports help
and version as distinct successful actions before required invocation values
are enforced, while still respecting option values and `--`.

Completion requests use complete logical shell words, including the executable
as the first word; the executable may be a path. Completion distinguishes command
names, flags, option values, positional slots, and post-`--` input. Finite choices are suggested automatically.
Asynchronous value providers receive the command path and an immutable partial
invocation, enabling context-aware option, positional, and passthrough values.

Use `inspectCliArgv(cli, argv)` when application policy must detect a flag on
help, version, or invalid invocations. It returns the command path, recognized
option occurrences, positional and passthrough arguments, and unknown flags
without decoding values or creating a partial successful invocation. Uncertain
syntax remains in `unclassifiedArguments`; inspection does not reinterpret its
suffix using a guessed command scope. Built-in help words are reported in
`controlArguments`. Because
it uses the configured grammar, an argv element such as `--json` is not
misclassified when it is the value of another option.

`createCompletionScript()` generates Bash, Zsh, Fish, or PowerShell glue for a
dedicated companion executable, named `<program>-complete` by default.
`runCliCompletion()` implements that executable with newline or JSON-lines
output. JSON lines retain candidate metadata and safely represent values that
contain newlines.

The generated scripts normalize quoted words and cursor prefixes, and insert
candidate values as literal shell arguments. Bash also joins its `=` and `:`
wordbreak fragments and uses the command-line cursor position rather than `COMP_CWORD`.
All adapters have a literal-word contract: computed variables, substitutions,
globbing, and redirection-dependent argument vectors are not supported. The
adapters never evaluate input to resolve those expressions.
The Bash adapter completes literal simple-command words, including ordinary
single/double quotes and backslash escapes. It returns no candidates when the
prefix contains unquoted redirections or shell expansions instead of guessing
their resulting arguments. Zsh
retains its native cursor behavior: `COMPLETE_IN_WORD` enables separate prefix
and suffix matching; otherwise it completes the whole word. The generated
scripts use the line protocol, which omits values containing control characters;
use the JSON-lines protocol directly when those values or candidate metadata are
needed.

## Diagnostics and failures

Set `sensitive: true` on a value option to redact its explicit value, parser
message, and suggestions from default terminal diagnostics. Sensitive options
also omit automatic raw default labels and finite-choice candidates from help
and completion. An explicit presentation label or application completion provider
remains application-owned. The formatter also
escapes terminal control characters. Applications retain access to structured
diagnostics for custom rendering.

Successful deprecation warnings are rendered before dispatch. Expected
application failures are returned as `CliMainOutput`. Unexpected handler errors receive
a stable terminal message and can be observed through `observeFailure` for
deliberate logging or telemetry.

## Runtime support

- ESM
- Node.js 24 or later
- Deno 2.6 or later
- Bun 1.3 or later

## License

MIT
