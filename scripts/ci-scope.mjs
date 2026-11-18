// Conservative CI scope classifier for optimax-starter (modeled on duanju/scripts/ci-scope.mjs).
// Only standalone Markdown docs and manual browser E2E scripts qualify for light checks;
// all application code, schemas, Docker/Compose, workflows, and CI gate scripts force full CI.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const GATE_SCRIPTS = new Set([
  "scripts/e2e/ci-scope-e2e.mjs",
  "scripts/e2e/asset-agent-api.py",
]);

function kind(file) {
  if (GATE_SCRIPTS.has(file)) return "application";
  // 契约源或 JSON Schema 产物的任何变更都强制 full CI（LA-04：产物必须与源同步提交）。
  if (/^packages\/api\/(?:src|json-schema)\//.test(file)) return "application";
  // Laravel PHP 栈属于应用路径（LB-01：任何 apps/api-laravel/** 变更强制 full CI）。
  if (/^apps\/api-laravel\//.test(file)) return "application";
  if (/^[A-Za-z0-9_-]+\.md$/.test(file) || /^docs\/.+\.md$/.test(file)) {
    return "document";
  }
  if (/^scripts\/e2e\/.+\.(?:mjs|js)$/.test(file)) {
    return "acceptance";
  }
  return "application";
}

function check(report) {
  if (report.full) throw new Error("Light checks require a light scope report");
  for (const file of report.files) {
    if (!existsSync(file)) continue; // Deleted files still participated in classification.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
    if (text.includes("\0") || /^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)) {
      throw new Error(`${file}: binary content or unresolved merge conflict marker`);
    }
    if (kind(file) === "acceptance") {
      execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
    }
    console.log(`PASS ${kind(file)} check: ${file}`);
  }
}

if (process.argv[2] === "--check") {
  check(JSON.parse(readFileSync(process.argv[3], "utf8")));
} else {
  const report = {
    full: true,
    reason: "unknown event or unavailable comparison",
    files: [],
  };
  try {
    const name = process.env.GITHUB_EVENT_NAME;
    const forceFull = process.env.CI_FORCE_FULL === "true";
    if (forceFull || name === "workflow_dispatch") {
      report.reason = "manual dispatch or CI_FORCE_FULL forces full validation";
    } else if (name === "push" || name === "pull_request") {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      const head = name === "push" ? event.after : event.pull_request?.head?.sha;
      let base = name === "push" ? event.before : event.pull_request?.base?.sha;
      if (![head, base].every((x) => typeof x === "string" && /^[0-9a-f]{40}$/.test(x) && !/^0+$/.test(x))) {
        throw new Error("missing or zero commit SHA");
      }
      git("cat-file", "-e", `${head}^{commit}`);
      git("cat-file", "-e", `${base}^{commit}`);
      if (name === "pull_request") base = git("merge-base", base, head).trim();
      // --no-renames ensures moving files out of application paths is visible as an application deletion.
      report.files = git("diff", "--no-renames", "--name-only", "-z", base, head, "--")
        .split("\0")
        .filter(Boolean);
      const special = report.files.some((file) =>
        [base, head].some((ref) => {
          const entry = git("ls-tree", ref, "--", file);
          return entry && !entry.startsWith("100644 ") && !entry.startsWith("100755 ");
        }),
      );
      report.full =
        !report.files.length ||
        special ||
        report.files.some((file) => kind(file) === "application");
      report.reason = report.full
        ? "application, gate script, config, special file or empty comparison"
        : "documents and standalone manual E2E scripts only";
      report.base = base;
      report.head = head;
    }
  } catch (error) {
    report.reason = `full fallback: ${String(error.message ?? error).split("\n")[0]}`;
  }

  const output =
    process.env.CI_SCOPE_REPORT ||
    path.join(process.env.RUNNER_TEMP || ".", "ci-scope.json");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `full=${report.full}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### CI Scope\n\n- Mode: **${report.full ? "Full validation (application release eligible)" : "Light checks (no application deployment)"}**\n- Reason: ${report.reason}\n- Changed paths: ${report.files.length}\n`,
    );
  }
  console.log(JSON.stringify(report));
}
