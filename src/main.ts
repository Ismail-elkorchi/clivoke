import { CliHandlerNotFoundError, dispatchCli } from '@ismail-elkorchi/cli-core';
import { completeCliWords } from './completion.ts';
import type {
  CliCompletionMainInput,
  CliDiagnostic,
  CliDefinition,
  CliMainHost,
  CliMainInput,
  CliMainOutput,
  DenoLike,
  ProcessLike
} from './public-types.ts';

/** Runs the explicit protocol used by a dedicated completion executable. */
export async function runCliCompletion<Definition extends CliDefinition>(
  input: CliCompletionMainInput<Definition>
): Promise<number> {
  const argv = input.argv ?? input.host.argv;
  const output = argv[0];
  if (output !== 'lines' && output !== 'jsonl') {
    await writeIfPresent(input.host.writeStderr, 'Completion output must be lines or jsonl.');
    input.host.setExitCode(2);
    return 2;
  }
  const cursor = Number(argv[1]);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > argv.length - 2) {
    await writeIfPresent(
      input.host.writeStderr,
      'Completion cursor must identify a supplied word or an empty trailing word.'
    );
    input.host.setExitCode(2);
    return 2;
  }
  const candidates = await completeCliWords(input.cli, {
    words: argv.slice(2),
    cursor,
    ...(input.provideValues === undefined ? {} : { provideValues: input.provideValues })
  });
  await writeIfPresent(input.host.writeStdout, output === 'jsonl'
    ? candidates.map((candidate) => JSON.stringify(candidate)).join('\n')
    : candidates
        .map((candidate) => candidate.value)
        .filter(isLineSafe)
        .join('\n'));
  input.host.setExitCode(0);
  return 0;
}

/** Runs one explicit argv vector through parsing and command dispatch. */
export async function runCliMain<Definition extends CliDefinition, Context>(
  input: CliMainInput<Definition, Context>
): Promise<number> {
  const argv = input.argv ?? input.host.argv;
  const invocation = input.cli.parse({ argv });
  if (invocation.status === 'invalid') {
    const format = input.formatDiagnostics ?? formatCliDiagnostics;
    await writeIfPresent(input.host.writeStderr, format(invocation.diagnostics));
    input.host.setExitCode(2);
    return 2;
  }

  if (invocation.diagnostics.length > 0) {
    const format = input.formatDiagnostics ?? formatCliDiagnostics;
    await writeIfPresent(input.host.writeStderr, format(invocation.diagnostics));
  }
  try {
    const output = await dispatchCli(invocation, input.handlers, input.context);
    return applyOutput(input.host, output);
  } catch (error) {
    if (error instanceof CliHandlerNotFoundError) {
      await input.observeFailure?.({
        kind: 'missing-handler',
        commandKey: error.commandKey,
        error
      });
      await writeIfPresent(input.host.writeStderr, 'No handler is registered for the selected command.');
    } else {
      await input.observeFailure?.({ kind: 'unexpected', error });
      await writeIfPresent(input.host.writeStderr, 'Command failed.');
    }
    input.host.setExitCode(1);
    return 1;
  }
}

/** Formats structured diagnostics as concise lines for a terminal. */
export function formatCliDiagnostics(diagnostics: readonly CliDiagnostic[]): string {
  return diagnostics.map((diagnostic) => {
    const sensitive = 'sensitive' in diagnostic && diagnostic.sensitive === true;
    const context = [
      'argvIndex' in diagnostic ? `argv=${String(diagnostic.argvIndex)}` : undefined,
      'valueArgvIndex' in diagnostic
        ? `value-argv=${String(diagnostic.valueArgvIndex)}`
        : undefined,
      'offset' in diagnostic && diagnostic.offset !== undefined
        ? `offset=${String(diagnostic.offset)}`
        : undefined,
      'commandPath' in diagnostic
        ? `command=${sanitizeTerminalText(diagnostic.commandPath.join(' '))}`
        : undefined,
      !sensitive && 'suggestions' in diagnostic && diagnostic.suggestions !== undefined
        ? `suggestions=${diagnostic.suggestions.map(sanitizeTerminalText).join(',')}`
        : undefined
    ].filter((entry): entry is string => entry !== undefined);
    const message = sensitive && 'rawValue' in diagnostic
      ? 'Invalid value for sensitive option.'
      : diagnostic.message;
    return `${sanitizeTerminalText(diagnostic.code)}: ${sanitizeTerminalText(message)}${
      context.length === 0 ? '' : ` [${context.join(' ')}]`}`;
  }).join('\n');
}

function sanitizeTerminalText(value: string): string {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character)
      ? `\\u{${codePoint.toString(16).padStart(4, '0')}}`
      : character;
  }).join('');
}

function isLineSafe(value: string): boolean {
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

/** Adapts a Node/Bun-like process object without importing runtime modules. */
export function createProcessCliHost(processLike: ProcessLike): CliMainHost {
  return Object.freeze({
    argv: Object.freeze(processLike.argv.slice(2)),
    writeStdout(text: string): void {
      processLike.stdout.write(text);
    },
    writeStderr(text: string): void {
      processLike.stderr.write(text);
    },
    setExitCode(exitCode: number): void {
      processLike.exitCode = exitCode;
    }
  });
}

/** Adapts a Deno-like global without importing runtime modules. */
export function createDenoCliHost(deno: DenoLike): CliMainHost {
  const encoder = new TextEncoder();
  return Object.freeze({
    argv: Object.freeze([...deno.args]),
    async writeStdout(text: string): Promise<void> {
      await deno.stdout.write(encoder.encode(text));
    },
    async writeStderr(text: string): Promise<void> {
      await deno.stderr.write(encoder.encode(text));
    },
    setExitCode(exitCode: number): void {
      deno.exitCode = exitCode;
    }
  });
}

function applyOutput(host: CliMainHost, output: CliMainOutput | void): number | Promise<number> {
  const exitCode = output?.exitCode ?? 0;
  const writes = [
    writeIfPresent(host.writeStdout, output?.stdout),
    writeIfPresent(host.writeStderr, output?.stderr)
  ];
  if (writes.every((write) => write === undefined)) {
    host.setExitCode(exitCode);
    return exitCode;
  }
  return Promise.all(writes).then(() => {
    host.setExitCode(exitCode);
    return exitCode;
  });
}

function writeIfPresent(
  write: (text: string) => void | Promise<void>,
  text: string | undefined
): void | Promise<void> {
  if (text === undefined || text.length === 0) return undefined;
  return write(text.endsWith('\n') ? text : `${text}\n`);
}
