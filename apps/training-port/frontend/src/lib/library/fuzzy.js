// Small, deterministic fallback for exercise-name typos. The regular library matcher always
// runs first; this helper only accepts one edit in one sufficiently long token.
export function differsByOneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false

  if (a.length === b.length) {
    const mismatches = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatches.push(i)
    if (mismatches.length === 1) return true
    return mismatches.length === 2
      && mismatches[1] === mismatches[0] + 1
      && a[mismatches[0]] === b[mismatches[1]]
      && a[mismatches[1]] === b[mismatches[0]]
  }

  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]
  let i = 0, j = 0, skipped = false
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue }
    if (skipped) return false
    skipped = true
    j++
  }
  return true
}

const tokenScore = (query, words, isAlias) => {
  let best = 0
  for (const word of words) {
    if (word === query) best = Math.max(best, isAlias ? 3 : 4)
    else if (query.length >= 3 && word.startsWith(query)) best = Math.max(best, isAlias ? 2 : 3)
    else if (word.length >= 4 && query.startsWith(word) && query.length - word.length <= 3) best = Math.max(best, isAlias ? 2 : 3)
    else if (differsByOneEdit(query, word)) best = Math.max(best, isAlias ? 0.5 : 1)
  }
  return best
}

/** Return a score only when all tokens match names/aliases and exactly one token is a typo. */
export function scoreTypoFallback(queryTokens, nameWords, aliasWords) {
  if (!Array.isArray(queryTokens) || queryTokens.length === 0) return null
  let score = 0, typoCount = 0
  for (const query of queryTokens) {
    if (query.length < 3) return null
    const name = tokenScore(query, nameWords, false)
    const alias = tokenScore(query, aliasWords, true)
    const best = Math.max(name, alias)
    if (!best) return null
    if (best < 2) typoCount++
    if (typoCount > 1) return null
    score += best
  }
  return typoCount === 1 ? score : null
}
