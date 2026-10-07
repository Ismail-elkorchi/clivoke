import { CliHandlerNotFoundError, dispatchCli } from '@ismail-elkorchi/cli-core';
import { completeCliWords } from './completion.ts';
import { runtimeFor } from './definition.ts';
import { createCliHelp, formatCliHelp } from './help.ts';
import { isTerminalSafe, sanitizeTerminalText } from './terminal.ts';
import type {
  CliCompletionMainInput,
  CliDiagnostic,
  CliDefinition,
  CliMainHost,
  CliMainInput,
  CliMainFailure,
  CliMainPresentation,
  CliMainOutput,
  DenoLike,
  ProcessLike,
  ProcessOutput
} from './public-types.ts';

/** Runs the explicit protocol used by a dedicated completion executable. */
export async function runCliCompletion<Definition extends CliDefinition>(
  input: CliCompletionMainInput<Definition>
): Promise<number> {
  const argv = input.argv ?? input.host.argv;
  const output = argv[0];
  if (output !== 'lines' && output !== 'jsonl') {
    await writeIfPresent((text) => input.host.writeStderr(text), 'Completion output must be lines or jsonl.');
    input.host.setExitCode(2);
    return 2;
  }
  const cursor = Number(argv[1]);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > argv.length - 2) {
    await writeIfPresent(
      (text) => input.host.writeStderr(text),
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
  await writeIfPresent((text) => input.host.writeStdout(text), output === 'jsonl'
    ? candidates.map((candidate) => JSON.stringify(candidate)).join('\n')
    : candidates
        .map((candidate) => candidate.value)
        .filter(isTerminalSafe)
        .join('\n'));
  input.host.setExitCode(0);
  return 0;
}

/** Runs one explicit argv vector through parsing and command dispatch. */
export async function runCliMain<Definition extends CliDefinition, Context>(
  input: CliMainInput<Definition, Context>
): Promise<number> {
  const argv = input.argv ?? input.host.argv;
  const { result: invocation, inspection } = runtimeFor(input.cli).parseDetailed({ argv });
  const presentation: CliMainPresentation<Definition, Context> = Object.freeze({
    cli: input.cli,
    context: input.context,
    result: invocation as CliMainPresentation<Definition, Context>['result'],
    inspection
  });
  const observe = async (failure: CliMainFailure): Promise<void> => {
    // Telemetry must not replace the original failure or become an output hook.
    try { await input.observeFailure?.(failure); } catch { /* observer isolation */ }
  };
  const deliver = async (output: CliMainOutput | void, final = true): Promise<number> => {
    try {
      return await applyOutput(input.host, output, final);
    } catch (error) {
      await observe({ kind: 'output', error });
      try { input.host.setExitCode(1); } catch { /* preserve output failure */ }
      throw error;
    }
  };
  if (invocation.status === 'help') {
    const help = createCliHelp(input.cli, invocation.commandPath);
    if (help === undefined) throw new TypeError('Help action selected an unknown command.');
    const output = input.renderHelp === undefined
      ? { stdout: formatCliHelp(help) }
      : await input.renderHelp(help, presentation);
    return deliver(output);
  }
  if (invocation.status === 'version') {
    const output = input.renderVersion === undefined
      ? { stdout: sanitizeTerminalText(`${input.cli.name} ${invocation.version}`) }
      : await input.renderVersion(invocation.version, presentation);
    return deliver(output);
  }
  if (invocation.status === 'invalid') {
    const output = input.renderInvalid === undefined
      ? { stderr: formatCliDiagnostics(invocation.diagnostics), exitCode: 2 }
      : await input.renderInvalid(invocation, presentation);
    return deliver(output);
  }
  const ready = invocation as Extract<CliMainPresentation<Definition, Context>['result'], { status: 'ready' }>;
  if (ready.diagnostics.length > 0) {
    const warning = input.renderWarnings === undefined
      ? { stderr: formatCliDiagnostics(ready.diagnostics) }
      : await input.renderWarnings(ready, presentation);
    if (Object.hasOwn(warning, 'exitCode')) {
      throw new TypeError('Warning renderers may only produce stdout and stderr.');
    }
    await deliver(warning, false);
  }
  let output: CliMainOutput | void;
  try {
    output = await dispatchCli(ready, input.handlers, input.context);
  } catch (error) {
    const failure: Exclude<CliMainFailure, { kind: 'output' }> = error instanceof CliHandlerNotFoundError
      ? { kind: 'missing-handler', commandKey: error.commandKey, error }
      : { kind: 'unexpected', error };
    await observe(failure);
    try {
      output = input.renderFailure === undefined
        ? {
            stderr: failure.kind === 'missing-handler'
              ? 'No handler is registered for the selected command.'
              : 'Command failed.',
            exitCode: 1
          }
        : await input.renderFailure(failure, presentation);
      return await deliver(output);
    } catch (reportingError) {
      throw new AggregateError([error, reportingError], 'Command failed and its failure could not be reported.', {
        cause: reportingError
      });
    }
  }
  // Delivery happens outside the dispatch catch: effects already happened and
  // an output failure must neither rerun them nor become a handler failure.
  return deliver(output);
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

/** Adapts a Node/Bun-like process object without importing runtime modules. */
export function createProcessCliHost(processLike: ProcessLike): CliMainHost {
  return Object.freeze({
    argv: Object.freeze(processLike.argv.slice(2)),
    writeStdout(text: string): Promise<void> {
      return writeProcessStream(processLike.stdout, text);
    },
    writeStderr(text: string): Promise<void> {
      return writeProcessStream(processLike.stderr, text);
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
      await writeDenoStream(deno.stdout, encoder.encode(text));
    },
    async writeStderr(text: string): Promise<void> {
      await writeDenoStream(deno.stderr, encoder.encode(text));
    },
    setExitCode(exitCode: number): void {
      deno.exitCode = exitCode;
    }
  });
}

function writeProcessStream(stream: ProcessOutput, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => { reject(error); };
    stream.once('error', failed);
    try {
      stream.write(text, (error) => {
        if (error !== undefined && error !== null) {
          // Node emits error after calling the failed write callback. Keep the
          // once listener to consume that event rather than crashing the process.
          reject(error);
        } else {
          stream.removeListener('error', failed);
          resolve();
        }
      });
    } catch (error) {
      stream.removeListener('error', failed);
      reject(error);
    }
  });
}

async function writeDenoStream(
  stream: DenoLike['stdout'],
  bytes: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await stream.write(bytes.subarray(offset));
    if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) {
      throw new Error('Output writer did not make valid progress.');
    }
    offset += written;
  }
}

async function applyOutput(
  host: CliMainHost,
  output: CliMainOutput | void,
  final = true
): Promise<number> {
  await writeIfPresent((text) => host.writeStdout(text), output?.stdout);
  await writeIfPresent((text) => host.writeStderr(text), output?.stderr);
  const exitCode = output?.exitCode ?? 0;
  if (final) host.setExitCode(exitCode);
  return exitCode;
}

function writeIfPresent(
  write: (text: string) => void | Promise<void>,
  text: string | undefined
): void | Promise<void> {
  if (text === undefined || text.length === 0) return undefined;
  return write(text.endsWith('\n') ? text : `${text}\n`);
}
