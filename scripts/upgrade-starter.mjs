#!/usr/bin/env node
// Safely synchronizes upstream optimax-starter improvements into a derived repository using
// `.starter-version` + 3-way git merge while respecting `--no-example`, `--no-agent`, and
// business-owned files. Defaults to `--dry-run`; pass `--apply` to write changes to disk.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_MARKED_FILES,
  AGENT_OPTIONAL_MARKED_FILES,
  AGENT_PATHS,
  removeAgentBlocks,
} from "./lib/strip-agent.mjs";
import {
  EXAMPLE_PATHS,
  MARKED_FILES as EXAMPLE_MARKED_FILES,
  OPTIONAL_MARKED_FILES as EXAMPLE_OPTIONAL_MARKED_FILES,
  removeExampleBlocks,
} from "./lib/strip-example.mjs";

const CORE_SERVER_MODULES = new Set([
  "apps/server/src/modules/accounts.ts",
  "apps/server/src/modules/attachments.ts",
  "apps/server/src/modules/audit.ts",
  "apps/server/src/modules/auth.ts",
  "apps/server/src/modules/jobs.ts",
  "apps/server/src/modules/system.ts",
  "apps/server/src/modules/tokens.ts",
]);

const PROTECTED_EXACT = new Set([
  "README.md",
  "PROJECT.md",
  "AGENTS.md",
  "CLAUDE.md",
  "DESIGN.md",
  "FRONTEND.md",
  "BACKEND.md",
  "TESTING.md",
  ".starter-version",
  ".env",
  ".env.local",
  ".env.production",
  "apps/web/index.html",
  "apps/web/src/config/app-config.ts",
  "apps/web/src/features/dashboard/registry.ts",
  "compose.yaml",
  "package.json",
  "bun.lock",
]);

const PROTECTED_PREFIXES = ["packages/db/src/migrations/", "apps/web/public/brand/", "evidence/"];

const CORE_ROUTES = new Set([
  "apps/web/src/routes/__root.tsx",
  "apps/web/src/routes/login.tsx",
  "apps/web/src/routes/settings.tsx",
  "apps/web/src/routes/system.tsx",
  "apps/web/src/routes/accounts.tsx",
  "apps/web/src/routes/permissions.tsx",
  "apps/web/src/routes/audit.tsx",
  "apps/web/src/routes/index.tsx",
  "apps/web/src/routes/invite.$token.tsx",
  "apps/web/src/routes/demo.forms.tsx",
]);

const CENTRAL_FILES = new Set([
  "packages/db/src/schema/index.ts",
  "packages/db/package.json",
  "packages/api/src/index.ts",
  "packages/api/src/contracts.ts",
  "packages/api/src/permissions.ts",
  "packages/api/package.json",
  "packages/ui/package.json",
  "apps/server/package.json",
  "apps/server/src/console.ts",
  "apps/server/src/core/bearer.ts",
  "apps/server/.env.schema",
  "apps/server/src/agent/registry.ts",
  "apps/server/src/agent/routes.ts",
  "apps/web/package.json",
  "apps/web/src/console-client.ts",
  "apps/web/src/index.css",
  "apps/web/src/routes/__root.tsx",
  "apps/web/src/features/system/SystemPage.tsx",
  "apps/web/src/features/navigation/entity-search.ts",
  "apps/web/src/features/assistant/Composer.tsx",
  "apps/web/src/features/assistant/ToolSteps.tsx",
  "apps/web/src/features/assistant/Conversation.tsx",
  "apps/web/src/features/assistant/assistant-links-utils.ts",
]);

const FOUNDATION_PREFIXES = [
  "packages/ui/",
  "packages/agent/",
  "packages/config/",
  "packages/api/src/",
  "apps/server/src/core/",
  "apps/server/src/agent/",
  "apps/web/src/components/",
  "apps/web/src/hooks/",
  "apps/web/src/lib/",
  "apps/web/src/features/auth/",
  "apps/web/src/features/system/",
  "apps/web/src/features/permissions/",
  "apps/web/src/features/accounts/",
  "apps/web/src/features/audit/",
  "apps/web/src/features/assistant/",
  "apps/web/src/features/navigation/",
  "apps/web/src/features/refresh/",
  ".agents/skills/",
  "scripts/",
  "docs/",
];

