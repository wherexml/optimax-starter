#!/usr/bin/env node
// Opt-in configuration helper for Feishu Enterprise OAuth 2.0 + PKCE login.
// Reads/updates .env and optional 0600 private secret file without ever printing secret values.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_LABEL = "使用飞书登录";

function parseArgs(argv) {
  const opts = {
    mode: "status",
    root: DEFAULT_ROOT,
    appId: "",
    tenantKey: "",
    secretFile: "",
    label: "",
    redirectUri: "",
    autoProvision: undefined,
    allowEmailLink: undefined,
    feishuOnly: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`参数 ${arg} 缺少取值`);
      return argv[++i];
    };
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--status") opts.mode = "status";
    else if (arg === "--enable") opts.mode = "enable";
    else if (arg === "--disable") opts.mode = "disable";
    else if (arg === "--root") opts.root = path.resolve(next());
    else if (arg === "--app-id") opts.appId = next().trim();
    else if (arg === "--tenant-key") opts.tenantKey = next().trim();
    else if (arg === "--secret-file") opts.secretFile = next().trim();
    else if (arg === "--label") opts.label = next().trim();
    else if (arg === "--redirect-uri") opts.redirectUri = next().trim();
    else if (arg === "--auto-provision") opts.autoProvision = true;
    else if (arg === "--no-auto-provision") opts.autoProvision = false;
    else if (arg === "--allow-email-link") opts.allowEmailLink = true;
    else if (arg === "--no-allow-email-link") opts.allowEmailLink = false;
    else if (arg === "--feishu-only") opts.feishuOnly = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return opts;
}

function parseEnv(raw) {
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    map.set(key, value);
  }
  return map;
}

function formatEnvValue(value) {
  if (/[\s#]/.test(value) && !/^["'].*["']$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function upsertEnvText(raw, updates) {
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const remaining = new Map(updates);
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = line.indexOf("=");
    if (eq <= 0) return line;
    const key = line.slice(0, eq).trim();
    if (!remaining.has(key)) return line;
    const val = remaining.get(key);
    remaining.delete(key);
    return `${key}=${formatEnvValue(val)}`;
  });

  if (remaining.size > 0) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    for (const [key, val] of remaining.entries()) {
      nextLines.push(`${key}=${formatEnvValue(val)}`);
    }
  }
  return `${nextLines.join("\n")}\n`;
}

function resolveFilePath(root, filePath) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function deriveCallbackUrl(env) {
  const explicit = env.get("AUTH_FEISHU_REDIRECT_URI")?.trim();
  if (explicit) return explicit;
  const webPort = env.get("WEB_PORT")?.trim() || "38140";
  const origin = (env.get("CORS_ORIGIN")?.trim() || `http://127.0.0.1:${webPort}`).replace(
    /\/+$/,
    "",
  );
  return `${origin}/console/auth/sso/feishu/callback`;
}

function inspectState(root, envPath, env) {
  const secretFileSetting = env.get("AUTH_FEISHU_APP_SECRET_FILE")?.trim() || "";
  const resolvedSecretFile = resolveFilePath(root, secretFileSetting);
  const secretFileExists = Boolean(resolvedSecretFile && existsSync(resolvedSecretFile));
  let secretFileMode = null;
  if (secretFileExists) {
    secretFileMode = `0${(statSync(resolvedSecretFile).mode & 0o777).toString(8)}`;
  }
  const hasInlineSecret = Boolean(env.get("AUTH_FEISHU_APP_SECRET")?.trim());
  const secretSource = secretFileSetting
    ? "file"
    : hasInlineSecret
      ? "env"
      : "missing";

  const warnings = [];
  if (env.get("AUTH_FEISHU_ENABLED") === "true" && secretSource === "missing") {
    warnings.push("未配置 AUTH_FEISHU_APP_SECRET_FILE 或 AUTH_FEISHU_APP_SECRET，服务端将保持关闭状态");
  }
  if (secretFileSetting && !secretFileExists && !secretFileSetting.startsWith("/run/secrets/")) {
    warnings.push(`密钥文件尚不存在: ${secretFileSetting}`);
  }

  return {
    envPath,
    enabled: env.get("AUTH_FEISHU_ENABLED") === "true",
    passwordLoginEnabled: env.get("AUTH_PASSWORD_LOGIN_ENABLED") !== "false",
    autoProvision: env.get("AUTH_FEISHU_AUTO_PROVISION") === "true",
    allowEmailLink: env.get("AUTH_FEISHU_ALLOW_EMAIL_LINK") !== "false",
    appIdConfigured: Boolean(env.get("AUTH_FEISHU_APP_ID")?.trim()),
    tenantKeyConfigured: Boolean(env.get("AUTH_FEISHU_TENANT_KEY")?.trim()),
    label: env.get("AUTH_FEISHU_LABEL")?.trim() || DEFAULT_LABEL,
    callbackUrl: deriveCallbackUrl(env),
    secretSource,
    secretFile: secretFileSetting || null,
    secretFileExists,
    secretFileMode,
    warnings,
  };
}

