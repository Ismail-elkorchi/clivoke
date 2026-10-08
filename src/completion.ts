import {
  completeCli,
  findCliCommand,
  type CliCompletion as CoreCompletion,
  type CliProgram
} from '@ismail-elkorchi/cli-core';
import type { ScannedOption } from 'argv-flags';
import { runtimeFor } from './definition.ts';
import { isPlainRecord, readDenseArray } from './data.ts';
import { inspectCliArgv } from './inspection.ts';
import { shellCompletionScript } from './shell-completion.ts';
import type {
  Cli,
  CliCompletion,
  CliCompletionContext,
  CliCompletionPartialInvocation,
  CliCompletionRequest,
  CliDefinition,
  CliShell
} from './public-types.ts';

type ExactCompletionRequest<Request extends CliCompletionRequest> = Request & Record<
  Exclude<keyof Request, keyof CliCompletionRequest>,
  never
>;

/** Returns grammar-aware completion candidates without invoking a shell. */
export async function completeCliWords<
  Definition extends CliDefinition,
  const Request extends CliCompletionRequest = CliCompletionRequest
>(
  cli: Cli<Definition>,
  input: ExactCompletionRequest<Request>
): Promise<readonly CliCompletion[]> {
  const request = readCompletionRequest(input);
  const normalized = normalizeRequest(request);
  const runtime = runtimeFor(cli);
  const inspection = inspectCliArgv(cli, normalized.argv);
  const command = findCliCommand(runtime.program, inspection.commandPath);
  if (command === undefined) throw new TypeError('Inspection selected an unknown command.');
  const currentIndex = normalized.argv.length - 1;
  const partialInvocation: CliCompletionPartialInvocation = Object.freeze({
    commandPath: command.path,
    words: normalized.words,
    cursor: normalized.cursor,
    argv: normalized.argv,
    options: inspection.options,
    positionalArguments: inspection.positionalArguments,
    passthroughArguments: inspection.passthroughArguments,
    unknownFlags: inspection.unknownFlags,
    unclassifiedArguments: inspection.unclassifiedArguments,
    controlArguments: inspection.controlArguments
  });

  if (inspection.unclassifiedArguments.some((argument) => argument.argvIndex < currentIndex)) {
    return Object.freeze([]);
  }

  if (inspection.doubleDashIndex !== undefined && inspection.doubleDashIndex < currentIndex) {
    if (!command.acceptsPassthroughArguments || request.provideValues === undefined) {
      return Object.freeze([]);
    }
    const supplied = await provideValues(request, {
      kind: 'passthrough',
      commandPath: command.path,
      prefix: normalized.current,
      partialInvocation
    });
    return Object.freeze(uniqueMatching(supplied, normalized.current).map((value) =>
      Object.freeze({ kind: 'passthrough-value' as const, value })));
  }

  const activeValue = findActiveValue(inspection.options, currentIndex);
  if (activeValue !== undefined) {
    const attachedPrefix = activeValue.inline
      ? normalized.current.slice(0, normalized.current.length - activeValue.rawValue.length)
      : '';
    const candidates = completeCli(runtime.program, {
      commandPath: command.path,
      option: activeValue.option,
      prefix: activeValue.rawValue
    }) ?? [];
    const supplied = request.provideValues === undefined ? [] : await provideValues(request, {
      kind: 'option-value',
      commandPath: command.path,
      option: activeValue.option,
      prefix: activeValue.rawValue,
      partialInvocation
    });
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
  for (const option of inspection.options) specifiedOptions[option.option] = true;
  const domainCandidates = completeCli(runtime.program, {
    commandPath: command.path,
    prefix: normalized.current,
    includeHidden: request.includeHidden ?? false,
    specifiedOptions
  }) ?? [];
  const controlCandidates: CliCompletion[] = Object.entries(runtime.controls)
    .filter(([name]) => specifiedOptions[name] !== true)
    .flatMap(([name, option]) => option.flags.filter((flag) => flag.startsWith(normalized.current)).map((flag) =>
      Object.freeze({ kind: 'flag' as const, value: flag, option: name, setsBoolean: true,
        ...(option.description === undefined ? {} : { description: option.description }) })));
  const coreCandidates = [...domainCandidates, ...controlCandidates];
  const positional = activePositional(
    command.path,
    runtime.program,
    inspection.positionalArguments,
    currentIndex
  );
  if (positional === undefined || request.provideValues === undefined) {
    return Object.freeze(coreCandidates);
  }
  const supplied = await provideValues(request, {
    kind: 'positional',
    commandPath: command.path,
    positional,
    prefix: normalized.current,
    partialInvocation
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
  options: readonly ScannedOption[],
  currentIndex: number
): {
  readonly option: string;
  readonly rawValue: string;
  readonly valueArgvIndex: number;
  readonly inline: boolean;
} | undefined {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    const option = options[index];
    if (option?.state === 'explicit-value' && option.valueArgvIndex === currentIndex) {
      return {
        option: option.option,
        rawValue: option.rawValue,
        valueArgvIndex: option.valueArgvIndex,
        inline: option.inline
      };
    }
  }
  return undefined;
}

/** Generates a script that calls a dedicated completion executable. */
export function createCompletionScript<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  shell: CliShell,
  completionExecutable: string = `${cli.name}-complete`
): string {
  if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish' && shell !== 'pwsh') {
    throw new TypeError('Completion shell must be bash, zsh, fish, or pwsh.');
  }
  if (typeof completionExecutable !== 'string' || completionExecutable.length === 0) {
    throw new TypeError('Completion executable must be a non-empty string.');
  }
  return shellCompletionScript(cli.name, shell, completionExecutable);
}

