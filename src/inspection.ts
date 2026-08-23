import { runtimeFor } from './definition.ts';
import type {
  Cli,
  CliArgvInspection,
  CliDefinition
} from './public-types.ts';

/** Classifies raw argv with the CLI's actual grammar without decoding values. */
export function inspectCliArgv<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  input: readonly string[]
): CliArgvInspection {
  const argv = freezeStringArray(input);
  const runtime = runtimeFor(cli);
  const route = runtime.invocationParser.route(runtime.program, { argv });
  const command = route.command;
  const parser = runtime.optionParsers.get(command.key);
  if (parser === undefined) throw new TypeError(`Missing option parser for command ${command.key}.`);
  const scan = parser.scan({ argv, flagPlacement: 'interspersed' });
  const commandIndexes = route.status === 'routed'
    ? route.commandIndexes
    : scan.arguments.slice(0, command.path.length).map((argument) => argument.argvIndex);
  const commandIndexSet = new Set(commandIndexes);
  return Object.freeze({
    argv,
    commandPath: command.path,
    options: scan.options,
    positionalArguments: Object.freeze(scan.arguments.filter((argument) =>
      !commandIndexSet.has(argument.argvIndex))),
    passthroughArguments: scan.afterDoubleDash,
    unknownFlags: scan.unknownFlags,
    ...(scan.doubleDashIndex === undefined ? {} : { doubleDashIndex: scan.doubleDashIndex })
  });
}

function freezeStringArray(input: unknown): readonly string[] {
  if (!Array.isArray(input)) throw new TypeError('CLI argv must be an array of strings.');
  const output: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, index);
    if (descriptor === undefined || !('value' in descriptor) ||
        typeof descriptor.value !== 'string') {
      throw new TypeError('CLI argv must be a dense array of strings.');
    }
    output.push(descriptor.value);
  }
  if (!Reflect.ownKeys(input).every((property) => property === 'length' || (
    typeof property === 'string' && /^(?:0|[1-9]\d*)$/u.test(property) &&
    Number(property) < input.length
  ))) {
    throw new TypeError('CLI argv must be a dense array of strings.');
  }
  return Object.freeze(output);
}
