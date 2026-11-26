import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyStarterFile, parseStarterVersion, upgradeStarter } from "./upgrade-starter.mjs";

const temps: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

function writeFiles(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseStarterVersion & classifyStarterFile", () => {
  it("parses key=value fields from .starter-version", () => {
    const parsed = parseStarterVersion(
      [
        "STARTER_REPO=https://github.com/wherexml/optimax-starter.git",
        "STARTER_COMMIT=473b6d88c3d4b661b13864b119def1bc95afbaa5",
        "STARTER_SLUG=optimax-graph-console",
      ].join("\n"),
    );
    expect(parsed.repo).toBe("https://github.com/wherexml/optimax-starter.git");
    expect(parsed.commit).toBe("473b6d88c3d4b661b13864b119def1bc95afbaa5");
    expect(parsed.slug).toBe("optimax-graph-console");
  });

  it("classifies core modules vs business-owned files accurately", () => {
    expect(classifyStarterFile("packages/ui/src/components/segmented-control.tsx")).toBe(
      "foundation",
    );
    expect(classifyStarterFile("apps/server/src/core/system-settings.ts")).toBe("foundation");
    expect(classifyStarterFile("apps/server/src/modules/auth.ts")).toBe("foundation");
    expect(classifyStarterFile("apps/server/src/modules/system.ts")).toBe("foundation");
    expect(classifyStarterFile("packages/api/src/contracts.ts")).toBe("central");
    expect(classifyStarterFile("apps/server/src/modules/graph.ts")).toBe("protected");
    expect(classifyStarterFile("README.md")).toBe("protected");
    expect(classifyStarterFile("AGENTS.md")).toBe("protected");
    expect(classifyStarterFile("apps/web/src/config/app-config.ts")).toBe("protected");
    expect(classifyStarterFile("apps/web/src/features/graph/SimulatePage.tsx")).toBe("protected");
    expect(classifyStarterFile("packages/db/src/migrations/0000_init.sql")).toBe("protected");
  });
});

