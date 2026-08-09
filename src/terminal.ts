/** Escapes terminal control characters while preserving readable Unicode text. */
export function sanitizeTerminalText(value: string): string {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character)
      ? `\\u{${codePoint.toString(16).padStart(4, '0')}}`
      : character;
  }).join('');
}
