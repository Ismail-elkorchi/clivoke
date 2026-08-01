import {
  completeCli,
  findCliCommand,
  type CliCompletion as CoreCompletion
} from '@ismail-elkorchi/cli-core';
import { runtimeFor } from './definition.ts';
import type {
  Cli,
  CliCompletion,
  CliCompletionRequest,
  CliDefinition,
  CliShell
} from './public-types.ts';

/** Returns grammar-aware completion candidates without invoking a shell. */
export function completeCliWords<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  request: CliCompletionRequest
): readonly CliCompletion[] {
  const normalized = normalizeRequest(cli, request);
  if (normalized.argv.includes('--')) return Object.freeze([]);
  const runtime = runtimeFor(cli);
  const route = runtime.invocationParser.route(cli.program, { argv: normalized.argv });
  const command = route.command;
  const parser = runtime.optionParsers.get(command.key);
  if (parser === undefined) throw new TypeError(`Missing option parser for command ${command.key}.`);
  const scan = parser.scan({ argv: normalized.argv, flagPlacement: 'interspersed' });
  const currentIndex = normalized.argv.length - 1;
  const activeValue = findActiveValue(scan.options, currentIndex);
  if (activeValue !== undefined) {
    const attachedPrefix = activeValue.inline === true
      ? normalized.current.slice(0, normalized.current.length - activeValue.rawValue.length)
      : '';
    const candidates = completeCli(cli.program, {
      commandPath: command.path,
      option: activeValue.option,
      prefix: activeValue.rawValue
    }) ?? [];
    const supplied = request.provideValues?.({
      kind: 'option-value',
      commandPath: command.path,
      option: activeValue.option,
      prefix: activeValue.rawValue
    }) ?? [];
    return mergeValueCandidates(
      activeValue.option,
      activeValue.rawValue,
      attachedPrefix,
      candidates,
      supplied
    );
  }

  const specifiedOptions = Object.create(null) as Record<string, boolean>;
  for (const option of command.options) specifiedOptions[option.name] = false;
  for (const option of scan.options) specifiedOptions[option.option] = true;
  const coreCandidates = completeCli(cli.program, {
    commandPath: command.path,
    prefix: normalized.current,
    includeHidden: request.includeHidden ?? false,
    specifiedOptions
  }) ?? [];
  const positional = activePositional(
    command.path,
    cli,
    scan.arguments,
    route.status === 'routed' ? route.commandIndexes : [],
    currentIndex
  );
  if (positional === undefined || request.provideValues === undefined) {
    return Object.freeze(coreCandidates);
  }
  const supplied = request.provideValues({
    kind: 'positional',
    commandPath: command.path,
    positional,
    prefix: normalized.current
  });
  return Object.freeze([
    ...coreCandidates,
    ...uniqueMatching(supplied, normalized.current).map((value) => Object.freeze({
      kind: 'positional-value' as const,
      value,
      positional
    }))
  ]);
}

function findActiveValue(
  options: readonly {
    readonly option: string;
    readonly rawValue?: string;
    readonly valueArgvIndex?: number;
    readonly inline?: boolean;
  }[],
  currentIndex: number
): {
  readonly option: string;
  readonly rawValue: string;
  readonly valueArgvIndex: number;
  readonly inline?: boolean;
} | undefined {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    const option = options[index];
    if (option?.valueArgvIndex === currentIndex && option.rawValue !== undefined) {
      return {
        option: option.option,
        rawValue: option.rawValue,
        valueArgvIndex: option.valueArgvIndex,
        ...(option.inline === undefined ? {} : { inline: option.inline })
      };
    }
  }
  return undefined;
}

