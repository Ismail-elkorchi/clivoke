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
    acceptsAfterDoubleDash: true,
  }],
});

const result = cli.parse({
  argv: ["-v", "deploy", "--region=eu", "api", "--", "--watch"],
});

if (result.status === "parsed" && result.commandKey === "ship deploy") {
  console.log(result.optionValues.region); // "eu"
  console.log(result.positionalValues.service); // "api"
  console.log(result.afterDoubleDash); // ["--watch"]
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
option must follow the command that defines it. A command cannot define both
children and positionals because child names would otherwise be ambiguous with
positional values.

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
const candidates = completeCliWords(cli, {
  words: ["ship", "deploy", "--region", "e"],
  cursor: 3,
});
```

Help retains explicit false flags, defaults, repetition, multiplicity, and
finite choices. Unknown help paths return `undefined`.

Completion distinguishes command names, flags, option values, and positional
slots. `value.choice()` values are suggested automatically. Supply dynamic
option or positional values with `provideValues`. Already-used scalar options
that reject repetition are omitted.

`createCompletionScript()` generates Bash, Zsh, Fish, or PowerShell glue for a
dedicated companion executable (by default `<program>-complete`). Implement
that executable with `runCliCompletion()`. Keeping completion separate avoids
reserving a command name in the user's CLI. No shell profiles or files are
modified.

## Runtime support

- ESM only
- Node.js 24 or later
- Deno 2.6 or later
- Bun 1.3 or later
- Runtime dependencies: `argv-flags` and `@ismail-elkorchi/cli-core`

## License

MIT
