export function searchTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

export function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const text = haystack.toLowerCase();
  return tokens.every((token) => text.includes(token));
}