const AGENT_MARKED_SET = new Set([...AGENT_MARKED_FILES, ...AGENT_OPTIONAL_MARKED_FILES]);
const EXAMPLE_MARKED_SET = new Set([...EXAMPLE_MARKED_FILES, ...EXAMPLE_OPTIONAL_MARKED_FILES]);

export function parseStarterVersion(raw) {
  const fields = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    fields.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return {
    repo: fields.get("STARTER_REPO") || "",
    commit: fields.get("STARTER_COMMIT") || "",
    bootstrappedAt: fields.get("STARTER_BOOTSTRAPPED_AT") || "",
    slug: fields.get("STARTER_SLUG") || "",
    rawFields: Object.fromEntries(fields),
  };
}

export function classifyStarterFile(rel) {
  if (PROTECTED_EXACT.has(rel)) return "protected";
  if (PROTECTED_PREFIXES.some((prefix) => rel.startsWith(prefix))) return "protected";
  if (rel.startsWith("apps/server/src/modules/")) {
    return CORE_SERVER_MODULES.has(rel) ? "foundation" : "protected";
  }
  if (rel.startsWith("apps/web/src/routes/") && !CORE_ROUTES.has(rel)) return "protected";
  if (
    rel.startsWith("packages/db/src/schema/") &&
    rel !== "packages/db/src/schema/console.ts" &&
    rel !== "packages/db/src/schema/assets.ts" &&
    rel !== "packages/db/src/schema/index.ts"
  ) {
    return "protected";
  }
  if (CENTRAL_FILES.has(rel)) return "central";
  if (FOUNDATION_PREFIXES.some((prefix) => rel.startsWith(prefix))) return "foundation";
  return "protected";
}

function isUnderPathList(rel, paths) {
  return paths.some((entry) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry));
}

function detectWorkspaceScope(targetDir) {
  const pkgPath = path.join(targetDir, "packages/api/package.json");
  if (!existsSync(pkgPath)) return "@optimax-starter";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const match = typeof pkg.name === "string" ? /^(@[^/]+)\/api$/.exec(pkg.name) : null;
    return match ? match[1] : "@optimax-starter";
  } catch {
    return "@optimax-starter";
  }
}

function adaptStarterContent(rel, raw, { agentPresent, examplePresent, workspaceScope }) {
  if (raw === null) return null;
  let content = raw;
  if (!agentPresent && AGENT_MARKED_SET.has(rel)) {
    try {
      content = removeAgentBlocks(content, rel, { optional: true }).content;
    } catch {
      // Leave mismatched upstream block untouched for manual resolution.
    }
  }
  if (!examplePresent && EXAMPLE_MARKED_SET.has(rel)) {
    if (content.includes("@starter:example-assets-")) {
      try {
        content = removeExampleBlocks(content, rel).content;
      } catch {
        // Leave partial block untouched if mismatched.
      }
    }
  }
  if (workspaceScope && workspaceScope !== "@optimax-starter") {
    content = content.replaceAll("@optimax-starter/", `${workspaceScope}/`);
  }
  return content;
}

