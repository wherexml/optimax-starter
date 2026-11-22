// Attachment storage: local directory (default) or S3-compatible object storage via a zero-dependency
// AWS SigV4 signer (node:crypto + fetch). Also hosts the strict upload validator.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ATTACHMENT_ALLOWED_EXTENSIONS, ATTACHMENT_DEFAULT_MAX_BYTES } from "@optimax-starter/api";

export interface StorageDriver {
  readonly driverName: "local" | "s3";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Idempotent: deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,255}$/;

/** Rejects traversal (`..`), absolute paths, backslashes and empty segments. */
export function assertSafeStorageKey(key: string): void {
  if (
    !KEY_RE.test(key) ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    throw new Error("invalid storage key");
  }
}

/** Server-generated key; never derived from the user-supplied filename. */
/** `prefix` is a registered attachment entity type (e.g. "asset", "job"). */
export function newStorageKey(prefix: string, ext: string): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(prefix)) throw new Error("invalid storage key prefix");
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : "";
  return `${prefix}/${ym}/${randomBytes(16).toString("hex")}${safeExt}`;
}

// ---------------------------------------------------------------------------
// Local driver
// ---------------------------------------------------------------------------
export function resolveInside(baseDir: string, key: string): string {
  assertSafeStorageKey(key);
  const base = path.resolve(baseDir);
  const full = path.resolve(base, key);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error("storage key escapes base directory");
  }
  if (full === base) throw new Error("invalid storage key");
  return full;
}

export class LocalStorageDriver implements StorageDriver {
  readonly driverName = "local" as const;
  constructor(readonly baseDir: string) {}