export function configureFeishuAuth(argv = process.argv.slice(2), options = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    return {
      mode: "help",
      text: [
        "用法:",
        "  node .agents/skills/feishu-auth/scripts/configure-feishu-auth.mjs --status",
        "  node .agents/skills/feishu-auth/scripts/configure-feishu-auth.mjs --enable --app-id <cli_xxx> --tenant-key <key> [--secret-file ./.local/feishu-app-secret] [--auto-provision] [--feishu-only] [--label 文案]",
        "  node .agents/skills/feishu-auth/scripts/configure-feishu-auth.mjs --disable",
      ].join("\n"),
    };
  }

  const envPath = path.join(opts.root, ".env");
  const rawEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const env = parseEnv(rawEnv);

  if (opts.mode === "status") {
    return { mode: "status", ...inspectState(opts.root, envPath, env) };
  }

  if (opts.mode === "disable") {
    const updates = new Map([
      ["AUTH_FEISHU_ENABLED", "false"],
      ["AUTH_PASSWORD_LOGIN_ENABLED", "true"],
    ]);
    const nextRaw = upsertEnvText(rawEnv, updates);
    writeFileSync(envPath, nextRaw, { encoding: "utf8", mode: 0o600 });
    return { mode: "disable", ...inspectState(opts.root, envPath, parseEnv(nextRaw)) };
  }

  // Enable mode
  const appId = opts.appId || env.get("AUTH_FEISHU_APP_ID")?.trim() || "";
  const tenantKey = opts.tenantKey || env.get("AUTH_FEISHU_TENANT_KEY")?.trim() || "";
  if (!appId) throw new Error("启用飞书登录缺少 --app-id（且 .env 中未配置 AUTH_FEISHU_APP_ID）");
  if (!tenantKey) {
    throw new Error("启用飞书登录缺少 --tenant-key（且 .env 中未配置 AUTH_FEISHU_TENANT_KEY）");
  }

  const secretInput = (options.secretInput ?? process.env.AUTH_FEISHU_APP_SECRET_INPUT ?? "").trim();
  const secretFileArg = opts.secretFile || env.get("AUTH_FEISHU_APP_SECRET_FILE")?.trim() || "";

  if (secretFileArg && !secretFileArg.startsWith("/run/secrets/")) {
    const resolvedSecret = resolveFilePath(opts.root, secretFileArg);
    if (secretInput) {
      mkdirSync(path.dirname(resolvedSecret), { recursive: true, mode: 0o700 });
      writeFileSync(resolvedSecret, `${secretInput}\n`, { encoding: "utf8", mode: 0o600 });
      chmodSync(resolvedSecret, 0o600);
    } else if (existsSync(resolvedSecret)) {
      chmodSync(resolvedSecret, 0o600);
    }
  } else if (secretInput && !secretFileArg) {
    throw new Error("提供密钥输入时必须指定 --secret-file（绝不将密钥明文写入 .env）");
  }

  const updates = new Map([
    ["AUTH_FEISHU_ENABLED", "true"],
    ["AUTH_FEISHU_APP_ID", appId],
    ["AUTH_FEISHU_TENANT_KEY", tenantKey],
    ["AUTH_FEISHU_LABEL", opts.label || env.get("AUTH_FEISHU_LABEL")?.trim() || DEFAULT_LABEL],
    [
      "AUTH_FEISHU_ALLOW_EMAIL_LINK",
      String(opts.allowEmailLink ?? env.get("AUTH_FEISHU_ALLOW_EMAIL_LINK") !== "false"),
    ],
    ["AUTH_FEISHU_AUTO_PROVISION", String(opts.autoProvision ?? false)],
    ["AUTH_PASSWORD_LOGIN_ENABLED", String(!opts.feishuOnly)],
  ]);
  if (secretFileArg) updates.set("AUTH_FEISHU_APP_SECRET_FILE", secretFileArg);
  if (opts.redirectUri) updates.set("AUTH_FEISHU_REDIRECT_URI", opts.redirectUri);

  const nextRaw = upsertEnvText(rawEnv, updates);
  writeFileSync(envPath, nextRaw, { encoding: "utf8", mode: 0o600 });
  return { mode: "enable", ...inspectState(opts.root, envPath, parseEnv(nextRaw)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const res = configureFeishuAuth(process.argv.slice(2));
    if (res.mode === "help") {
      console.log(res.text);
    } else {
      console.log(JSON.stringify(res, null, 2));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
