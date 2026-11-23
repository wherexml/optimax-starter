export const normalizeText = (text: string) =>
  text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export function quoteMatchesSource(quote: string, source: string) {
  const exact = normalizeText(quote);
  return exact.length >= 8 && quote.length <= 500 && normalizeText(source).includes(exact);
}

export function verifyCitations<
  T extends { score: number | null; evidence: { source: number; quote: string }[] },
>(row: T, sources: { text: string }[], max = Number.POSITIVE_INFINITY): T {
  const evidence = row.evidence
    .filter(({ source, quote }) => {
      const match = Number.isInteger(source) ? sources[source - 1] : undefined;
      return match !== undefined && quoteMatchesSource(quote, match.text);
    })
    .slice(0, 6);
  const score =
    row.score !== null && row.score >= 0 && row.score <= max && evidence.length
      ? Math.round(row.score * 100) / 100
      : null;
  return { ...row, evidence, score };
}
