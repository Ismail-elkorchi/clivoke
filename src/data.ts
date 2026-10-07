export type PlainRecord = Readonly<Record<PropertyKey, unknown>>;

export function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function ownDataValue(value: PlainRecord, property: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

export function readDenseArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (lengthDescriptor === undefined || !('value' in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return undefined;
  const length = lengthDescriptor.value as number;
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) return undefined;
    entries.push(descriptor.value);
  }
  if (!Reflect.ownKeys(value).every((property) =>
    property === 'length' ||
    (typeof property === 'string' && /^(?:0|[1-9]\d*)$/u.test(property) && Number(property) < length))) {
    return undefined;
  }
  return entries;
}

