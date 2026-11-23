// Match the model's wire markers, including gateways that normalize the full-width bars.
const dsml = /<\s*\/?\s*[｜|]?\s*DSML/i;
const partialMarker = /^<\s*\/?\s*[｜|]?\s*(?:D(?:S(?:M(?:L)?)?)?)?$/i;
export const unavailableConclusion = "本轮未生成结论。可查看已查询的结果，或重新生成回答。";
export const hasDsml = (text: string) => dsml.test(text);

// Hold only a possible marker prefix across network chunks. Ordinary text remains incremental.
export function visibleDelta(text: string) {
  const match = dsml.exec(text);
  if (match) return { text: text.slice(0, match.index), pending: "", blocked: true };
  const start = text.lastIndexOf("<");
  if (start !== -1 && partialMarker.test(text.slice(start))) {
    return { text: text.slice(0, start), pending: text.slice(start), blocked: false };
  }
  return { text, pending: "", blocked: false };
}
