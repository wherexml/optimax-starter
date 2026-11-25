import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getUploadDir } from "../core/storage";

export const MODEL_SETTING_KEY = "ai.model";
const MODEL_KEY_AAD = Buffer.from(MODEL_SETTING_KEY);
const HEX_64_RE = /^[0-9a-fA-F]{64}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const BLOCKED_METADATA_HOSTS = new Set([
  "169.254.169.254",
  "100.100.100.200",
  "metadata.google.internal",
  "metadata",
  "0.0.0.0",
  "::",
  "fd00:ec2::254",
]);

const keyCache = new Map<string, Buffer>();

function readExistingHexKey(keyPath: string): Buffer | null {
  let fd: number;
  try {
    fd = openSync(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 4096 || (stat.mode & 0o002) !== 0) {
      throw new Error("模型密钥文件权限或类型无效");
    }
    const raw = readFileSync(fd, "utf8").trim();
    if (!HEX_64_RE.test(raw)) {
      throw new Error("模型密钥文件格式无效");
    }
    return Buffer.from(raw, "hex");
  } finally {
    closeSync(fd);
  }
}

/** Ensures a persistent 32-byte AES-256-GCM key exists under `<baseDir>/.system/ai-model.key`. */
export function ensureModelCipherKey(baseDir = getUploadDir()): Buffer {
  const systemDir = path.resolve(baseDir, ".system");
  const keyPath = path.join(systemDir, "ai-model.key");
  const cached = keyCache.get(keyPath);
  if (cached) return cached;

  mkdirSync(systemDir, { recursive: true, mode: 0o700 });
  const existing = readExistingHexKey(keyPath);
  if (existing) {
    keyCache.set(keyPath, existing);
    return existing;
  }

  const generated = randomBytes(32);
  const hex = `${generated.toString("hex")}\n`;
  try {
    const fd = openSync(keyPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeFileSync(fd, hex, "utf8");
    } finally {
      closeSync(fd);
    }
    chmodSync(keyPath, 0o600);
    keyCache.set(keyPath, generated);
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const concurrent = readExistingHexKey(keyPath);
      if (concurrent) {
        keyCache.set(keyPath, concurrent);
        return concurrent;
      }
    }
    throw error;
  }
}

export function encryptApiKey(plain: string, key = ensureModelCipherKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MODEL_KEY_AAD);
  return Buffer.concat([
    iv,
    cipher.update(plain, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

export function decryptApiKey(cipherText: string, key = ensureModelCipherKey()): string {
  const bytes = Buffer.from(cipherText, "base64");
  if (bytes.length < 28) {
    throw new Error("模型密钥密文长度无效");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(MODEL_KEY_AAD);
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(
    "utf8",
  );
}

/** Validates model endpoint URL against SSRF metadata endpoints and production TLS policy. */
export function validateConsoleModelUrl(
  raw: string,
  options?: { nodeEnv?: string; allowHttpHosts?: string[] },
): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "API 地址需为不含账号、查询参数的 http(s) URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "API 地址需为不含账号、查询参数的 http(s) URL";
  }
  if (url.username || url.password || url.search || url.hash || !url.hostname) {
    return "API 地址需为不含账号、查询参数的 http(s) URL";
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    BLOCKED_METADATA_HOSTS.has(host) ||
    host.startsWith("169.254.") ||
    /^fe[89ab][0-9a-f]?:/i.test(host)
  ) {
    return "安全策略禁止访问该保留或元数据地址";
  }

  if (url.protocol === "https:") return null;

  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv !== "production") return null;

  const allowed = (options?.allowHttpHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(host) || LOOPBACK_HOSTS.has(host)) return null;

  return "生产环境模型 API 地址必须使用 https://";
}
