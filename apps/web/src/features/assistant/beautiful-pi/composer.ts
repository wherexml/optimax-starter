// From Beautiful Pi Web (4a308ed): ChatInput and draft-store. See LICENSE.
/** Keeps selected conversation text separate in the composer without adding a generated task around it. */
export function buildConversationReferencePrompt(value: string, references: string[]): string {
  const uniqueReferences = references
    .map((reference) => reference.trim())
    .filter(Boolean)
    .filter((reference, index, all) => all.indexOf(reference) === index);
  const quotes = uniqueReferences.map((reference) =>
    reference
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
  );
  return [...quotes, value.trim()].filter(Boolean).join("\n\n");
}

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}
