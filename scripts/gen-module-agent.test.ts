import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stripAgent } from "./lib/strip-agent.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_PRESENT = existsSync(path.join(ROOT, "apps/server/src/agent/registry.ts"));
const temps: string[] = [];

const SEED_PATHS = [
  "packages/db/src/schema/index.ts",
  "packages/api/src/index.ts",
  "packages/api/src/contracts.ts",
  "packages/api/src/permissions.ts",
  "packages/api/package.json",
  "apps/server/package.json",
  "apps/server/.env.schema",
  "apps/server/src/console.ts",
  "apps/server/src/core/bearer.ts",
  "apps/server/src/agent",
  "apps/web/package.json",
  "apps/web/src/routes/__root.tsx",
  "apps/web/src/config/app-config.ts",
  "apps/web/src/features/system/SystemPage.tsx",
  "apps/web/src/features/dashboard/registry.ts",
  "apps/web/src/features/navigation/entity-search.ts",
  "apps/web/src/features/assistant/ToolSteps.tsx",
  "apps/web/src/features/assistant/Composer.tsx",
  "apps/web/src/features/assistant/Conversation.tsx",
  "apps/web/src/features/assistant/assistant-links-utils.ts",
  "package.json",
  "Dockerfile",
  "Dockerfile.prod",
  "compose.yaml",
  "compose.override.yaml",
];

function createSandbox({ withAgent = true }: { withAgent?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "gen-module-agent-"));
  temps.push(dir);
  for (const rel of SEED_PATHS) {
    const src = path.join(ROOT, rel);
    if (!existsSync(src)) continue;
    if (
      !withAgent &&
      (rel === "apps/server/src/agent" || rel.startsWith("apps/web/src/features/assistant"))
    ) {
      continue;
    }
    const dst = path.join(dir, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
  }
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!AGENT_PRESENT)("gen-module agent integration", () => {
  it("generates agent tools, tool metadata, entity links and entity search with --code-prefix and remains strippable", () => {
    const sandbox = createSandbox({ withAgent: true });
    execFileSync(
      "node",
      [
        path.join(ROOT, "scripts/gen-module.mjs"),
        "vendors",
        "--label",
        "供应商台账",
        "--detail",
        "page",
        "--code-prefix",
        "VND",
      ],
      {
        encoding: "utf-8",
        env: { ...process.env, STARTER_GEN_ROOT: sandbox },
      },
    );

    const toolsFile = path.join(sandbox, "apps/server/src/agent/vendors-tools.ts");
    expect(existsSync(toolsFile)).toBe(true);
    const toolsText = readFileSync(toolsFile, "utf-8");
    expect(toolsText).toContain("search_vendors");
    expect(toolsText).toContain("summarize_vendors");
    expect(toolsText).toContain("create_vendor");
    expect(toolsText).toContain("needsApproval: true");
    expect(toolsText).toContain("lockPermission");
    expect(toolsText).toContain('"agent"');
    expect(toolsText).toContain("VND-");

    const registryText = readFileSync(
      path.join(sandbox, "apps/server/src/agent/registry.ts"),
      "utf-8",
    );
    expect(registryText).toContain("vendors-tools");
    expect(registryText).toContain("vendorsTools(context)");

    const routesText = readFileSync(path.join(sandbox, "apps/server/src/agent/routes.ts"), "utf-8");
    expect(routesText).toContain("vendorsWriteTools");

    const toolStepsText = readFileSync(
      path.join(sandbox, "apps/web/src/features/assistant/ToolSteps.tsx"),
      "utf-8",
    );
    expect(toolStepsText).toContain("search_vendors");
    expect(toolStepsText).toContain('WRITE_TOOLS.add("create_vendor")');

    const linksText = readFileSync(
      path.join(sandbox, "apps/web/src/features/assistant/assistant-links-utils.ts"),
      "utf-8",
    );
    expect(linksText).toContain("VND-");
    expect(linksText).toContain("/vendors/");

    const entitySearchText = readFileSync(
      path.join(sandbox, "apps/web/src/features/navigation/entity-search.ts"),
      "utf-8",
    );
    expect(entitySearchText).toContain("/vendors?");
    expect(entitySearchText).toContain("VND-");

    // Must still strip cleanly if the project later runs --no-agent
    expect(() => stripAgent({ root: sandbox, log: () => {} })).not.toThrow();
    expect(existsSync(toolsFile)).toBe(false);
  });

  it("skips agent tools silently when agent directory was stripped", () => {
    const sandbox = createSandbox({ withAgent: false });
    expect(() =>
      execFileSync(
        "node",
        [
          path.join(ROOT, "scripts/gen-module.mjs"),
          "vendors",
          "--label",
          "供应商台账",
          "--code-prefix",
          "VND",
        ],
        {
          encoding: "utf-8",
          env: { ...process.env, STARTER_GEN_ROOT: sandbox },
        },
      ),
    ).not.toThrow();
    expect(existsSync(path.join(sandbox, "apps/server/src/agent/vendors-tools.ts"))).toBe(false);
    expect(existsSync(path.join(sandbox, "apps/server/src/modules/vendors.ts"))).toBe(true);
  });
});
