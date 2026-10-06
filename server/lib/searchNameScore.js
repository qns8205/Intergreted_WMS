const normalize = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Complement full-name/alias matches with literal words, independent of word order. */
export function nameWordScore(query, name) {
  const words = [...new Set(String(query || "").split(/[^\p{L}\p{N}]+/u).map(normalize).filter(Boolean))];
  if (words.length < 2) return 0;
  const value = normalize(name);
  const coverage = words.filter(word => value.includes(word)).length / words.length;
  if (coverage === 1) return 2.7;
  // A lone generic word in a long description must not override its AI meaning.
  return coverage >= .5 ? 1.2 * coverage : 0;
}
