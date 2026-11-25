// --no-agent and --no-example strip cleanly alone and in either order, on temporary copies.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as agentLib from "./lib/strip-agent.mjs";
import * as exampleLib from "./lib/strip-example.mjs";

type StripOptions = { root?: string; dryRun?: boolean; log?: (line: string) => void };
type StripResult = { deleted: string[]; edited: string[] };

const agent = agentLib as unknown as {
  AGENT_PATHS: string[];
  AGENT_MARKED_FILES: string[];
  AGENT_OPTIONAL_MARKED_FILES: string[];
  AGENT_DEPENDENCIES: Record<string, Record<string, string[]>>;
  stripAgent: (options?: StripOptions) => StripResult;
};
const example = exampleLib as unknown as {
  EXAMPLE_PATHS: string[];
  MARKED_FILES: string[];
  OPTIONAL_MARKED_FILES: string[];
  stripExample: (options?: StripOptions) => StripResult;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_PRESENT = existsSync(path.join(ROOT, "packages/agent"));
const EXAMPLE_PRESENT = existsSync(path.join(ROOT, "apps/server/src/modules/assets.ts"));

const FIXTURE_PATHS = [
  ...new Set([
    ...agent.AGENT_PATHS,
    ...agent.AGENT_MARKED_FILES,
    ...agent.AGENT_OPTIONAL_MARKED_FILES,
    ...Object.keys(agent.AGENT_DEPENDENCIES),
    ...example.EXAMPLE_PATHS,
    ...example.MARKED_FILES,
    ...example.OPTIONAL_MARKED_FILES,
  ]),
];

const quiet = () => {};
// U+00B7 built from its code point so this file itself stays free of the character.
const MIDDLE_DOT = new RegExp(String.fromCharCode(0xb7));
const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "strip-agent-"));
  roots.push(root);
  for (const rel of FIXTURE_PATHS) {
    const src = path.join(ROOT, rel);
    if (!existsSync(src)) continue;
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest, {
      recursive: true,
      filter: (from) => !from.split(path.sep).includes("node_modules"),
    });
  }
  return root;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

function markerHits(root: string, needle: RegExp, { includeMd = false } = {}): string[] {
  return files(root)
    .filter(
      (file) => (includeMd || !file.endsWith(".md")) && needle.test(readFileSync(file, "utf-8")),
    )
    .map((file) => path.relative(root, file));
}

const readJson = (root: string, rel: string) =>
  JSON.parse(readFileSync(path.join(root, rel), "utf-8")) as Record<string, unknown>;

