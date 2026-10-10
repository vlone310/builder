const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Returns true when a URL is safe to put in an href or src.
 *
 * Relative URLs and fragments are allowed; absolute URLs must use an allow-listed
 * scheme. Tabs, newlines and leading control characters are stripped first, the
 * same way browsers do, so "java\tscript:" cannot slip through.
 */
export function isSafeUrl(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const normalized = value.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "");
  if (normalized.length === 0) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (!scheme) return true;
  return SAFE_SCHEMES.has(`${scheme[1]?.toLowerCase()}:`);
}
