import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type AgentSkill = {
  name: string;
  version: string;
  sha256: string;
  /** `## 系统指引`: appended to the system prompt. */
  system: string;
  /** `## 收尾指引`: forced conclusion step (round limit, repeated results, time budget). */
  conclusion: string;
  /** `## 重试指引`: tool-free conclusion retry after malformed output. */
  retry: string;
};

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_SKILL_BYTES = 64 * 1024;
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; skill: AgentSkill }>();

/** Search order: explicit env dir, project-local override, bundled skills (dev and prod layouts). */
export function skillRoots(): string[] {
  const here = import.meta.dirname ?? process.cwd();
  const roots = [
    process.env.STARTER_AGENT_SKILLS_DIR?.trim(),
    path.resolve(".local/skills"),
    path.join(here, "skills"),
    path.join(here, "agent", "skills"),
    // Bundled build (apps/server/dist) -> apps/server/src/agent/skills.
    path.join(here, "..", "src", "agent", "skills"),
    path.resolve("apps/server/src/agent/skills"),
    path.resolve("src/agent/skills"),
  ].filter((root): root is string => !!root);
  return [...new Set(roots)];
}

function parseFrontmatter(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const fields: Record<string, string> = {};
  if (!match) return { fields, body: raw };
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (field?.[1]) fields[field[1]] = (field[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return { fields, body: raw.slice(match[0].length) };
}

function parseSections(body: string) {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current) sections.set(current, lines.join("\n").trim());
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      flush();
      current = heading[1];
      lines = [];
    } else if (current) lines.push(line);
  }
  flush();
  return sections;
}

export function parseSkill(raw: string, fallbackName: string): AgentSkill {
  const { fields, body } = parseFrontmatter(raw);
  const sections = parseSections(body);
  return {
    name: fields.name || fallbackName,
    version: fields.version || "0.0.0",
    sha256: createHash("sha256").update(raw).digest("hex"),
    system: sections.get("系统指引") ?? "",
    conclusion: sections.get("收尾指引") ?? "",
    retry: sections.get("重试指引") ?? "",
  };
}

export async function loadSkill(name: string): Promise<AgentSkill> {
  if (!SKILL_NAME.test(name)) throw new Error("Invalid skill name");
  const hit = cache.get(name);
  if (hit && hit.expiresAt > Date.now()) return hit.skill;
  for (const root of skillRoots()) {
    let raw: string;
    try {
      raw = await readFile(path.join(root, name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    if (Buffer.byteLength(raw) > MAX_SKILL_BYTES) throw new Error("Skill file too large");
    const skill = parseSkill(raw, name);
    cache.set(name, { expiresAt: Date.now() + CACHE_TTL_MS, skill });
    return skill;
  }
  throw new Error(`Skill not found: ${name}`);
}
