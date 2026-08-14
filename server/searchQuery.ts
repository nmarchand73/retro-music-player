const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
]);

/** Normalize titles/paths for Amiga UnExoticA ↔ Lemon/Top Games matching. */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[_./\\+\-]+/g, ' ')
    .replace(/\bo t\b/g, 'of the')
    .replace(/\bf t\b/g, 'from the')
    .replace(/\bw t\b/g, 'with the')
    .replace(/\ba t\b/g, 'and the')
    .replace(/\bi t\b/g, 'in the')
    .replace(/\bb t\b/g, 'by the')
    .replace(/\bmiss\b/g, 'mission')
    .replace(/\biiii\b/g, '4')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\biv\b/g, '4')
    .replace(/\bix\b/g, '9')
    .replace(/\bviii\b/g, '8')
    .replace(/\bvii\b/g, '7')
    .replace(/\bvi\b/g, '6')
    .replace(/\bv\b/g, '5')
    .replace(/\b(cd32|cdtv|ecs|aga|remake|remix|soundtrack)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cover/game lookup key — same as search normalize, minus stopwords kept in phrase form. */
export function normalizeGameKey(value: string): string {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
    .join(' ');
}

export function searchTokens(query: string): string[] {
  return normalizeSearchText(query)
    .split(' ')
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

export function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const text = normalizeSearchText(haystack);
  return tokens.every((token) => text.includes(token));
}

/** True when every query token appears in the candidate game/title key. */
export function matchesNormalizedGame(query: string, ...candidates: Array<string | undefined>): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return false;
  return candidates.some((candidate) => {
    if (!candidate) return false;
    const key = normalizeGameKey(candidate);
    return tokens.every((token) => key.includes(token));
  });
}