function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function gitShowOrNull(gitDir, ref, rel) {
  const res = spawnSync("git", ["-C", gitDir, "show", `${ref}:${rel}`], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return res.status === 0 ? res.stdout : null;
}

function readWorktreeOrNull(dir, rel) {
  const full = path.join(dir, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

function mergeThreeWay(ours, base, theirs) {
  if (base !== null && base === theirs) {
    return { status: "unchanged", content: ours };
  }
  if (base === null) {
    if (ours === theirs) return { status: "unchanged", content: ours };
    return { status: "conflict", content: ours };
  }
  if (ours === base) {
    return { status: "merged", content: theirs };
  }
  if (ours === theirs) {
    return { status: "unchanged", content: ours };
  }
  const work = mkdtempSync(path.join(tmpdir(), "starter-merge-"));
  try {
    const oursFile = path.join(work, "ours");
    const baseFile = path.join(work, "base");
    const theirsFile = path.join(work, "theirs");
    writeFileSync(oursFile, ours, "utf-8");
    writeFileSync(baseFile, base, "utf-8");
    writeFileSync(theirsFile, theirs, "utf-8");
    const res = spawnSync("git", ["merge-file", "-p", "--diff3", oursFile, baseFile, theirsFile], {
      encoding: "utf-8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (res.status === 0) {
      return { status: "merged", content: res.stdout };
    }
    return { status: "conflict", content: res.stdout || ours };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function serializeStarterVersion(existingRaw, nextCommit) {
  const lines = existingRaw.split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    if (line.startsWith("STARTER_COMMIT=")) {
      replaced = true;
      return `STARTER_COMMIT=${nextCommit}`;
    }
    return line;
  });
  if (!replaced) {
    out.push(`STARTER_COMMIT=${nextCommit}`);
  }
  return `${out.filter((line, idx, arr) => !(idx === arr.length - 1 && line === "")).join("\n")}\n`;
}

export function upgradeStarter({
  targetDir = process.cwd(),
  source,
  toRef = "HEAD",
  apply = false,
  allowConflicts = false,
} = {}) {
  const absTarget = path.resolve(targetDir);
  const versionPath = path.join(absTarget, ".starter-version");
  if (!existsSync(versionPath)) {
    throw new Error(`未找到 .starter-version: ${versionPath}`);
  }
  const versionRaw = readFileSync(versionPath, "utf-8");
  const versionInfo = parseStarterVersion(versionRaw);
  const fromCommit = versionInfo.commit;
  const sourceSpec = source || versionInfo.repo;
  if (!fromCommit) {
    throw new Error(".starter-version 缺少 STARTER_COMMIT");
  }
  if (!sourceSpec) {
    throw new Error("未指定 --source 且 .starter-version 缺少 STARTER_REPO");
  }

  let gitDir = "";
  let tempClone = "";
  try {
    const localGit = existsSync(path.join(sourceSpec, ".git"));
    if (localGit) {
      gitDir = path.resolve(sourceSpec);
    } else {
      if (toRef === "WORKTREE") {
        throw new Error("--to WORKTREE 仅支持本地 Git 仓库路径作为 --source");
      }
      tempClone = mkdtempSync(path.join(tmpdir(), "starter-upstream-"));
      execFileSync("git", ["clone", "--bare", "--filter=blob:none", sourceSpec, tempClone], {
        stdio: "pipe",
      });
      gitDir = tempClone;
    }

    const useWorktree = toRef === "WORKTREE";
    const resolvedFrom = runGit(gitDir, ["rev-parse", fromCommit]);
    const toCommit = runGit(gitDir, ["rev-parse", useWorktree ? "HEAD" : toRef]);

    const agentPresent = existsSync(path.join(absTarget, "packages/agent"));
    const examplePresent = existsSync(path.join(absTarget, "apps/server/src/modules/assets.ts"));
    const workspaceScope = detectWorkspaceScope(absTarget);

    let changedRaw = [];
    if (useWorktree) {
      const tracked = runGit(gitDir, ["diff", "--name-only", resolvedFrom])
        .split(/\r?\n/)
        .filter(Boolean);
      const untracked = runGit(gitDir, ["ls-files", "--others", "--exclude-standard"])
        .split(/\r?\n/)
        .filter(Boolean);
      changedRaw = [...new Set([...tracked, ...untracked])].sort();
    } else if (resolvedFrom !== toCommit) {
      changedRaw = runGit(gitDir, ["diff", "--name-only", resolvedFrom, toCommit])
        .split(/\r?\n/)
        .filter(Boolean);
    }

    const added = [];
    const merged = [];
    const conflicts = [];
    const skippedProtected = [];
    const skippedFeature = [];
    const unchanged = [];
    const plannedWrites = [];

    for (const rel of changedRaw) {
      if (!agentPresent && isUnderPathList(rel, AGENT_PATHS)) {
        skippedFeature.push(rel);
        continue;
      }
      if (!examplePresent && isUnderPathList(rel, EXAMPLE_PATHS)) {
        skippedFeature.push(rel);
        continue;
      }
      const kind = classifyStarterFile(rel);
      if (kind === "protected") {
        skippedProtected.push(rel);
        continue;
      }

      const rawBase = gitShowOrNull(gitDir, resolvedFrom, rel);
      const rawTheirs = useWorktree
        ? readWorktreeOrNull(gitDir, rel)
        : gitShowOrNull(gitDir, toCommit, rel);
      if (rawTheirs === null) {
        unchanged.push(rel);
        continue;
      }

      const base = adaptStarterContent(rel, rawBase, {
        agentPresent,
        examplePresent,
        workspaceScope,
      });
      const theirs = adaptStarterContent(rel, rawTheirs, {
        agentPresent,
        examplePresent,
        workspaceScope,
      });

      const destPath = path.join(absTarget, rel);
      if (!existsSync(destPath)) {
        if (rawBase === null) {
          added.push(rel);
          plannedWrites.push({ path: destPath, content: theirs });
        } else {
          skippedFeature.push(rel);
        }
        continue;
      }

      const ours = readFileSync(destPath, "utf-8");
      const result = mergeThreeWay(ours, base, theirs);
      if (result.status === "unchanged") {
        unchanged.push(rel);
      } else if (result.status === "merged") {
        merged.push(rel);
        plannedWrites.push({ path: destPath, content: result.content });
      } else {
        conflicts.push(rel);
        if (apply && allowConflicts) {
          plannedWrites.push({ path: destPath, content: result.content });
        }
      }
    }

    const applied = Boolean(apply && (conflicts.length === 0 || allowConflicts));
    if (applied) {
      for (const write of plannedWrites) {
        mkdirSync(path.dirname(write.path), { recursive: true });
        writeFileSync(write.path, write.content, "utf-8");
      }
      if (conflicts.length === 0) {
        writeFileSync(versionPath, serializeStarterVersion(versionRaw, toCommit), "utf-8");
      }
    }

    return {
      applied,
      fromCommit: resolvedFrom,
      toCommit,
      features: { agentPresent, examplePresent, workspaceScope },
      added,
      merged,
      conflicts,
      skippedProtected,
      skippedFeature,
      unchanged,
    };
  } finally {
    if (tempClone) {
      rmSync(tempClone, { recursive: true, force: true });
    }
  }
}

function usage() {
  console.log(`用法:
  bun run upgrade:starter [-- --dry-run] [-- --source <dir-or-url>] [-- --target <dir>] [-- --to <ref|WORKTREE>]
  bun run upgrade:starter -- --apply [-- --source <dir-or-url>] [-- --target <dir>] [-- --to <ref|WORKTREE>] [-- --allow-conflicts]

说明:
  基于目标仓库的 .starter-version（STARTER_COMMIT / STARTER_REPO）与上游 Starter 执行三路合并:
  - 自动跳过业务专有目录（modules/、migrations/、app-config.ts、README.md 等）
  - 保留核心底座模块（accounts/attachments/audit/auth/jobs/system/tokens）升级通道
  - 自动识别目标仓库是否执行过 --no-example / --no-agent 并剥离对应代码块
  - 默认 --dry-run 只预览差异分类，传 --apply 才落盘并更新 STARTER_COMMIT`);
}

const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  let targetDir = process.cwd();
  let source = "";
  let toRef = "HEAD";
  let apply = false;
  let allowConflicts = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg === "--dry-run") {
      apply = false;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--allow-conflicts") {
      allowConflicts = true;
    } else if (arg === "--target") {
      targetDir = args[++i] ?? "";
    } else if (arg === "--source") {
      source = args[++i] ?? "";
    } else if (arg === "--to") {
      toRef = args[++i] ?? "HEAD";
    } else {
      console.error(`未知参数: ${arg}`);
      process.exit(1);
    }
  }

  try {
    const summary = upgradeStarter({ targetDir, source, toRef, apply, allowConflicts });
    console.log(
      `${summary.applied ? "[apply]" : "[dry-run]"} Starter 升级比对: ${summary.fromCommit.slice(0, 8)} -> ${summary.toCommit.slice(0, 8)}`,
    );
    console.log(
      `  特性识别: agent=${summary.features.agentPresent}, example=${summary.features.examplePresent}, scope=${summary.features.workspaceScope}`,
    );
    for (const rel of summary.added) console.log(`  + ${rel}`);
    for (const rel of summary.merged) console.log(`  M ${rel}`);
    for (const rel of summary.conflicts) console.log(`  ! ${rel} (冲突)`);
    console.log(
      `  汇总: 新增 ${summary.added.length}, 三路合并 ${summary.merged.length}, 冲突 ${summary.conflicts.length}, 保护跳过 ${summary.skippedProtected.length}, 裁剪跳过 ${summary.skippedFeature.length}`,
    );
    if (summary.conflicts.length > 0 && !allowConflicts) {
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