describe("upgradeStarter", () => {
  it("three-way merges foundation files, skips protected files, and strips example blocks when target ran --no-example", () => {
    const source = makeTempDir("starter-src-");
    const target = makeTempDir("starter-tgt-");

    git(source, "init");
    writeFiles(source, {
      "package.json": JSON.stringify({ name: "optimax-starter", version: "1.0.0" }, null, 2),
      "packages/api/package.json": JSON.stringify({ name: "@optimax-starter/api" }, null, 2),
      "apps/server/src/core/system-settings.ts": [
        "export const SESSION_HOURS = 24;",
        "export function helper() { return 1; }",
        "",
      ].join("\n"),
      "apps/server/src/modules/auth.ts": "export const ttlHours = 24;\n",
      "apps/server/src/modules/assets.ts": "export const assetsDemo = true;\n",
      "apps/server/src/console.ts": [
        "// core imports",
        "import { base } from './base';",
        "",
        "// module imports",
        "// @starter:example-assets-start",
        "import { assetsRoutes } from './modules/assets';",
        "// @starter:example-assets-end",
        "// @starter:module-imports",
        "export const app = base;",
        "",
      ].join("\n"),
      "README.md": "# Starter README\n",
    });
    git(source, "add", ".");
    git(source, "commit", "-m", "base");
    const baseSha = git(source, "rev-parse", "HEAD");

    writeFiles(target, {
      ".starter-version": `STARTER_REPO=${source}\nSTARTER_COMMIT=${baseSha}\nSTARTER_SLUG=my-app\n`,
      "package.json": JSON.stringify({ name: "my-app", version: "1.0.0" }, null, 2),
      "packages/api/package.json": JSON.stringify({ name: "@optimax-starter/api" }, null, 2),
      "apps/server/src/core/system-settings.ts": [
        "export const SESSION_HOURS = 24;",
        "export function helper() { return 1; }",
        "export const customBusinessFlag = true;",
        "",
      ].join("\n"),
      "apps/server/src/modules/auth.ts": "export const ttlHours = 24;\n",
      "apps/server/src/console.ts": [
        "// core imports",
        "import { base } from './base';",
        "",
        "// module imports",
        "import { graphRoutes } from './modules/graph';",
        "// @starter:module-imports",
        "export const app = base;",
        "",
      ].join("\n"),
      "README.md": "# My App Business README\n",
    });

    writeFiles(source, {
      "apps/server/src/core/system-settings.ts": [
        "export const SESSION_HOURS = 168;",
        "export function helper() { return 1; }",
        "",
      ].join("\n"),
      "apps/server/src/modules/auth.ts": "export const ttlHours = 168;\n",
      "apps/server/src/console.ts": [
        "// core imports",
        "import { base } from './base';",
        "import { health } from './health';",
        "",
        "// module imports",
        "// @starter:example-assets-start",
        "import { assetsRoutes } from './modules/assets';",
        "// @starter:example-assets-end",
        "// @starter:module-imports",
        "export const app = base;",
        "",
      ].join("\n"),
      "packages/ui/src/components/resizable.tsx": "export const Resizable = () => null;\n",
      "README.md": "# Upstream Updated Starter README\n",
    });
    git(source, "add", ".");
    git(source, "commit", "-m", "v2");
    const targetSha = git(source, "rev-parse", "HEAD");

    const dry = upgradeStarter({ targetDir: target, source, apply: false });
    expect(dry.fromCommit).toBe(baseSha);
    expect(dry.toCommit).toBe(targetSha);
    expect(dry.features.examplePresent).toBe(false);
    expect(dry.added).toContain("packages/ui/src/components/resizable.tsx");
    expect(dry.merged).toContain("apps/server/src/core/system-settings.ts");
    expect(dry.merged).toContain("apps/server/src/modules/auth.ts");
    expect(dry.merged).toContain("apps/server/src/console.ts");
    expect(dry.skippedProtected).toContain("README.md");
    expect(dry.conflicts).toEqual([]);

    const applied = upgradeStarter({ targetDir: target, source, apply: true });
    expect(applied.conflicts).toEqual([]);

    const mergedSettings = readFileSync(
      path.join(target, "apps/server/src/core/system-settings.ts"),
      "utf-8",
    );
    expect(mergedSettings).toContain("SESSION_HOURS = 168");
    expect(mergedSettings).toContain("customBusinessFlag = true");

    expect(readFileSync(path.join(target, "apps/server/src/modules/auth.ts"), "utf-8")).toContain(
      "ttlHours = 168",
    );

    const mergedConsole = readFileSync(path.join(target, "apps/server/src/console.ts"), "utf-8");
    expect(mergedConsole).toContain("import { health } from './health'");
    expect(mergedConsole).toContain("import { graphRoutes } from './modules/graph'");
    expect(mergedConsole).not.toContain("assetsRoutes");

    expect(
      readFileSync(path.join(target, "packages/ui/src/components/resizable.tsx"), "utf-8"),
    ).toContain("Resizable");
    expect(readFileSync(path.join(target, "README.md"), "utf-8")).toBe(
      "# My App Business README\n",
    );
    expect(readFileSync(path.join(target, ".starter-version"), "utf-8")).toContain(
      `STARTER_COMMIT=${targetSha}`,
    );
  });

  it("supports --to WORKTREE and protects target files when 3-way merge hits a conflict", () => {
    const source = makeTempDir("starter-wt-src-");
    const target = makeTempDir("starter-wt-tgt-");

    git(source, "init");
    writeFiles(source, {
      "packages/api/package.json": JSON.stringify({ name: "@optimax-starter/api" }, null, 2),
      "apps/server/src/core/config.ts": "export const LIMIT = 10;\n",
    });
    git(source, "add", ".");
    git(source, "commit", "-m", "base");
    const baseSha = git(source, "rev-parse", "HEAD");

    writeFiles(target, {
      ".starter-version": `STARTER_REPO=${source}\nSTARTER_COMMIT=${baseSha}\nSTARTER_SLUG=wt-app\n`,
      "packages/api/package.json": JSON.stringify({ name: "@optimax-starter/api" }, null, 2),
      "apps/server/src/core/config.ts": "export const LIMIT = 42;\n",
    });

    // Uncommitted worktree edit on source causing conflict + new untracked component
    writeFiles(source, {
      "apps/server/src/core/config.ts": "export const LIMIT = 99;\n",
      "packages/ui/src/components/slider.tsx": "export const Slider = () => null;\n",
    });

    const summary = upgradeStarter({
      targetDir: target,
      source,
      toRef: "WORKTREE",
      apply: true,
      allowConflicts: false,
    });
    expect(summary.applied).toBe(false);
    expect(summary.added).toContain("packages/ui/src/components/slider.tsx");
    expect(summary.conflicts).toContain("apps/server/src/core/config.ts");
    // Must not overwrite target or advance STARTER_COMMIT on conflict
    expect(readFileSync(path.join(target, "apps/server/src/core/config.ts"), "utf-8")).toBe(
      "export const LIMIT = 42;\n",
    );
    expect(readFileSync(path.join(target, ".starter-version"), "utf-8")).toContain(
      `STARTER_COMMIT=${baseSha}`,
    );
  });
});