/** Generates a script that calls a dedicated completion executable. */
export function createCompletionScript<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  shell: CliShell,
  completionExecutable = `${cli.program.name}-complete`
): string {
  const program = shellQuote(cli.program.name);
  const executable = shellQuote(completionExecutable);
  const identifier = shellIdentifier(cli.program.name);
  if (shell === 'fish') {
    return `function __${identifier}_complete\n  set -l words (commandline -opc)\n  set -l current (commandline -ct)\n  ${executable} (count $words) $words $current\nend\ncomplete -c ${program} -f -a '(__${identifier}_complete)'\n`;
  }
  if (shell === 'pwsh') {
    return `Register-ArgumentCompleter -Native -CommandName ${powerShellQuote(cli.program.name)} -ScriptBlock {\n  param($wordToComplete, $commandAst, $cursorPosition)\n  $words = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })\n  $current = [Math]::Max(0, $words.Count - 1)\n  if ($words.Count -eq 0) { $words = @($wordToComplete) } else { $words[$current] = $wordToComplete }\n  & ${powerShellQuote(completionExecutable)} $current @words\n}\n`;
  }
  if (shell === 'zsh') {
    return `#compdef ${cli.program.name}\n_${identifier}() {\n  local output\n  local -a request_words candidates\n  request_words=("\${words[@]}")\n  request_words[$CURRENT]="$PREFIX"\n  output="$(${executable} "$((CURRENT - 1))" "\${request_words[@]}")"\n  candidates=("\${(@f)output}")\n  compadd -- "\${candidates[@]}"\n}\ncompdef _${identifier} ${program}\n`;
  }
  return `_${identifier}() { mapfile -t COMPREPLY < <(${executable} "$COMP_CWORD" "\${COMP_WORDS[@]}"); }\ncomplete -F _${identifier} ${program}\n`;
}

function normalizeRequest<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  request: CliCompletionRequest
): { readonly argv: readonly string[]; readonly current: string } {
  const words = Object.freeze([...request.words]);
  const cursor = clampCursor(
    request.cursor ?? Math.max(0, words.length - 1),
    words.length
  );
  const start = words[0] === cli.program.name ? 1 : 0;
  const current = cursor < words.length ? words[cursor] ?? '' : '';
  const before = words.slice(start, Math.max(start, cursor));
  return {
    argv: Object.freeze([...before, current]),
    current
  };
}

function activePositional<Definition extends CliDefinition>(
  commandPath: readonly string[],
  cli: Cli<Definition>,
  arguments_: readonly { readonly value: string; readonly argvIndex: number }[],
  commandIndexes: readonly number[],
  currentIndex: number
): string | undefined {
  const command = findCliCommand(cli.program, commandPath);
  if (command === undefined || command.positionals.length === 0) return undefined;
  const commandIndexSet = new Set(commandIndexes);
  const completedCount = arguments_.filter((argument) =>
    !commandIndexSet.has(argument.argvIndex) && argument.argvIndex < currentIndex).length;
  const positional = command.positionals[completedCount] ?? command.positionals.at(-1);
  return positional?.variadic === true || completedCount < command.positionals.length
    ? positional?.name
    : undefined;
}

function mergeValueCandidates(
  option: string,
  prefix: string,
  attachedPrefix: string,
  core: readonly CoreCompletion[],
  supplied: readonly string[]
): readonly CliCompletion[] {
  const values = uniqueMatching([
    ...core.map((candidate) => candidate.value),
    ...supplied
  ], prefix);
  return Object.freeze(values.map((value) => Object.freeze({
    kind: 'option-value' as const,
    value: `${attachedPrefix}${value}`,
    option
  })));
}

function uniqueMatching(values: readonly string[], prefix: string): readonly string[] {
  return Object.freeze([...new Set(values.filter((value) => value.startsWith(prefix)))]);
}

function clampCursor(cursor: number, length: number): number {
  if (!Number.isFinite(cursor)) return length;
  return Math.max(0, Math.min(length, Math.trunc(cursor)));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function shellIdentifier(value: string): string {
  const identifier = value.replaceAll(/[^A-Za-z0-9_]/gu, '_');
  return identifier.length === 0 ? 'cli' : identifier;
}
