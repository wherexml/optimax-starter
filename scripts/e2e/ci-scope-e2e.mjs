#!/usr/bin/env node
// Real-process E2E verification for scripts/ci-scope.mjs (modeled on duanju CI scope regression).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts/ci-scope.mjs");

const tmp = mkdtempSync(path.join(os.tmpdir(), "starter-ci-scope-"));
const results = [];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runScope(cwd, env = {}, extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

try {
  const repo = path.join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "ci@optimax.local");
  git(repo, "config", "user.name", "CI Verifier");

  mkdirSync(path.join(repo, "apps/server/src"), { recursive: true });
  mkdirSync(path.join(repo, "scripts/e2e"), { recursive: true });
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  writeFileSync(path.join(repo, "README.md"), "# Starter\n");
  writeFileSync(path.join(repo, "apps/server/src/index.ts"), "export const ok = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  const base = git(repo, "rev-parse", "HEAD");

  // 1. Pure docs + standalone manual browser E2E script => full=false & --check passes
  writeFileSync(path.join(repo, "README.md"), "# Starter Updated\n");
  writeFileSync(path.join(repo, "docs/guide.md"), "## Guide\n");
  writeFileSync(path.join(repo, "scripts/e2e/manual-check.mjs"), "export const x = 42;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "docs and e2e script");
  const docsHead = git(repo, "rev-parse", "HEAD");
  const eventPath = path.join(tmp, "event.json");
  const reportPath = path.join(tmp, "report.json");
  writeFileSync(eventPath, JSON.stringify({ before: base, after: docsHead }));

  const r1 = runScope(repo, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    CI_SCOPE_REPORT: reportPath,
  });
  assert.equal(r1.status, 0, `scope push docs failed: ${r1.stderr}`);
  const report1 = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report1.full, false, "docs + manual e2e should be light");
  results.push({ scenario: "docs_and_manual_e2e_light", status: "PASS" });

  const c1 = runScope(repo, {}, ["--check", reportPath]);
  assert.equal(c1.status, 0, `light --check failed: ${c1.stderr}`);
  results.push({ scenario: "light_syntax_check_pass", status: "PASS" });

  // 2. Unresolved merge conflict marker in docs => --check must fail
  writeFileSync(path.join(repo, "README.md"), "# Conflict\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n");
  const c2 = runScope(repo, {}, ["--check", reportPath]);
  assert.notEqual(c2.status, 0, "conflict marker in markdown must fail --check");
  writeFileSync(path.join(repo, "README.md"), "# Starter Updated\n");
  results.push({ scenario: "conflict_marker_rejected", status: "PASS" });

  // 3. Syntax error in standalone E2E mjs => --check must fail
  writeFileSync(path.join(repo, "scripts/e2e/manual-check.mjs"), "export const x = ;\n");
  const c3 = runScope(repo, {}, ["--check", reportPath]);
  assert.notEqual(c3.status, 0, "invalid JS syntax in manual e2e must fail --check");
  git(repo, "checkout", "--", ".");
  results.push({ scenario: "broken_e2e_syntax_rejected", status: "PASS" });

  // 4. Gate script (scripts/verify-console.py) => must force full=true
  writeFileSync(path.join(repo, "scripts/verify-console.py"), "print('ok')\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "touch gate script");
  const gateHead = git(repo, "rev-parse", "HEAD");
  writeFileSync(eventPath, JSON.stringify({ before: docsHead, after: gateHead }));
  const r4 = runScope(repo, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    CI_SCOPE_REPORT: reportPath,
  });
  assert.equal(r4.status, 0);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).full, true, "gate script must trigger full CI");
  results.push({ scenario: "gate_script_forces_full", status: "PASS" });

  // 5. Move application file into docs/ => --no-renames must detect deletion in apps/ and force full=true
  git(repo, "mv", "apps/server/src/index.ts", "docs/index.md");
  git(repo, "commit", "-m", "move app file out");
  const moveHead = git(repo, "rev-parse", "HEAD");
  writeFileSync(eventPath, JSON.stringify({ before: gateHead, after: moveHead }));
  const r5 = runScope(repo, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    CI_SCOPE_REPORT: reportPath,
  });
  assert.equal(r5.status, 0);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).full, true, "moving app file must trigger full CI");
  results.push({ scenario: "rename_out_of_app_forces_full", status: "PASS" });

  // 6. Contract source or JSON Schema artifact change => must force full=true (LA-04)
  mkdirSync(path.join(repo, "packages/api/src"), { recursive: true });
  mkdirSync(path.join(repo, "packages/api/json-schema"), { recursive: true });
  writeFileSync(path.join(repo, "packages/api/src/contracts.ts"), "export const x = 1;\n");
  writeFileSync(path.join(repo, "packages/api/json-schema/index.json"), "{}\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "contract source and artifact");
  const contractHead = git(repo, "rev-parse", "HEAD");
  writeFileSync(eventPath, JSON.stringify({ before: moveHead, after: contractHead }));
  const r6 = runScope(repo, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    CI_SCOPE_REPORT: reportPath,
  });
  assert.equal(r6.status, 0);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).full, true, "contract src/artifact changes must trigger full CI");
  results.push({ scenario: "contract_changes_force_full", status: "PASS" });

  // 7. Contract artifact-only change => still full=true (artifact edits are application changes)
  writeFileSync(path.join(repo, "packages/api/json-schema/index.json"), '{"touched":true}\n');
  git(repo, "add", ".");
  git(repo, "commit", "-m", "artifact only");
  const artifactHead = git(repo, "rev-parse", "HEAD");
  writeFileSync(eventPath, JSON.stringify({ before: contractHead, after: artifactHead }));
  const r7 = runScope(repo, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    CI_SCOPE_REPORT: reportPath,
  });
  assert.equal(r7.status, 0);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).full, true, "artifact-only change must trigger full CI");
  results.push({ scenario: "artifact_only_forces_full", status: "PASS" });

  // 8. workflow_dispatch or missing SHA => fail-closed full=true
  writeFileSync(eventPath, JSON.stringify({}));
  const r8 = runScope(repo, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_EVENT_PATH: eventPath,
    CI_SCOPE_REPORT: reportPath,
  });
  assert.equal(r8.status, 0);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).full, true, "workflow_dispatch must force full CI");
  results.push({ scenario: "workflow_dispatch_fail_closed_full", status: "PASS" });

  if (process.env.CI_SCOPE_E2E_REPORT) {
    writeFileSync(process.env.CI_SCOPE_E2E_REPORT, JSON.stringify({ status: "PASS", results }, null, 2) + "\n");
  }
  console.log("PASS ci-scope-e2e:", results.map((r) => r.scenario).join(", "));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
