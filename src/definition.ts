import {
  CliDefinitionError as CoreDefinitionError,
  defineCli as defineCoreCli,
  type CliCommandDefinition as CoreCommandDefinition,
  type CliDefinition as CoreDefinition,
  type CliOptionDefinition as CoreOptionDefinition,
  type CliProgram,
  type ParsedInvocation
} from '@ismail-elkorchi/cli-core';
import {
  DefinitionError as ArgvDefinitionError,
  type ValueType
} from 'argv-flags';
import { CliDefinitionError } from './definition-error.ts';
import {
  compileOptionParser,
  createArgvBinder,
  type RuntimeParser
} from './option-binder.ts';
import type {
  Cli,
  CliBooleanOptionDefinition,
  CliCommandDefinition,
  CliCountOptionDefinition,
  CliDefinition,
  CliDiagnostic,
  CliDefinitionIssue,
  CliMultipleOptionDefinition,
  CliOptionDiagnostic,
  CliOptionDefinitions,
  CliParseInput,
  CliParsedInvocation,
  CliScalarOptionDefinition
} from './public-types.ts';

type OptionShape<Definition> = Definition extends { readonly type: 'boolean' }
  ? CliBooleanOptionDefinition
  : Definition extends { readonly type: 'count' }
    ? CliCountOptionDefinition
    : Definition extends { readonly type: infer Type }
      ? Type extends ValueType
        ? Definition extends { readonly multiple: true }
          ? CliMultipleOptionDefinition<Type>
          : CliScalarOptionDefinition<Type>
        : never
      : never;

type ExactOption<Definition> = OptionShape<Definition> & Record<
  Exclude<keyof Definition, keyof OptionShape<Definition>>,
  never
>;

type ExactOptions<Definitions extends CliOptionDefinitions> = {
  readonly [Name in keyof Definitions]: ExactOption<Definitions[Name]>;
};

type ExactCommands<Commands extends readonly CliCommandDefinition[]> = {
  readonly [Index in keyof Commands]: Commands[Index] extends CliCommandDefinition
    ? ExactCommand<Commands[Index]>
    : never;
};

type ExactCommand<Command extends CliCommandDefinition> = Command & Record<
  Exclude<keyof Command, keyof CliCommandDefinition>,
  never
> & (Command extends { readonly options: infer Options }
  ? Options extends CliOptionDefinitions
    ? { readonly options: Options & ExactOptions<Options> }
    : never
  : object) & (Command extends { readonly commands: infer Commands }
  ? Commands extends readonly CliCommandDefinition[]
    ? { readonly commands: ExactCommands<Commands> }
    : never
  : object);

type ExactDefinition<Definition extends CliDefinition> = Definition & Record<
  Exclude<keyof Definition, keyof CliDefinition>,
  never
> & (Definition extends { readonly options: infer Options }
  ? Options extends CliOptionDefinitions
    ? { readonly options: Options & ExactOptions<Options> }
    : never
  : object) & (Definition extends { readonly commands: infer Commands }
  ? Commands extends readonly CliCommandDefinition[]
    ? { readonly commands: ExactCommands<Commands> }
    : never
  : object);

export interface CliRuntime {
  readonly invocationParser: ReturnType<typeof createArgvBinder>;
  readonly optionParsers: ReadonlyMap<string, RuntimeParser>;
}

const runtimes = new WeakMap<object, CliRuntime>();

/** Compiles command semantics and argv grammar into one reusable facade. */
export function createCli<const Definition extends CliDefinition>(
  definition: ExactDefinition<Definition>
): Cli<Definition> {
  const issues = collectFacadeIssues(definition);
  let program: CliProgram | undefined;
  const optionParsers = new Map<string, RuntimeParser>();

  if (isTraversableDefinition(definition)) {
    try {
      program = defineCoreCli(toCoreDefinition(definition));
    } catch (error) {
      if (!(error instanceof CoreDefinitionError)) throw error;
      issues.push(...error.issues.map((issue) => Object.freeze({
        ...issue,
        source: 'command' as const
      })));
    }

    for (const scope of optionDefinitionScopes(definition)) {
      try {
        optionParsers.set(scope.key, compileOptionParser(scope.options));
      } catch (error) {
        if (!(error instanceof ArgvDefinitionError)) throw error;
        issues.push(...error.issues.map((issue) => Object.freeze({
          ...issue,
          source: 'option' as const,
          commandPath: scope.path
        })));
      }
    }
  }

  if (issues.length > 0 || program === undefined) {
    throw new CliDefinitionError(issues);
  }

  const invocationParser = createArgvBinder(optionParsers);
  const cli: Cli<Definition> = Object.freeze({
    program,
    parse(input: CliParseInput = {}): CliParsedInvocation<Definition> {
      const invocation = invocationParser.parse(program, {
        ...(input.argv === undefined ? {} : { argv: input.argv }),
        unknownFlagPolicy: input.unknownFlagPolicy === 'collect' ? 'collect' : 'error'
      });
      return translateInvocation(invocation) as CliParsedInvocation<Definition>;
    }
  });
  runtimes.set(cli, Object.freeze({ invocationParser, optionParsers }));
  return cli;
}

