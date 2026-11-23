import { jsonrepair } from "jsonrepair";

export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced =
    /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed) ??
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

export function repairJson(text: string): string | null {
  const stripped = stripJsonFences(text);
  if (!stripped) return null;
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    /* Recover syntax only, never coerce schema types. */
  }
  try {
    const repaired = jsonrepair(stripped);
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}
