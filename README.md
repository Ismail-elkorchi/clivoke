# Clivoke

Define, parse, complete, and invoke a typed command-line interface on Node,
Deno, or Bun.

Clivoke combines two independently useful packages: `argv-flags` owns raw
option grammar and typed values, while `@ismail-elkorchi/cli-core` owns command
semantics, positionals, help, completion data, and dispatch. Clivoke owns the
command-aware argv integration and explicit process and shell adapters.

It is intentionally not a prompt toolkit, TUI, configuration system, plugin
host, or effects framework.

## Install

```sh
npm install clivoke
deno add jsr:@ismail-elkorchi/clivoke
```

## Define and parse

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

`commandKey` is the discriminant for command-specific option and positional
types. Required local options are required only in their command branch, and
the same option name on sibling commands keeps its branch-specific type.
Failed results contain structured diagnostics and unknown flags, never partial
values or defaults.

Global and ancestor options are inherited by descendants. A command-local
option must follow the command that defines it. Root positionals and root
passthrough arguments are supported. Set `invokable: false` on the root or a
command that only groups child commands. A command cannot define both children
and positionals because child names would otherwise be ambiguous with
positional values.

Use `cli.invoke()` when an HTTP handler, TUI, test, or another adapter already
has decoded values. Its input and result are narrowed by `commandPath` and go
through the same command, required-option, positional, and passthrough
validation as argv input.

## Dispatch

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

Handler keys are restricted to canonical command keys, and each handler gets
its command's exact invocation type. `runCliMain()` writes only through the
supplied host and sets an exit code without calling `process.exit()`.
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

Help retains explicit false flags, defaults, repetition, multiplicity, and
finite choices. Unknown help paths return `undefined`.

Completion distinguishes command names, flags, option values, positional
slots, and post-`--` input. `value.choice()` values are suggested automatically.
Dynamic providers may be asynchronous and receive the command path plus an
immutable scan of the partial invocation. Already-used scalar options that
reject repetition are omitted.

`createCompletionScript()` generates Bash, Zsh, Fish, or PowerShell glue for a
dedicated companion executable (by default `<program>-complete`). Implement
that executable with `runCliCompletion()`. Generated shell adapters use the
newline value format; other callers can request JSON lines to preserve complete
candidate metadata and values containing newlines. Keeping completion separate
avoids reserving a command name in the user's CLI. No shell profiles or files
are modified.

## Diagnostics and failures

Set `sensitive: true` on an option whose explicit value must not appear in
default diagnostic output. The default formatter never prints raw option
values and escapes terminal control characters. Structured diagnostics still
retain their fields for an application-supplied formatter.

`runCliMain()` writes successful deprecation warnings before dispatch. A
handler returns `CliMainOutput` for an expected application failure. A thrown
error is treated as unexpected: terminal output stays generic, while an
optional `observeFailure` callback receives the original error for deliberate
logging or telemetry.

## Runtime support

- ESM only
- Node.js 24 or later
- Deno 2.6 or later
- Bun 1.3 or later
- Runtime dependencies: `argv-flags` and `@ismail-elkorchi/cli-core`

## License

MIT
