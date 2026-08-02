import {
  CliDefinitionError as CoreDefinitionError,
  createCliInvocation as createCoreInvocation,
  defineCli as defineCoreCli,
  type CliCommandDefinition as CoreCommandDefinition,
  type CliDefinition as CoreDefinition,
  type CliInvocationResult as CoreInvocationResult,
  type CliOptionDefinition as CoreOptionDefinition,
  type CliProgram,
  type StructuredInvocationInput as CoreStructuredInvocationInput
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
  CliInvocationResult,
  CliMultipleOptionDefinition,
  CliOptionDiagnostic,
  CliOptionDefinitions,
  CliParseInput,
  CliPositionalDefinition,
  CliScalarOptionDefinition,
  CliStructuredInvocationInput
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

type ExactAliases<Aliases extends readonly unknown[]> = {
  readonly [Index in keyof Aliases]: Aliases[Index] extends string
    ? Aliases[Index]
    : Aliases[Index] extends { readonly name: string; readonly deprecated?: boolean | string }
      ? Aliases[Index] & Record<
          Exclude<keyof Aliases[Index], 'name' | 'deprecated'>,
          never
        >
      : never;
};

type ExactPositionals<Positionals extends readonly unknown[]> = {
  readonly [Index in keyof Positionals]: Positionals[Index] extends object
    ? Positionals[Index] & Record<
        Exclude<keyof Positionals[Index], keyof CliPositionalDefinition>,
        never
      >
    : never;
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
  : object) & (Command extends { readonly aliases: infer Aliases }
  ? Aliases extends readonly unknown[]
    ? { readonly aliases: ExactAliases<Aliases> }
    : never
  : object) & (Command extends { readonly positionals: infer Positionals }
  ? Positionals extends readonly unknown[]
    ? { readonly positionals: ExactPositionals<Positionals> }
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
  : object) & (Definition extends { readonly positionals: infer Positionals }
  ? Positionals extends readonly unknown[]
    ? { readonly positionals: ExactPositionals<Positionals> }
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
  input: ExactDefinition<Definition>
): Cli<Definition> {
  const snapshot = snapshotDefinition(input);
  const issues = [...snapshot.issues];
  let program: CliProgram | undefined;

  if (snapshot.definition !== undefined) {
    try {
      program = defineCoreCli(toCoreDefinition(snapshot.definition));
    } catch (error) {
      if (!(error instanceof CoreDefinitionError)) throw error;
      issues.push(...error.issues.map((issue) => Object.freeze({
        ...issue,
        source: 'command' as const
      })));
    }

    for (const scope of declaredOptionScopes(snapshot.definition)) {
      try {
        compileOptionParser(scope.options);
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

  if (issues.length > 0 || program === undefined || snapshot.definition === undefined) {
    throw new CliDefinitionError(issues);
  }

  const optionParsers = new Map<string, RuntimeParser>();
  const sensitiveOptions = new Map<string, ReadonlySet<string>>();
  for (const scope of effectiveOptionScopes(snapshot.definition)) {
    optionParsers.set(scope.key, compileOptionParser(scope.options));
    sensitiveOptions.set(scope.key, sensitiveOptionNames(scope.options));
  }
  const invocationParser = createArgvBinder(optionParsers);
  const translate = (invocation: CoreInvocationResult): CliInvocationResult<Definition> =>
    translateInvocation(invocation, sensitiveOptions) as CliInvocationResult<Definition>;
  const cli: Cli<Definition> = Object.freeze({
    program,
    parse(parseInput?: CliParseInput): CliInvocationResult<Definition> {
      const settings = readParseInput(parseInput);
      return translate(invocationParser.parse(program, {
        ...(settings.argv === undefined ? {} : { argv: settings.argv }),
        unknownFlagPolicy: settings.unknownFlagPolicy ?? 'error'
      }));
    },
    invoke(structuredInput: CliStructuredInvocationInput<Definition>): CliInvocationResult<Definition> {
      const coreInput: CoreStructuredInvocationInput = structuredInput;
      return translate(createCoreInvocation(program, coreInput));
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

const facadeProperties = new Set([
  'name',
  'description',
  'options',
  'positionals',
  'commands',
  'invokable',
  'acceptsPassthroughArguments'
]);
const commandProperties = new Set([
  'name',
  'aliases',
  'description',
  'deprecated',
  'options',
  'positionals',
  'commands',
  'invokable',
  'acceptsPassthroughArguments'
]);
const aliasProperties = new Set(['name', 'deprecated']);
const positionalProperties = new Set(['name', 'required', 'variadic', 'description']);

interface DefinitionSnapshot {
  readonly definition?: CliDefinition;
  readonly issues: readonly CliDefinitionIssue[];
}

type MutablePartial<Value> = {
  -readonly [Property in keyof Value]?: Value[Property];
};

type DefinitionContainer = Record<PropertyKey, unknown> &
  MutablePartial<CliDefinition & CliCommandDefinition>;

type OptionContainer = Record<PropertyKey, unknown> &
  MutablePartial<CliOptionDefinitions[string]>;

function snapshotDefinition(input: unknown): DefinitionSnapshot {
  const issues: CliDefinitionIssue[] = [];
  if (!isPlainRecord(input)) {
    addInvalidIssue(issues, [], 'A Clivoke definition must be a plain object.');
    return { issues };
  }
  const definition = snapshotCommandContainer(input, [], true, new Set(), issues);
  return {
    ...(definition === undefined ? {} : { definition: definition as CliDefinition }),
    issues
  };
}

function snapshotCommandContainer(
  input: PlainRecord,
  path: readonly string[],
  root: boolean,
  ancestors: Set<object>,
  issues: CliDefinitionIssue[]
): Readonly<DefinitionContainer> | undefined {
  if (ancestors.has(input)) {
    addInvalidIssue(issues, path, 'Command definitions must not contain cycles.');
    return undefined;
  }
  ancestors.add(input);
  const output = Object.create(null) as DefinitionContainer;
  const dynamicOutput: Record<PropertyKey, unknown> = output;
  const allowed = root ? facadeProperties : commandProperties;
  copyKnownDataProperties(input, dynamicOutput, allowed, path, issues);

  const options = dynamicOutput['options'];
  if (options !== undefined) {
    const copied = snapshotOptions(options, path, issues);
    if (copied === undefined) delete dynamicOutput['options'];
    else dynamicOutput['options'] = copied;
  }
  const positionals = dynamicOutput['positionals'];
  if (positionals !== undefined) {
    const copied = snapshotObjectArray(
      positionals,
      path,
      'Positionals',
      positionalProperties,
      issues
    );
    if (copied === undefined) delete dynamicOutput['positionals'];
    else dynamicOutput['positionals'] = copied;
  }
  const aliases = dynamicOutput['aliases'];
  if (!root && aliases !== undefined) {
    const copied = snapshotAliases(aliases, path, issues);
    if (copied === undefined) delete dynamicOutput['aliases'];
    else dynamicOutput['aliases'] = copied;
  }
  const commands = dynamicOutput['commands'];
  if (commands !== undefined) {
    const copied = snapshotCommands(commands, path, ancestors, issues);
    if (copied === undefined) delete dynamicOutput['commands'];
    else dynamicOutput['commands'] = copied;
  }
  ancestors.delete(input);
  return Object.freeze(output);
}

function snapshotCommands(
  input: unknown,
  parentPath: readonly string[],
  ancestors: Set<object>,
  issues: CliDefinitionIssue[]
): readonly unknown[] | undefined {
  const entries = readDenseArray(input);
  if (entries === undefined) {
    addInvalidIssue(issues, parentPath, 'Commands must be a dense array.');
    return undefined;
  }
  const commands: unknown[] = [];
  for (const value of entries) {
    if (!isPlainRecord(value)) {
      addInvalidIssue(issues, parentPath, 'Each command must be a plain object.');
      continue;
    }
    const name = ownDataValue(value, 'name');
    const path = Object.freeze([...parentPath, typeof name === 'string' ? name : '']);
    const command = snapshotCommandContainer(value, path, false, ancestors, issues);
    if (command !== undefined) commands.push(command);
  }
  return Object.freeze(commands);
}

function snapshotOptions(
  input: unknown,
  path: readonly string[],
  issues: CliDefinitionIssue[]
): CliOptionDefinitions | undefined {
  if (!isPlainRecord(input)) {
    addInvalidIssue(issues, path, 'Options must be a plain object keyed by logical option name.');
    return undefined;
  }
  const options = Object.create(null) as Record<string, CliOptionDefinitions[string]>;
  for (const property of Reflect.ownKeys(input)) {
    if (typeof property !== 'string') {
      addInvalidIssue(issues, path, 'Option names must be strings.');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, property);
    if (descriptor === undefined || !('value' in descriptor)) {
      addInvalidIssue(issues, [...path, property], 'Option definitions must be data properties.');
      continue;
    }
    if (!isPlainRecord(descriptor.value)) {
      addInvalidIssue(issues, [...path, property], 'Each option definition must be a plain object.');
      continue;
    }
    const option = snapshotOption(descriptor.value, [...path, property], issues);
    if (option !== undefined) options[property] = option;
  }
  return Object.freeze(options);
}

function snapshotOption(
  input: PlainRecord,
  path: readonly string[],
  issues: CliDefinitionIssue[]
): CliOptionDefinitions[string] | undefined {
  const output = Object.create(null) as OptionContainer;
  for (const property of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, property);
    if (descriptor === undefined || !('value' in descriptor)) {
      addInvalidIssue(issues, path, `Option property ${String(property)} must be a data property.`);
      continue;
    }
    let value: unknown = descriptor.value;
    if (property === 'flags' || property === 'falseFlags' ||
        (property === 'default' && Array.isArray(value))) {
      const entries = readDenseArray(value);
      if (entries === undefined) {
        addInvalidIssue(issues, path, `Option property ${String(property)} must be a dense array.`);
        continue;
      }
      value = Object.freeze(entries);
    }
    output[property] = value;
  }
  validateOptionPresentation(output, path, issues);
  return Object.freeze(output) as CliOptionDefinitions[string];
}

function validateOptionPresentation(
  option: Readonly<Record<PropertyKey, unknown>>,
  path: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  const type = option['type'];
  const valueTaking = type !== 'boolean' && type !== 'count';
  if (!valueTaking && (
    Object.hasOwn(option, 'valueLabel') ||
    Object.hasOwn(option, 'valueDescription') ||
    Object.hasOwn(option, 'implicitValueLabel') ||
    Object.hasOwn(option, 'sensitive')
  )) {
    addInvalidIssue(issues, path, 'Only value-taking options may define value presentation.');
  }
  if (Object.hasOwn(option, 'implicitValueLabel') &&
      option['valueMode'] !== 'optional-inline') {
    addInvalidIssue(
      issues,
      path,
      'An implicit value label requires optional-inline value mode.'
    );
  }
  if (Object.hasOwn(option, 'defaultLabel') &&
      (option['required'] === true || type === 'count' || (
        option['multiple'] !== true &&
        !Object.hasOwn(option, 'default')
      ))) {
    addInvalidIssue(issues, path, 'A default label requires a materialized default value.');
  }
}

function snapshotObjectArray(
  input: unknown,
  path: readonly string[],
  label: string,
  allowed: ReadonlySet<string>,
  issues: CliDefinitionIssue[]
): readonly unknown[] | undefined {
  const entries = readDenseArray(input);
  if (entries === undefined) {
    addInvalidIssue(issues, path, `${label} must be a dense array.`);
    return undefined;
  }
  const values: unknown[] = [];
  for (const entry of entries) {
    if (!isPlainRecord(entry)) {
      addInvalidIssue(issues, path, `Each ${label.toLowerCase()} entry must be a plain object.`);
      continue;
    }
    const output = Object.create(null) as Record<PropertyKey, unknown>;
    copyKnownDataProperties(entry, output, allowed, path, issues);
    values.push(Object.freeze(output));
  }
  return Object.freeze(values);
}

function snapshotAliases(
  input: unknown,
  path: readonly string[],
  issues: CliDefinitionIssue[]
): readonly unknown[] | undefined {
  const entries = readDenseArray(input);
  if (entries === undefined) {
    addInvalidIssue(issues, path, 'Aliases must be a dense array.');
    return undefined;
  }
  const aliases: unknown[] = [];
  for (const alias of entries) {
    if (typeof alias === 'string') {
      aliases.push(alias);
      continue;
    }
    if (!isPlainRecord(alias)) {
      addInvalidIssue(issues, path, 'Each alias must be a string or a plain object.');
      continue;
    }
    const output = Object.create(null) as Record<PropertyKey, unknown>;
    copyKnownDataProperties(alias, output, aliasProperties, path, issues);
    aliases.push(Object.freeze(output));
  }
  return Object.freeze(aliases);
}

function copyKnownDataProperties(
  input: PlainRecord,
  output: Record<PropertyKey, unknown>,
  allowed: ReadonlySet<string>,
  path: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  for (const property of Reflect.ownKeys(input)) {
    if (typeof property !== 'string' || !allowed.has(property)) {
      issues.push({
        source: 'clivoke',
        code: 'UNKNOWN_PROPERTY',
        message: 'Definition object contains an unsupported property.',
        definitionPath: Object.freeze([...path]),
        property
      });
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, property);
    if (descriptor === undefined || !('value' in descriptor)) {
      addInvalidIssue(issues, [...path, property], 'Definition properties must be data properties.');
      continue;
    }
    output[property] = descriptor.value;
  }
}

function addInvalidIssue(
  issues: CliDefinitionIssue[],
  path: readonly string[],
  message: string
): void {
  issues.push({
    source: 'clivoke',
    code: 'INVALID_DEFINITION',
    message,
    definitionPath: Object.freeze([...path])
  });
}

type PlainRecord = Readonly<Record<PropertyKey, unknown>>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(value: PlainRecord, property: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function readDenseArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) return undefined;
    entries.push(descriptor.value);
  }
  if (!Reflect.ownKeys(value).every((property) =>
    property === 'length' ||
    (typeof property === 'string' && /^(?:0|[1-9]\d*)$/u.test(property) && Number(property) < value.length))) {
    return undefined;
  }
  return entries;
}

function readParseInput(input: unknown): CliParseInput {
  if (input === undefined) return Object.freeze({});
  if (!isPlainRecord(input)) throw new TypeError('CLI parse input must be a plain object.');

  const output: { argv?: readonly string[]; unknownFlagPolicy?: 'error' | 'collect' } = {};
  for (const property of Reflect.ownKeys(input)) {
    if (property !== 'argv' && property !== 'unknownFlagPolicy') {
      throw new TypeError(`Unknown CLI parse input property ${String(property)}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, property);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`CLI parse input property ${String(property)} must be a data property.`);
    }
    const value = descriptor.value;
    if (property === 'argv') {
      if (value === undefined) continue;
      const argv = readDenseArray(value);
      if (argv === undefined || argv.some((element) => typeof element !== 'string')) {
        throw new TypeError('CLI argv must be a dense array of strings.');
      }
      output.argv = Object.freeze(argv) as readonly string[];
      continue;
    }
    if (value !== undefined && value !== 'error' && value !== 'collect') {
      throw new TypeError('Unknown-flag policy must be error or collect.');
    }
    if (value !== undefined) output.unknownFlagPolicy = value;
  }
  return Object.freeze(output);
}

function toCoreDefinition(definition: CliDefinition): CoreDefinition {
  return {
    name: definition.name,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    options: optionPresentations(definition.options ?? {}),
    ...(definition.positionals === undefined ? {} : { positionals: definition.positionals }),
    commands: (definition.commands ?? []).map(toCoreCommand),
    ...(definition.invokable === undefined ? {} : { invokable: definition.invokable }),
    ...(definition.acceptsPassthroughArguments === undefined
      ? {}
      : { acceptsPassthroughArguments: definition.acceptsPassthroughArguments })
  };
}

function toCoreCommand(definition: CliCommandDefinition): CoreCommandDefinition {
  return {
    name: definition.name,
    ...(definition.aliases === undefined ? {} : { aliases: definition.aliases }),
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.deprecated === undefined ? {} : { deprecated: definition.deprecated }),
    options: optionPresentations(definition.options ?? {}),
    ...(definition.positionals === undefined ? {} : { positionals: definition.positionals }),
    commands: (definition.commands ?? []).map(toCoreCommand),
    ...(definition.invokable === undefined ? {} : { invokable: definition.invokable }),
    ...(definition.acceptsPassthroughArguments === undefined
      ? {}
      : { acceptsPassthroughArguments: definition.acceptsPassthroughArguments })
  };
}

function optionPresentations(definitions: CliOptionDefinitions): readonly CoreOptionDefinition[] {
  return Object.freeze(Object.entries(definitions).map(([name, definition]) =>
    optionPresentation(name, definition)));
}

function optionPresentation(
  name: string,
  definition: CliOptionDefinitions[string]
): CoreOptionDefinition {
  const common = {
    name,
    flags: definition.flags,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.hidden === undefined ? {} : { hidden: definition.hidden })
  };
  if (definition.type === 'boolean') {
    const hasDefault = Object.hasOwn(definition, 'default');
    const defaultLabel = definition.defaultLabel ??
      (hasDefault ? formatDefault(definition.default) : undefined);
    const booleanPresentation = {
      ...common,
      kind: 'boolean' as const,
      ...(definition.falseFlags === undefined ? {} : { falseFlags: definition.falseFlags }),
      ...(definition.required === undefined ? {} : { required: definition.required }),
      ...(definition.repeat === undefined ? {} : { repeat: definition.repeat })
    };
    return hasDefault
      ? {
          ...booleanPresentation,
          hasDefault: true,
          ...(defaultLabel === undefined ? {} : { defaultLabel })
        }
      : { ...booleanPresentation, hasDefault: false };
  }
  if (definition.type === 'count') return { ...common, kind: 'count' };
  const structuralChoices = typeof definition.type === 'object' && definition.type !== null
    ? structuralDataValue(definition.type, 'choices')
    : undefined;
  const choices = Array.isArray(structuralChoices) ? structuralChoices : undefined;
  const multiple = 'multiple' in definition && definition.multiple === true;
  const hasDefault = (multiple && definition.required !== true) ||
    Object.hasOwn(definition, 'default');
  const defaultLabel = definition.defaultLabel ??
    (hasDefault ? formatDefault(definition.default) : undefined);
  const valuePresentation = {
    ...common,
    kind: 'value' as const,
    ...(definition.valueLabel === undefined ? {} : { valueLabel: definition.valueLabel }),
    ...(definition.valueDescription === undefined
      ? {}
      : { valueDescription: definition.valueDescription }),
    ...(definition.required === undefined ? {} : { required: definition.required }),
    ...(multiple ? { multiple: true } : {}),
    ...('repeat' in definition && definition.repeat !== undefined
      ? { repeat: definition.repeat }
      : {}),
    ...(choices === undefined ? {} : { valueCandidates: choices })
  };
  const withDefault = hasDefault
    ? {
        ...valuePresentation,
        hasDefault: true as const,
        ...(defaultLabel === undefined ? {} : { defaultLabel })
      }
    : { ...valuePresentation, hasDefault: false as const };
  return definition.valueMode === 'optional-inline'
    ? {
        ...withDefault,
        valueMode: 'optional-inline',
        ...(definition.implicitValueLabel === undefined
          ? {}
          : { implicitValueLabel: definition.implicitValueLabel })
      }
    : { ...withDefault, valueMode: 'required' };
}

function structuralDataValue(value: object, property: PropertyKey): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

interface OptionScope {
  readonly key: string;
  readonly path: readonly string[];
  readonly options: CliOptionDefinitions;
}

function declaredOptionScopes(definition: CliDefinition): readonly OptionScope[] {
  const scopes: OptionScope[] = [{
    key: definition.name,
    path: Object.freeze([]),
    options: definition.options ?? Object.freeze({})
  }];
  collectDeclaredScopes(definition.name, definition.commands ?? [], [], scopes);
  return Object.freeze(scopes);
}

function collectDeclaredScopes(
  programName: string,
  commands: readonly CliCommandDefinition[],
  parentPath: readonly string[],
  scopes: OptionScope[]
): void {
  for (const command of commands) {
    const path = Object.freeze([...parentPath, command.name]);
    scopes.push({
      key: [programName, ...path].join(' '),
      path,
      options: command.options ?? Object.freeze({})
    });
    collectDeclaredScopes(programName, command.commands ?? [], path, scopes);
  }
}

function effectiveOptionScopes(definition: CliDefinition): readonly OptionScope[] {
  const globalOptions = definition.options ?? Object.freeze({});
  const scopes: OptionScope[] = [{
    key: definition.name,
    path: Object.freeze([]),
    options: freezeOptionMap(globalOptions)
  }];
  collectEffectiveScopes(definition.name, definition.commands ?? [], [], globalOptions, scopes);
  return Object.freeze(scopes);
}

function collectEffectiveScopes(
  programName: string,
  commands: readonly CliCommandDefinition[],
  parentPath: readonly string[],
  inheritedOptions: CliOptionDefinitions,
  scopes: OptionScope[]
): void {
  for (const command of commands) {
    const path = Object.freeze([...parentPath, command.name]);
    const options = mergeOptionMaps(inheritedOptions, command.options ?? Object.freeze({}));
    scopes.push({ key: [programName, ...path].join(' '), path, options });
    collectEffectiveScopes(programName, command.commands ?? [], path, options, scopes);
  }
}

function mergeOptionMaps(
  inherited: CliOptionDefinitions,
  local: CliOptionDefinitions
): CliOptionDefinitions {
  const result = Object.create(null) as Record<string, CliOptionDefinitions[string]>;
  for (const [name, definition] of Object.entries(inherited)) result[name] = definition;
  for (const [name, definition] of Object.entries(local)) result[name] = definition;
  return Object.freeze(result);
}

function freezeOptionMap(options: CliOptionDefinitions): CliOptionDefinitions {
  return mergeOptionMaps(Object.freeze({}), options);
}

function sensitiveOptionNames(options: CliOptionDefinitions): ReadonlySet<string> {
  return new Set(Object.entries(options)
    .filter(([, definition]) => definition.type !== 'boolean' && definition.type !== 'count' &&
      definition.sensitive === true)
    .map(([name]) => name));
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

type TranslatedInvocation = CoreInvocationResult extends infer Invocation
  ? Invocation extends CoreInvocationResult
    ? Omit<Invocation, 'diagnostics'> & { readonly diagnostics: readonly CliDiagnostic[] }
    : never
  : never;

function translateInvocation(
  invocation: CoreInvocationResult,
  sensitiveOptions: ReadonlyMap<string, ReadonlySet<string>>
): TranslatedInvocation {
  const commandSensitiveOptions = invocation.command === undefined
    ? undefined
    : sensitiveOptions.get(invocation.command.key);
  const diagnostics = Object.freeze(invocation.diagnostics.map((diagnostic) => {
    if (diagnostic.source !== 'option') return diagnostic;
    const option = typeof diagnostic.details['option'] === 'string'
      ? diagnostic.details['option']
      : undefined;
    return Object.freeze({
      ...diagnostic.details,
      source: 'option' as const,
      code: diagnostic.code,
      severity: 'error' as const,
      message: diagnostic.message,
      ...(option !== undefined && commandSensitiveOptions?.has(option) === true
        ? { sensitive: true as const }
        : {})
    }) as CliOptionDiagnostic;
  }));
  return Object.freeze({ ...invocation, diagnostics });
}