/** Returns private compiled integration data for other Clivoke modules. */
export function runtimeFor(cli: object): CliRuntime {
  const runtime = runtimes.get(cli);
  if (runtime === undefined) throw new TypeError('CLI was not created by createCli.');
  return runtime;
}

const facadeProperties = new Set(['name', 'description', 'options', 'commands']);
const commandProperties = new Set([
  'name',
  'aliases',
  'description',
  'deprecated',
  'options',
  'positionals',
  'commands',
  'acceptsAfterDoubleDash'
]);

function collectFacadeIssues(definition: unknown): CliDefinitionIssue[] {
  const issues: CliDefinitionIssue[] = [];
  if (!isRecord(definition)) {
    issues.push({
      source: 'clivoke',
      code: 'INVALID_OPTIONS',
      message: 'A Clivoke definition must be an object.',
      commandPath: Object.freeze([])
    });
    return issues;
  }
  collectUnknownProperties(definition, facadeProperties, [], issues);
  collectOptionShapeIssues(definition['options'], [], issues);
  collectCommandShapeIssues(definition['commands'], [], issues);
  return issues;
}

function collectCommandShapeIssues(
  commands: unknown,
  parentPath: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  if (commands === undefined) return;
  if (!Array.isArray(commands)) {
    issues.push({
      source: 'clivoke',
      code: 'INVALID_OPTIONS',
      message: 'Commands must be an array.',
      commandPath: Object.freeze([...parentPath])
    });
    return;
  }
  for (const command of commands) {
    if (!isRecord(command)) {
      issues.push({
        source: 'clivoke',
        code: 'INVALID_OPTIONS',
        message: 'Each command must be an object.',
        commandPath: Object.freeze([...parentPath])
      });
      continue;
    }
    const name = command['name'];
    const path = [...parentPath, typeof name === 'string' ? name : ''];
    collectUnknownProperties(command, commandProperties, path, issues);
    collectOptionShapeIssues(command['options'], path, issues);
    collectCommandShapeIssues(command['commands'], path, issues);
  }
}

function collectOptionShapeIssues(
  options: unknown,
  commandPath: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  if (options === undefined) return;
  if (!isRecord(options)) {
    issues.push({
      source: 'clivoke',
      code: 'INVALID_OPTIONS',
      message: 'Options must be an object keyed by logical option name.',
      commandPath: Object.freeze([...commandPath])
    });
    return;
  }
  for (const property of Reflect.ownKeys(options)) {
    if (typeof property !== 'string' || !isRecord(options[property])) {
      issues.push({
        source: 'clivoke',
        code: 'INVALID_OPTIONS',
        message: 'Each option must have a string name and an object definition.',
        commandPath: Object.freeze([...commandPath])
      });
    }
  }
}

function collectUnknownProperties(
  value: object,
  allowed: ReadonlySet<string>,
  path: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  for (const property of Reflect.ownKeys(value)) {
    if (typeof property === 'string' && allowed.has(property)) continue;
    issues.push({
      source: 'clivoke',
      code: 'UNKNOWN_PROPERTY',
      message: 'Definition object contains an unsupported property.',
      definitionPath: Object.freeze([...path]),
      property
    });
  }
}

function isTraversableDefinition(value: unknown): value is CliDefinition {
  if (!isRecord(value) || !isOptionMap(value['options'])) return false;
  return isCommandArray(value['commands']);
}

function isCommandArray(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.every((command) =>
    isRecord(command) && isOptionMap(command['options']) && isCommandArray(command['commands']));
}

function isOptionMap(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Reflect.ownKeys(value).every((name) =>
    typeof name === 'string' && isRecord(value[name])));
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCoreDefinition(definition: CliDefinition): CoreDefinition {
  return {
    name: definition.name,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    options: optionPresentations(definition.options ?? {}),
    commands: (definition.commands ?? []).map(toCoreCommand)
  };
}

function toCoreCommand(definition: CliCommandDefinition): CoreCommandDefinition {
  return {
    name: definition.name,
    ...(definition.aliases === undefined ? {} : { aliases: definition.aliases }),
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.deprecated === undefined ? {} : { deprecated: definition.deprecated }),
    options: optionPresentations(definition.options ?? {}),
    ...(definition.positionals === undefined
      ? {}
      : { positionals: definition.positionals }),
    commands: (definition.commands ?? []).map(toCoreCommand),
    ...(definition.acceptsAfterDoubleDash === undefined
      ? {}
      : { acceptsAfterDoubleDash: definition.acceptsAfterDoubleDash })
  };
}

function optionPresentations(
  definitions: CliOptionDefinitions
): readonly CoreOptionDefinition[] {
  const result: CoreOptionDefinition[] = [];
  for (const [name, definition] of Object.entries(definitions)) {
    const presentation = optionPresentation(name, definition);
    if (presentation !== undefined) result.push(presentation);
  }
  return Object.freeze(result);
}

