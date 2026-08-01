import { dispatchCli } from '@ismail-elkorchi/cli-core';
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
  const cursor = Number(argv[0]);
  if (!Number.isInteger(cursor) || cursor < 0) {
    await writeIfPresent(input.host.writeStderr, 'Completion cursor must be a non-negative integer.');
    input.host.setExitCode(2);
    return 2;
  }
  const candidates = completeCliWords(input.cli, {
    words: argv.slice(1),
    cursor,
    ...(input.provideValues === undefined ? {} : { provideValues: input.provideValues })
  });
  await writeIfPresent(
    input.host.writeStdout,
    candidates.map((candidate) => candidate.value).join('\n')
  );
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

  try {
    const output = await dispatchCli(invocation, input.handlers, input.context);
    return applyOutput(input.host, output);
  } catch (error) {
    await writeIfPresent(input.host.writeStderr, error instanceof Error ? error.message : 'Command failed.');
    input.host.setExitCode(1);
    return 1;
  }
}

/** Formats structured diagnostics as concise lines for a terminal. */
export function formatCliDiagnostics(diagnostics: readonly CliDiagnostic[]): string {
  return diagnostics.map((diagnostic) => {
    const context = [
      'argvIndex' in diagnostic ? `argv=${String(diagnostic.argvIndex)}` : undefined,
      'valueArgvIndex' in diagnostic
        ? `value-argv=${String(diagnostic.valueArgvIndex)}`
        : undefined,
      'offset' in diagnostic && diagnostic.offset !== undefined
        ? `offset=${String(diagnostic.offset)}`
        : undefined,
      'rawValue' in diagnostic ? `value=${diagnostic.rawValue}` : undefined,
      'commandPath' in diagnostic
        ? `command=${diagnostic.commandPath.join(' ')}`
        : undefined,
      'suggestions' in diagnostic && diagnostic.suggestions !== undefined
        ? `suggestions=${diagnostic.suggestions.join(',')}`
        : undefined
    ].filter((entry): entry is string => entry !== undefined);
    return `${diagnostic.code}: ${diagnostic.message}${context.length === 0 ? '' : ` [${context.join(' ')}]`}`;
  }).join('\n');
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