  async put(key: string, data: Uint8Array): Promise<void> {
    const full = resolveInside(this.baseDir, key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
    const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, data, { mode: 0o640, flag: "wx" });
      await rename(tmp, full);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const full = resolveInside(this.baseDir, key);
    try {
      return new Uint8Array(await readFile(full));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const full = resolveInside(this.baseDir, key);
    await unlink(full).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

// ---------------------------------------------------------------------------
// AWS Signature V4 (pure, exported for unit tests)
// ---------------------------------------------------------------------------
const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as required by SigV4 (keeps `/` when encoding a path). */
export function sigV4Encode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

export type SigV4Input = {
  method: string;
  url: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** yyyymmddThhmmssZ */
  amzDate: string;
  payloadHash: string;
  headers?: Record<string, string>;
};

export type SigV4Result = {
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  authorization: string;
  signedHeaders: string;
  headers: Record<string, string>;
};

export function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function signSigV4(input: SigV4Input): SigV4Result {
  const service = input.service ?? "s3";
  const url = new URL(input.url);
  const dateStamp = input.amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": input.amzDate,
  };
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const canonicalUri = url.pathname
    .split("/")
    .map((seg) => sigV4Encode(decodeURIComponent(seg)))
    .join("/") || "/";
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [sigV4Encode(k), sigV4Encode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { canonicalRequest, stringToSign, signature, authorization, signedHeaders, headers };
}

// ---------------------------------------------------------------------------
// S3 driver (path-style URLs: <endpoint>/<bucket>/<key>; works with AWS, MinIO, R2, OSS-compatible)
// ---------------------------------------------------------------------------
export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class S3StorageDriver implements StorageDriver {
  readonly driverName = "s3" as const;
  constructor(private readonly config: S3Config) {}

  private objectUrl(key: string): string {
    assertSafeStorageKey(key);
    const base = this.config.endpoint.replace(/\/+$/, "");
    return `${base}/${sigV4Encode(this.config.bucket)}/${sigV4Encode(key, true)}`;
  }

  private async send(method: "PUT" | "GET" | "DELETE", key: string, body?: Uint8Array, contentType?: string) {
    const url = this.objectUrl(key);
    const payloadHash = sha256Hex(body ?? new Uint8Array());
    const extra: Record<string, string> = contentType ? { "content-type": contentType } : {};
    const signed = signSigV4({
      method,
      url,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      amzDate: toAmzDate(new Date()),
      payloadHash,
      headers: extra,
    });
    const { host: _host, ...sendHeaders } = signed.headers;
    return fetch(url, {
      method,
      headers: { ...sendHeaders, authorization: signed.authorization },
      body: body ? Buffer.from(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const res = await this.send("PUT", key, data, contentType);
    if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 get failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export function getUploadDir(): string {
  return process.env.STARTER_UPLOAD_DIR?.trim() || "./data/uploads";
}

export function parseUploadMaxBytes(raw: string | undefined): number {
  const n = Number(raw?.trim());
  if (!raw?.trim() || !Number.isSafeInteger(n) || n <= 0) return ATTACHMENT_DEFAULT_MAX_BYTES;
  return Math.min(n, 100 * 1024 * 1024);
}

export function getUploadMaxBytes(): number {
  return parseUploadMaxBytes(process.env.STARTER_UPLOAD_MAX_BYTES);
}

function readSecret(value: string | undefined, file: string | undefined): string {
  const filePath = file?.trim();
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch {
      return "";
    }
  }
  return value?.trim() ?? "";
}

export function getS3Config(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  if (env.STARTER_STORAGE_DRIVER?.trim() !== "s3") return null;
  const config = {
    endpoint: env.STARTER_S3_ENDPOINT?.trim() ?? "",
    bucket: env.STARTER_S3_BUCKET?.trim() ?? "",
    region: env.STARTER_S3_REGION?.trim() ?? "",
    accessKeyId: env.STARTER_S3_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: readSecret(env.STARTER_S3_SECRET_ACCESS_KEY, env.STARTER_S3_SECRET_ACCESS_KEY_FILE),
  };
  if (Object.values(config).some((v) => !v)) return null;
  return config;
}

let driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (!driver) {
    const s3 = getS3Config();
    if (process.env.STARTER_STORAGE_DRIVER?.trim() === "s3" && !s3) {
      console.warn("STARTER_STORAGE_DRIVER=s3 but S3 settings are incomplete; falling back to local storage");
    }
    driver = s3 ? new S3StorageDriver(s3) : new LocalStorageDriver(getUploadDir());
  }
  return driver;
}

/** Test hook. */
export function setStorageDriverForTests(next: StorageDriver | null): void {
  driver = next;
}

/** Best-effort deletion after a committed DB change; failures are logged, never surfaced. */
export async function deleteStoredObjects(keys: readonly string[]): Promise<void> {
  const storage = getStorageDriver();
  await Promise.all(
    keys.map((key) =>
      storage.delete(key).catch((error: unknown) => {
        console.warn("attachment object cleanup failed", (error as Error)?.name ?? "Error");
      }),
    ),
  );
}

export const sha256OfBytes = (bytes: Uint8Array) => sha256Hex(bytes);

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------
export const ALLOWED_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set(ATTACHMENT_ALLOWED_EXTENSIONS);

export const BLOCKED_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  ".html",
  ".htm",
  ".xhtml",
  ".svg",
  ".svgz",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".php",
  ".jsp",
  ".xml",
]);

const STORED_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

const TEXT_EXTENSIONS = new Set([".csv", ".txt", ".md", ".json"]);

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function magicMatches(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case ".pdf":
      return startsWith(bytes, ascii("%PDF-"));
    case ".png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case ".webp":
      return startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8);
    case ".xlsx":
    case ".docx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return true;
  }
}

const ACTIVE_CONTENT_RE = /<\s*script\b|<\s*svg\b|<!doctype\s+html|<\s*html\b/i;

/** Strips directories, control characters and quotes; caps at 180 chars (keeping the extension). */
export function sanitizeOriginalName(filename: string): string {
  const base = path.posix.basename(path.win32.basename(filename ?? ""));
  let cleaned = base.replace(/[\u0000-\u001f\u007f"'`\\]/g, "").trim();
  if (cleaned.length > 180) {
    const ext = path.extname(cleaned).slice(0, 10);
    cleaned = cleaned.slice(0, 180 - ext.length) + ext;
  }
  return cleaned;
}

export type UploadValidation =
  | { ok: true; ext: string; safeName: string; storedMime: string }
  | { ok: false; status: 400 | 413 | 415; code: string; message: string };

export function validateUploadFile(input: {
  filename: string;
  declaredMime?: string | null;
  bytes: Uint8Array;
  maxBytes?: number;
}): UploadValidation {
  const maxBytes = input.maxBytes ?? getUploadMaxBytes();
  const safeName = sanitizeOriginalName(input.filename);
  if (!safeName || safeName === "." || safeName === "..") {
    return { ok: false, status: 400, code: "VALIDATION_BAD_REQUEST", message: "文件名无效" };
  }
  if (input.bytes.byteLength === 0) {
    return { ok: false, status: 400, code: "VALIDATION_BAD_REQUEST", message: "文件为空" };
  }
  if (input.bytes.byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: "FILE_TOO_LARGE",
      message: `文件超过 ${Math.round(maxBytes / 1024 / 1024)} MiB 上限`,
    };
  }
  const ext = path.extname(safeName).toLowerCase();
  // Double extensions such as report.html.pdf are fine (last wins), but any blocked inner
  // extension like evil.php.txt is rejected as a defence against misconfigured servers.
  const inner = safeName.toLowerCase().split(".").slice(1, -1).map((p) => `.${p}`);
  if (BLOCKED_UPLOAD_EXTENSIONS.has(ext) || inner.some((p) => BLOCKED_UPLOAD_EXTENSIONS.has(p))) {
    return { ok: false, status: 415, code: "FILE_TYPE_BLOCKED", message: "不允许上传该类型文件" };
  }
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return { ok: false, status: 415, code: "FILE_TYPE_BLOCKED", message: "仅支持 PDF、图片、CSV、Excel、Word、文本、Markdown 与 JSON 文件" };
  }
  const declared = (input.declaredMime ?? "").toLowerCase();
  if (/html|svg|javascript|ecmascript|x-sh|x-php|xml/.test(declared)) {
    return { ok: false, status: 415, code: "FILE_TYPE_BLOCKED", message: "文件类型与扩展名不符" };
  }
  if (!magicMatches(ext, input.bytes)) {
    return { ok: false, status: 415, code: "FILE_TYPE_MISMATCH", message: "文件内容与扩展名不符" };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    if (input.bytes.includes(0)) {
      return { ok: false, status: 415, code: "FILE_TYPE_MISMATCH", message: "文本文件包含二进制内容" };
    }
    const head = Buffer.from(input.bytes).toString("utf8");
    if (ACTIVE_CONTENT_RE.test(head)) {
      return { ok: false, status: 415, code: "FILE_TYPE_BLOCKED", message: "文本文件包含可执行网页内容" };
    }
  }
  return { ok: true, ext, safeName, storedMime: STORED_MIME[ext] ?? "application/octet-stream" };
}