function optionPresentation(
  name: string,
  definition: CliOptionDefinitionValue
): CoreOptionDefinition | undefined {
  if (!isValidFlagList(definition.flags)) return undefined;
  const common = {
    name,
    flags: definition.flags,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.hidden === undefined ? {} : { hidden: definition.hidden })
  };
  if (definition.type === 'boolean') {
    const hasDefault = Object.hasOwn(definition, 'default');
    const defaultLabel = hasDefault ? formatDefault(definition.default) : undefined;
    return {
      ...common,
      kind: 'boolean',
      ...(definition.falseFlags === undefined || !isValidFlagList(definition.falseFlags)
        ? {}
        : { falseFlags: definition.falseFlags }),
      ...(definition.required === undefined ? {} : { required: definition.required }),
      ...(definition.repeat === undefined ? {} : { repeat: definition.repeat }),
      hasDefault,
      ...(defaultLabel === undefined ? {} : { defaultLabel })
    };
  }
  if (definition.type === 'count') return { ...common, kind: 'count' };
  if (!isPotentialValueType(definition.type)) return undefined;
  const choices = typeof definition.type === 'object'
    ? definition.type.choices
    : undefined;
  const hasDefault = Object.hasOwn(definition, 'default');
  const defaultLabel = hasDefault ? formatDefault(definition.default) : undefined;
  return {
    ...common,
    kind: 'value',
    valueMode: definition.valueMode ?? 'required',
    ...('valueLabel' in definition && definition.valueLabel !== undefined
      ? { valueLabel: definition.valueLabel }
      : {}),
    ...(definition.required === undefined ? {} : { required: definition.required }),
    ...('multiple' in definition && definition.multiple === true ? { multiple: true } : {}),
    ...('repeat' in definition && definition.repeat !== undefined
      ? { repeat: definition.repeat }
      : {}),
    hasDefault,
    ...(defaultLabel === undefined ? {} : { defaultLabel }),
    ...(choices === undefined ? {} : { valueCandidates: choices })
  };
}

function optionDefinitionScopes(definition: CliDefinition): readonly {
  readonly key: string;
  readonly path: readonly string[];
  readonly options: CliOptionDefinitions;
}[] {
  const globalOptions = definition.options ?? {};
  const scopes = [{
    key: definition.name,
    path: Object.freeze([]),
    options: freezeOptionMap(globalOptions)
  }];
  collectCommandScopes(
    definition.name,
    definition.commands ?? [],
    [],
    globalOptions,
    scopes
  );
  return Object.freeze(scopes);
}

function collectCommandScopes(
  programName: string,
  commands: readonly CliCommandDefinition[],
  parentPath: readonly string[],
  inheritedOptions: CliOptionDefinitions,
  scopes: {
    key: string;
    path: readonly string[];
    options: CliOptionDefinitions;
  }[]
): void {
  for (const command of commands) {
    const path = Object.freeze([...parentPath, command.name]);
    const options = mergeOptionMaps(inheritedOptions, command.options ?? {});
    scopes.push({ key: [programName, ...path].join(' '), path, options });
    collectCommandScopes(programName, command.commands ?? [], path, options, scopes);
  }
}

function mergeOptionMaps(
  inherited: CliOptionDefinitions,
  local: CliOptionDefinitions
): CliOptionDefinitions {
  const result = Object.create(null) as Record<string, CliOptionDefinitionValue>;
  for (const [name, definition] of Object.entries(inherited)) result[name] = definition;
  for (const [name, definition] of Object.entries(local)) result[name] = definition;
  return Object.freeze(result);
}

type CliOptionDefinitionValue = CliOptionDefinitions[string];

type TranslatedInvocation = ParsedInvocation extends infer Invocation
  ? Invocation extends ParsedInvocation
    ? Omit<Invocation, 'diagnostics'> & { readonly diagnostics: readonly CliDiagnostic[] }
    : never
  : never;

function freezeOptionMap(options: CliOptionDefinitions): CliOptionDefinitions {
  return mergeOptionMaps({}, options);
}

function isValidFlagList(value: unknown): value is readonly [string, ...string[]] {
  return Array.isArray(value) && value.length > 0 && value.every((flag) => typeof flag === 'string');
}

function isPotentialValueType(value: unknown): value is Exclude<ValueType, 'boolean' | 'count'> {
  return value === 'string' || value === 'number' || value === 'integer' ||
    isRecord(value);
}

function formatDefault(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((entry) =>
    typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')) {
    return value.join(', ');
  }
  return undefined;
}

function translateInvocation(invocation: ParsedInvocation): TranslatedInvocation {
  const diagnostics = Object.freeze(invocation.diagnostics.map((diagnostic) => {
    if (diagnostic.source !== 'option') return diagnostic;
    return Object.freeze({
      ...diagnostic.details,
      source: 'option' as const,
      code: diagnostic.code,
      severity: 'error' as const,
      message: diagnostic.message
    }) as CliOptionDiagnostic;
  }));
  return Object.freeze({ ...invocation, diagnostics });
}
