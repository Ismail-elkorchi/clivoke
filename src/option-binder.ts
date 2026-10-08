import {
  createCliInvocationParser,
  createCliOptionDiagnostic,
  type CliCommandRoute,
  type CliInvocationParser,
  type CliOptionBinder,
  type CliCommand,
  type CliScannedOption
} from '@ismail-elkorchi/cli-core';
import {
  createArgvCursor,
  createParser,
  type OptionDefinitionMap,
  type ParseIssue,
  type Parser,
  type ScannedOption,
  type ScanIssue
} from 'argv-flags';
import type { CliArgvInspection, CliOptionDefinition, CliOptionDefinitions } from './public-types.ts';

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
  return createParser(stripPresentation(definitions));
}

/** Routes and decodes one owned classification using composed option scopes. */
export function createArgvBinder(
  parsers: ReadonlyMap<string, RuntimeParser>,
  controlNames: ReadonlySet<string>
): CliInvocationParser & { readonly inspect: (route: CliCommandRoute) => CliArgvInspection } {
  const occurrences = new WeakMap<readonly string[], ScannedOption[]>();
  const binder: CliOptionBinder = {
    create(argv) {
      const cursor = createArgvCursor({ argv, flagPlacement: 'interspersed' });
      const richOptions: ScannedOption[] = [];
      occurrences.set(argv, richOptions);
      let firstArgument = true;
      return {
        next(command) {
          const span = parserFor(parsers, command).scanNext(cursor);
          // A malformed cluster can contain a recognized prefix. None of that
          // token is actionable until its complete syntax is trustworthy.
          const malformed = new Set(span.issues.filter((issue) => issue.code === 'INVALID_FLAG_SYNTAX')
            .map((issue) => issue.argvIndex));
          const options = span.options.filter((option) => !malformed.has(option.argvIndex));
          const unknownFlags = span.unknownFlags.filter((flag) => !malformed.has(flag.argvIndex));
          for (const option of options) richOptions.push(option);
          const claimed = new Set<number>();
          for (const option of options) {
            claimed.add(option.argvIndex);
            if ('valueArgvIndex' in option) claimed.add(option.valueArgvIndex);
          }
          for (const argument of [...span.arguments, ...span.afterDoubleDash]) claimed.add(argument.argvIndex);
          for (const flag of unknownFlags) claimed.add(flag.argvIndex);
          if (span.doubleDashIndex !== undefined) claimed.add(span.doubleDashIndex);
          const unclassified = [];
          for (let index = span.startIndex; index < span.endIndex; index += 1) {
            if (!claimed.has(index)) unclassified.push(Object.freeze({ value: argv[index] ?? '', argvIndex: index }));
          }
          const controls = firstArgument && command.path.length === 0 && span.arguments[0]?.value === 'help'
            ? span.arguments : [];
          if (span.arguments.length > 0) firstArgument = false;
          return {
            nextIndex: span.endIndex,
            controls,
            options: options.filter((option) => !controlNames.has(option.option)).map(translateScannedOption),
            controlOptions: options.filter((option) => controlNames.has(option.option)).map(translateScannedOption),
            arguments: controls.length === 0 ? span.arguments : [],
            afterDoubleDash: span.afterDoubleDash,
            unknownFlags: unknownFlags,
            diagnostics: span.issues.map(translateIssue),
            unclassified,
            ...(span.doubleDashIndex === undefined ? {} : { doubleDashArgvIndex: span.doubleDashIndex })
          };
        },
        bind(command) {
          const result = parserFor(parsers, command).decode(cursor, { unknownFlagPolicy: 'collect' });
          if (!result.success) return {
            status: 'invalid', diagnostics: result.issues.filter(isDecoderIssue).map(translateIssue)
          };
          const values = Object.create(null) as Record<string, unknown>;
          const specified = Object.create(null) as Record<string, boolean>;
          for (const [name, value] of Object.entries(result.values)) {
            if (!controlNames.has(name)) values[name] = value;
          }
          for (const [name, value] of Object.entries(result.specified)) {
            if (!controlNames.has(name)) specified[name] = value;
          }
          return { status: 'bound', values: Object.freeze(values), specified: Object.freeze(specified) };
        }
      };
    }
  };
  const parser = createCliInvocationParser(Object.freeze(binder));
  return Object.freeze({
    ...parser,
    inspect(route: CliCommandRoute): CliArgvInspection {
      const classified = route.classification;
      const options = occurrences.get(classified.argv);
      if (options === undefined) throw new TypeError('Route classification is not owned by this binder.');
      const commandIndexes = new Set(route.commandIndexes);
      return Object.freeze({
        argv: classified.argv,
        commandPath: route.command.path,
        options: Object.freeze([...options]),
        positionalArguments: Object.freeze(classified.arguments.filter((argument) => !commandIndexes.has(argument.argvIndex))),
        passthroughArguments: classified.afterDoubleDash,
        unknownFlags: classified.unknownFlags,
        unclassifiedArguments: classified.unclassified,
        controlArguments: classified.controls,
        ...(classified.doubleDashArgvIndex === undefined ? {} : { doubleDashIndex: classified.doubleDashArgvIndex })
      });
    }
  });
}

function translateScannedOption(option: ScannedOption): CliScannedOption {
  const location = {
    option: option.option, flag: option.flag, argvElement: option.argvElement,
    argvIndex: option.argvIndex,
    ...(option.offset === undefined ? {} : { offset: option.offset })
  };
  return option.state === 'explicit-value' || option.state === 'unexpected-value'
    ? { ...location, rawValue: option.rawValue, valueArgvIndex: option.valueArgvIndex, inline: option.inline }
    : location;
}

function parserFor(parsers: ReadonlyMap<string, RuntimeParser>, command: CliCommand): RuntimeParser {
  const parser = parsers.get(command.key);
  if (parser === undefined) throw new TypeError(`Missing option parser for command ${command.key}.`);
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

function translateIssue(issue: ParseIssue) {
  const { code, message, ...details } = issue;
  return createCliOptionDiagnostic(code, 'error', message, details);
}

// argv-flags decode includes scanner issues as well as semantic issues. The
// scanner owns these diagnostics in next(); bind contributes only decoder issues.
// Keep this exhaustive over ScanIssue so a new lexical issue requires ownership.
const scannerIssueCodes = {
  INVALID_FLAG_SYNTAX: true,
  MISSING_OPTION_VALUE: true,
  UNEXPECTED_OPTION_VALUE: true
} satisfies Record<ScanIssue['code'], true>;

function isDecoderIssue(issue: ParseIssue): boolean {
  return !Object.hasOwn(scannerIssueCodes, issue.code);
}
