import {
  createCliInvocationParser,
  createCliOptionDiagnostic,
  type CliInvocationParser,
  type CliOptionBinder,
  type CliOptionBindingInput,
  type CliScannedOption,
  type CliUnknownFlag
} from '@ismail-elkorchi/cli-core';
import {
  createParserFromMap,
  type OptionDefinitionMap,
  type ParseIssue,
  type Parser,
  type ScannedOption,
  type UnknownFlag
} from 'argv-flags';
import type { CliOptionDefinition, CliOptionDefinitions } from './public-types.ts';

type RuntimeDefinition<Definition> = Definition extends CliOptionDefinition
  ? Omit<
      Definition,
      | 'description'
      | 'hidden'
      | 'sensitive'
      | 'valueLabel'
      | 'valueDescription'
      | 'defaultLabel'
      | 'implicitValueLabel'
    >
  : never;

export type RuntimeParser = Parser<OptionDefinitionMap>;

/** Compiles one immutable parser from a command's effective option definitions. */
export function compileOptionParser(definitions: CliOptionDefinitions): RuntimeParser {
  return createParserFromMap(stripPresentation(definitions));
}

/** Creates command routing and final binding over the same argv-flags grammar. */
export function createArgvBinder(
  parsers: ReadonlyMap<string, RuntimeParser>
): CliInvocationParser {
  const binder: CliOptionBinder = {
    scan(input: CliOptionBindingInput) {
      const result = parserFor(parsers, input).scan({
        argv: input.argv,
        flagPlacement: 'interspersed'
      });
      const unknownFlags = Object.freeze(
        result.unknownFlags.map((flag) => translateUnknownFlag(flag, input.argvIndexes))
      );
      if (result.issues.length > 0) {
        return {
          status: 'invalid',
          diagnostics: Object.freeze(
            result.issues.map((issue) => translateIssue(issue, input.argvIndexes))
          ),
          unknownFlags
        };
      }
      return {
        status: 'scanned',
        options: Object.freeze(result.options.map((option) =>
          translateScannedOption(option, input.argvIndexes))),
        arguments: Object.freeze(result.arguments.map((argument) => Object.freeze({
          value: argument.value,
          argvIndex: originalIndex(argument.argvIndex, input.argvIndexes)
        }))),
        afterDoubleDash: Object.freeze(result.afterDoubleDash.map((argument) => Object.freeze({
          value: argument.value,
          argvIndex: originalIndex(argument.argvIndex, input.argvIndexes)
        }))),
        ...(result.doubleDashIndex === undefined
          ? {}
          : { doubleDashArgvIndex: originalIndex(result.doubleDashIndex, input.argvIndexes) }),
        unknownFlags
      };
    },
    bind(input: CliOptionBindingInput) {
      const result = parserFor(parsers, input).parse({
        argv: input.argv,
        unknownFlagPolicy: 'collect',
        flagPlacement: 'interspersed'
      });
      const unknownFlags = Object.freeze(
        result.unknownFlags.map((flag) => translateUnknownFlag(flag, input.argvIndexes))
      );
      if (!result.success) {
        return {
          status: 'invalid',
          diagnostics: Object.freeze(
            result.issues.map((issue) => translateIssue(issue, input.argvIndexes))
          ),
          unknownFlags
        };
      }
      return {
        status: 'bound',
        values: result.values,
        specified: result.specified,
        positionals: result.positionals,
        afterDoubleDash: result.afterDoubleDash,
        unknownFlags
      };
    }
  };
  return createCliInvocationParser(Object.freeze(binder));
}

function translateScannedOption(
  option: ScannedOption,
  argvIndexes: readonly number[]
): CliScannedOption {
  const location = {
    option: option.option,
    flag: option.flag,
    argvElement: option.argvElement,
    argvIndex: originalIndex(option.argvIndex, argvIndexes),
    ...(option.offset === undefined ? {} : { offset: option.offset })
  };
  if (option.state !== 'explicit-value' && option.state !== 'unexpected-value') {
    return Object.freeze(location);
  }
  return Object.freeze({
    ...location,
    rawValue: option.rawValue,
    valueArgvIndex: originalIndex(option.valueArgvIndex, argvIndexes),
    inline: option.inline
  });
}

function parserFor(
  parsers: ReadonlyMap<string, RuntimeParser>,
  input: CliOptionBindingInput
): RuntimeParser {
  const parser = parsers.get(input.command.key);
  if (parser === undefined) {
    throw new TypeError(`Missing option parser for command ${input.command.key}.`);
  }
  return parser;
}

function stripPresentation(definitions: CliOptionDefinitions): OptionDefinitionMap {
  const runtimeDefinitions = Object.create(null) as Record<
    string,
    RuntimeDefinition<CliOptionDefinition>
  >;
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.type === 'count') {
      const {
        description: _description,
        hidden: _hidden,
        ...runtime
      } = definition;
      runtimeDefinitions[name] = runtime;
      continue;
    }
    const {
      description: _description,
      hidden: _hidden,
      defaultLabel: _defaultLabel,
      ...withoutCommonPresentation
    } = definition;
    if (withoutCommonPresentation.type !== 'boolean') {
      const {
        sensitive: _sensitive,
        valueLabel: _valueLabel,
        valueDescription: _valueDescription,
        implicitValueLabel: _implicitValueLabel,
        ...runtime
      } = withoutCommonPresentation;
      runtimeDefinitions[name] = runtime;
    } else {
      runtimeDefinitions[name] = withoutCommonPresentation;
    }
  }
  return Object.freeze(runtimeDefinitions);
}

function translateIssue(
  issue: ParseIssue,
  argvIndexes: readonly number[]
) {
  const { code, message, ...details } = issue;
  return createCliOptionDiagnostic(
    code,
    'error',
    message,
    mapLocations(details, argvIndexes)
  );
}

function translateUnknownFlag(
  flag: UnknownFlag,
  argvIndexes: readonly number[]
): CliUnknownFlag {
  return Object.freeze({
    argvElement: flag.argvElement,
    flag: flag.flag,
    argvIndex: originalIndex(flag.argvIndex, argvIndexes),
    ...(flag.offset === undefined ? {} : { offset: flag.offset }),
    ...(flag.inlineValue === undefined ? {} : { inlineValue: flag.inlineValue }),
    ...(flag.suggestions === undefined
      ? {}
      : { suggestions: Object.freeze([...flag.suggestions]) })
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
  const index = argvIndexes[parserIndex];
  if (index === undefined) throw new TypeError('Option parser returned an invalid argv index.');
  return index;
}
