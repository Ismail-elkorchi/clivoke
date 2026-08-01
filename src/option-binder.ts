import {
  createCliDiagnostic,
  createCliInvocationParser,
  type CliDiagnostic,
  type CliInvocationParser,
  type CliOptionBinder,
  type CliUnknownFlag
} from '@ismail-elkorchi/cli-core';
import {
  createParserFromMap,
  type OptionDefinitionMap,
  type ParseIssue,
  type Parser,
  type UnknownFlag
} from 'argv-flags';
import type { CliOptionDefinition, CliOptionDefinitions } from './public-types.ts';

type RuntimeDefinition<Definition> = Definition extends CliOptionDefinition
  ? Omit<Definition, 'description' | 'hidden' | 'valueLabel'>
  : never;

type RuntimeParser = Parser<OptionDefinitionMap>;

/** Creates a command-aware parser backed by one immutable argv-flags parser per command. */
export function createArgvBinder(definitionsByCommand: ReadonlyMap<string, CliOptionDefinitions>): CliInvocationParser {
  const parsers = new Map<string, RuntimeParser>();
  for (const [commandKey, definitions] of definitionsByCommand) {
    parsers.set(commandKey, compileOptions(definitions));
  }
  const bindOptions: CliOptionBinder = (input) => {
    const parser = parsers.get(input.command.key);
    if (parser === undefined) {
      return {
        status: 'invalid',
        diagnostics: [createCliDiagnostic(
          'CLI_OPTION_BINDER_MISSING',
          'error',
          `No option parser was compiled for ${input.command.key}.`,
          { commandKey: input.command.key }
        )]
      };
    }
    const result = parser.parse({
      argv: input.argv,
      unknownFlagPolicy: 'collect',
      flagPlacement: 'interspersed'
    });
    if (!result.success) {
      return {
        status: 'invalid',
        diagnostics: Object.freeze(result.issues.map((issue) => translateIssue(issue, input.argvIndexes)))
      };
    }
    return {
      status: 'bound',
      values: result.values,
      specified: result.specified,
      positionals: result.positionals,
      afterDoubleDash: result.afterDoubleDash,
      unknownFlags: Object.freeze(result.unknownFlags.map((flag) => translateUnknownFlag(flag, input.argvIndexes)))
    };
  };
  return createCliInvocationParser(bindOptions);
}

function compileOptions(definitions: CliOptionDefinitions): RuntimeParser {
  return createParserFromMap(stripPresentation(definitions));
}

function stripPresentation(definitions: CliOptionDefinitions): OptionDefinitionMap {
  const runtimeDefinitions: Record<string, RuntimeDefinition<CliOptionDefinition>> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const { description: _description, hidden: _hidden, ...parsing } = definition;
    if ('valueLabel' in parsing) {
      const { valueLabel: _valueLabel, ...runtime } = parsing;
      runtimeDefinitions[name] = runtime;
    } else {
      runtimeDefinitions[name] = parsing;
    }
  }
  return Object.freeze(runtimeDefinitions);
}

function translateIssue(issue: ParseIssue, argvIndexes: readonly number[]): CliDiagnostic {
  const { code, message, ...details } = issue;
  return createCliDiagnostic(code, 'error', message, mapLocations(details, argvIndexes));
}

function translateUnknownFlag(flag: UnknownFlag, argvIndexes: readonly number[]): CliUnknownFlag {
  return Object.freeze({
    argvElement: flag.argvElement,
    flag: flag.flag,
    argvIndex: originalIndex(flag.argvIndex, argvIndexes),
    ...(flag.offset === undefined ? {} : { offset: flag.offset }),
    ...(flag.inlineValue === undefined ? {} : { inlineValue: flag.inlineValue })
  });
}

function mapLocations(
  details: Readonly<Record<string, unknown>>,
  argvIndexes: readonly number[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...details,
    ...('argvIndex' in details && typeof details['argvIndex'] === 'number'
      ? { argvIndex: originalIndex(details['argvIndex'], argvIndexes) }
      : {}),
    ...('valueArgvIndex' in details && typeof details['valueArgvIndex'] === 'number'
      ? { valueArgvIndex: originalIndex(details['valueArgvIndex'], argvIndexes) }
      : {})
  });
}

function originalIndex(parserIndex: number, argvIndexes: readonly number[]): number {
  return argvIndexes[parserIndex] ?? parserIndex;
}