function expectAgentStripped(root: string) {
  for (const rel of agent.AGENT_PATHS) expect(existsSync(path.join(root, rel)), rel).toBe(false);
  expect(markerHits(root, /@starter:agent-|\[starter:agent-/)).toEqual([]);

  const rootPkg = readJson(root, "package.json") as { workspaces: { catalog: object } };
  for (const name of agent.AGENT_DEPENDENCIES["package.json"]!["workspaces.catalog"]!) {
    expect(rootPkg.workspaces.catalog, name).not.toHaveProperty([name]);
  }
  expect(rootPkg.workspaces.catalog).toHaveProperty(["zod"]);
  const server = readJson(root, "apps/server/package.json") as { dependencies: object };
  expect(server.dependencies).not.toHaveProperty(["@optimax-starter/agent"]);
  expect(server.dependencies).toHaveProperty(["@optimax-starter/api"]);
  const web = readJson(root, "apps/web/package.json") as { dependencies: object };
  for (const name of ["@optimax-starter/agent", "react-markdown", "remark-gfm"]) {
    expect(web.dependencies, name).not.toHaveProperty([name]);
  }
  expect(web.dependencies).toHaveProperty(["@optimax-starter/api"]);

  const env = readFileSync(path.join(root, "apps/server/.env.schema"), "utf-8");
  expect(env).not.toContain("STARTER_AI_CONFIG_KEY_FILE");
  const consoleTs = readFileSync(path.join(root, "apps/server/src/console.ts"), "utf-8");
  expect(consoleTs).not.toContain("agentRoutes");
  expect(consoleTs).not.toContain("agent\\/chat");
  const contracts = readFileSync(path.join(root, "packages/api/src/contracts.ts"), "utf-8");
  expect(contracts).not.toContain('"agent.chat"');
  expect(contracts).not.toContain("skillSha256");
  const permissions = readFileSync(path.join(root, "packages/api/src/permissions.ts"), "utf-8");
  expect(permissions).not.toContain("agent:use");
  const shell = readFileSync(path.join(root, "apps/web/src/routes/__root.tsx"), "utf-8");
  expect(shell).not.toContain("@/features/assistant");
  expect(shell).not.toContain("AssistantDock");
  expect(shell).not.toContain("SidebarAssistantTrigger");
  expect(shell).toContain('from "@/features/auth/session"');
  expect(shell).toContain('from "../console-client"');
  const system = readFileSync(
    path.join(root, "apps/web/src/features/system/SystemPage.tsx"),
    "utf-8",
  );
  expect(system).not.toContain("AiModelSettingsCard");
  expect(system).not.toContain('"agent-status"');
  expect(system).toContain('from "@/features/auth/session"');
  expect(system).toContain('from "@/features/refresh/WorkspaceRefresh"');
  const assetsPage = path.join(root, "apps/web/src/features/assets/AssetsPage.tsx");
  if (existsSync(assetsPage)) {
    const assets = readFileSync(assetsPage, "utf-8");
    expect(assets).not.toContain("AskAssistant");
    expect(assets).toContain('from "@/features/auth/session"');
    expect(assets).toContain('from "./AssetFormDialog"');
    expect(assets).toContain("importTrigger");
    expect(assets).toContain("createTrigger");
  }
  const assetDetailPage = path.join(root, "apps/web/src/features/assets/AssetDetailPage.tsx");
  if (existsSync(assetDetailPage)) {
    const detail = readFileSync(assetDetailPage, "utf-8");
    expect(detail).not.toContain("AskAssistant");
    expect(detail).toContain('from "@/features/auth/session"');
    expect(detail).toContain('from "./AssetTopologyGraph"');
  }
  expect(markerHits(root, MIDDLE_DOT, { includeMd: true })).toEqual([]);
}

function expectExampleStripped(root: string) {
  for (const rel of example.EXAMPLE_PATHS)
    expect(existsSync(path.join(root, rel)), rel).toBe(false);
  expect(existsSync(path.join(root, "apps/web/src/routes/assets_.$assetId.tsx"))).toBe(false);
  expect(existsSync(path.join(root, "apps/web/src/features/assets/AssetDetailPage.tsx"))).toBe(
    false,
  );
  expect(markerHits(root, /@starter:example-assets-/)).toEqual([]);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!AGENT_PRESENT)("assistant sources", () => {
  it("contain no U+00B7 middle dot", () => {
    const dirs = ["apps/web/src/features/assistant", "apps/server/src/agent"];
    for (const dir of dirs)
      expect(markerHits(path.join(ROOT, dir), MIDDLE_DOT, { includeMd: true }), dir).toEqual([]);
  });

  it.skipIf(!EXAMPLE_PRESENT)("keep valid assistant code after strip-example alone", () => {
    const root = fixture();
    example.stripExample({ root, log: quiet });
    expectExampleStripped(root);
    const tools = readFileSync(
      path.join(root, "apps/web/src/features/assistant/ToolSteps.tsx"),
      "utf-8",
    );
    expect(tools).toMatch(/WRITE_TOOLS = new Set<string>\(\[\s*\]\)/);
    expect(tools).not.toContain("update_asset_stage");
    const composer = readFileSync(
      path.join(root, "apps/web/src/features/assistant/Composer.tsx"),
      "utf-8",
    );
    expect(composer).not.toContain('id: "assets"');
    expect(composer).not.toMatch(/\bChartPie\b/);
    expect(existsSync(path.join(root, "apps/web/src/features/assistant/AssistantDrawer.tsx"))).toBe(
      true,
    );
  });
});

describe.skipIf(!AGENT_PRESENT)("strip-agent", () => {
  it("dry-run reports the plan without touching files", () => {
    const root = fixture();
    const result = agent.stripAgent({ root, dryRun: true, log: quiet });
    expect(result.deleted).toEqual(expect.arrayContaining(["packages/agent/"]));
    expect(existsSync(path.join(root, "packages/agent"))).toBe(true);
  });

  it("removes the assistant on its own", () => {
    const root = fixture();
    agent.stripAgent({ root, log: quiet });
    expectAgentStripped(root);
    if (EXAMPLE_PRESENT) {
      // The example module is untouched.
      expect(existsSync(path.join(root, "apps/server/src/modules/assets.ts"))).toBe(true);
      expect(markerHits(root, /@starter:example-assets-/).length).toBeGreaterThan(0);
    }
  });

  it.skipIf(!EXAMPLE_PRESENT)("runs after strip-example (--no-example then --no-agent)", () => {
    const root = fixture();
    example.stripExample({ root, log: quiet });
    expect(existsSync(path.join(root, "apps/server/src/agent/example-assets-tools.ts"))).toBe(
      false,
    );
    expect(existsSync(path.join(root, "apps/server/src/agent/registry.ts"))).toBe(true);
    agent.stripAgent({ root, log: quiet });
    expectAgentStripped(root);
    expectExampleStripped(root);
  });

  it.skipIf(!EXAMPLE_PRESENT)("runs before strip-example (--no-agent then --no-example)", () => {
    const root = fixture();
    agent.stripAgent({ root, log: quiet });
    example.stripExample({ root, log: quiet });
    expectAgentStripped(root);
    expectExampleStripped(root);
  });
});