function readCompletionRequest(input: unknown): CliCompletionRequest {
  if (!isPlainRecord(input)) throw new TypeError('Completion request must be a plain object.');
  const values = Object.create(null) as Record<PropertyKey, unknown>;
  for (const property of Reflect.ownKeys(input)) {
    if (property !== 'words' && property !== 'cursor' && property !== 'includeHidden' &&
        property !== 'provideValues') {
      throw new TypeError(`Unknown completion request property ${String(property)}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, property);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`Completion request property ${String(property)} must be a data property.`);
    }
    values[property] = descriptor.value;
  }

  const words = freezeWords(values['words']);
  const cursor = values['cursor'];
  if (cursor !== undefined && (
    typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0 || cursor > words.length
  )) {
    throw new RangeError('Completion cursor must identify a word or an empty trailing word.');
  }
  const includeHidden = values['includeHidden'];
  if (includeHidden !== undefined && typeof includeHidden !== 'boolean') {
    throw new TypeError('Completion includeHidden must be a boolean.');
  }
  const provider = values['provideValues'];
  if (provider !== undefined && typeof provider !== 'function') {
    throw new TypeError('Completion provideValues must be a function.');
  }
  return Object.freeze({
    words,
    ...(cursor === undefined ? {} : { cursor }),
    ...(includeHidden === undefined ? {} : { includeHidden }),
    ...(provider === undefined ? {} : {
      provideValues: provider as NonNullable<CliCompletionRequest['provideValues']>
    })
  });
}

function normalizeRequest(
  request: CliCompletionRequest
): {
  readonly words: readonly string[];
  readonly cursor: number;
  readonly argv: readonly string[];
  readonly current: string;
} {
  const words = request.words;
  const cursor = request.cursor ?? Math.max(0, words.length - 1);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > words.length) {
    throw new RangeError('Completion cursor must identify a word or an empty trailing word.');
  }
  const start = words.length === 0 ? 0 : 1;
  const current = cursor < words.length ? words[cursor] ?? '' : '';
  const before = words.slice(start, Math.max(start, cursor));
  return {
    words,
    cursor,
    argv: Object.freeze([...before, current]),
    current
  };
}

function freezeWords(input: unknown): readonly string[] {
  return freezeStringArray(input, 'Completion words');
}

async function provideValues(
  request: CliCompletionRequest,
  context: CliCompletionContext
): Promise<readonly string[]> {
  const values = await request.provideValues?.(Object.freeze(context)) ?? [];
  return freezeStringArray(values, 'Completion provider results');
}

function freezeStringArray(input: unknown, label: string): readonly string[] {
  const entries = readDenseArray(input);
  if (entries === undefined || entries.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a dense array of strings.`);
  }
  return Object.freeze(entries) as readonly string[];
}

function activePositional(
  commandPath: readonly string[],
  program: CliProgram,
  arguments_: readonly { readonly value: string; readonly argvIndex: number }[],
  currentIndex: number
): string | undefined {
  const command = findCliCommand(program, commandPath);
  if (command === undefined || command.positionals.length === 0) return undefined;
  const completedCount = arguments_.filter((argument) =>
    argument.argvIndex < currentIndex).length;
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
