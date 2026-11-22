// Keeps docs/onboarding.html's embedded CLI contract in exact sync with the real scripts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

const html = read("docs/onboarding.html");
const bootstrap = read("scripts/bootstrap-project.sh");
const genModule = read("scripts/gen-module.mjs");
const genFields = read("scripts/lib/gen-module-fields.mjs");
const deploy = read("scripts/deploy-production.sh");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

type Contract = {
  contractVersion: string;
  bootstrapSlugPattern: string;
  bootstrapFlags: string[];
  genModuleSlugPattern: string;
  genModuleFlags: string[];
  genModuleReservedSlugs: string[];
  genModuleFieldNamePattern: string;
  genModuleFieldTypes: string[];
  genModuleReservedColumns: string[];
  deployFlags: string[];
  npmScripts: string[];
};

function readContract(): Contract {
  const match = html.match(
    /<script type="application\/json" id="onboarding-cli-contract">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("docs/onboarding.html 缺少 onboarding-cli-contract");
  return JSON.parse(match[1]!) as Contract;
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

function all(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => m[1]!);
}

function setLiteral(name: string, text: string): string[] {
  const match = text.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!match) throw new Error(`未找到 ${name}`);
  return all(/"([^"]+)"/g, match[1]!);
}

/** Option patterns of `case` arms inside bootstrap's argument-parsing while-loop. */
function bootstrapFlags(): string[] {
  const loop = bootstrap.slice(bootstrap.indexOf("while [[ $# -gt 0 ]]; do"));
  const body = loop.slice(0, loop.indexOf("\ndone"));
  return all(/^\s{4}([^\s()*]+)\)\s*$/gm, body)
    .flatMap((arm) => arm.split("|"))
    .filter((flag) => flag.startsWith("-"));
}

function deployFlags(): string[] {
  // Top-level `case` argument dispatch at column 0.
  const dispatch = deploy.slice(deploy.search(/^case "\$\{1:-\}" in$/m));
  return [
    ...all(/^\s{2}(--[\w-]+)\)\s*$/gm, dispatch),
    ...all(/== "(--[\w-]+)"/g, dispatch),
  ];
}

const contract = readContract();

describe("onboarding CLI contract", () => {
  it("has a contract version", () => {
    expect(contract.contractVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("bootstrap flags and slug pattern match scripts/bootstrap-project.sh", () => {
    expect(sorted(contract.bootstrapFlags)).toEqual(contract.bootstrapFlags.slice().sort());
    expect(sorted(contract.bootstrapFlags)).toEqual(sorted(bootstrapFlags()));
    const slugRe = bootstrap.match(/"\$SLUG" =~ (\S+) \]\]/)?.[1];
    expect(contract.bootstrapSlugPattern).toBe(slugRe);
  });

  it("gen:module flags, slug pattern and reserved slugs match scripts/gen-module.mjs", () => {
    const flags = [
      ...all(/args\[i\] === "(--[\w-]+)"/g, genModule),
      ...all(/args\.includes\("(-[\w-]+)"\)/g, genModule),
    ];
    expect(sorted(contract.genModuleFlags)).toEqual(sorted(flags));
    const slugRe = genModule.match(/if \(!\/(\^[^/]+\$)\/\.test\(slug\)/)?.[1];
    expect(contract.genModuleSlugPattern).toBe(slugRe);
    expect(sorted(contract.genModuleReservedSlugs)).toEqual(
      sorted(setLiteral("RESERVED", genModule)),
    );
  });

  it("field types, reserved columns and name pattern match gen-module-fields.mjs", () => {
    expect(sorted(contract.genModuleFieldTypes)).toEqual(
      sorted(setLiteral("SUPPORTED_TYPES", genFields)),
    );
    expect(sorted(contract.genModuleReservedColumns)).toEqual(
      sorted(setLiteral("RESERVED_NAMES", genFields)),
    );
    const nameRe = genFields.match(/if \(!\/(\^[^/]+\$)\/\.test\(name\)\)/)?.[1];
    expect(contract.genModuleFieldNamePattern).toBe(nameRe);
  });

  it("deploy flags match scripts/deploy-production.sh", () => {
    expect(sorted(contract.deployFlags)).toEqual(sorted(deployFlags()));
  });

  it("npm scripts match package.json exactly", () => {
    expect(sorted(contract.npmScripts)).toEqual(sorted(Object.keys(pkg.scripts)));
  });
});

describe("onboarding page hygiene", () => {
  it("loads no external scripts or stylesheets", () => {
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\//i);
    expect(html).not.toMatch(/<link\b[^>]*\bhref\s*=\s*["']?(https?:)?\/\//i);
  });

  it("renders no U+00B7 middle dot", () => {
    const visible = html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "");
    expect(visible).not.toContain("·");
    // Strings rendered by the inline script count as visible text too.
    expect(html).not.toContain("·");
    expect(html).not.toContain("&middot;");
    expect(html).not.toContain("&#183;");
  });
});
