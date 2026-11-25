import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptApiKey,
  encryptApiKey,
  ensureModelCipherKey,
  validateConsoleModelUrl,
} from "./model-crypto";

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "model-settings-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("console model cipher key and URL policy", () => {
  it("auto-generates and persists a 64-hex AES-256-GCM key file with 0600 permissions", () => {
    const dir = createTempDir();
    const first = ensureModelCipherKey(dir);
    const keyPath = path.join(dir, ".system", "ai-model.key");

    expect(existsSync(keyPath)).toBe(true);
    expect(first).toHaveLength(32);
    const hex = readFileSync(keyPath, "utf8").trim();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);

    const second = ensureModelCipherKey(dir);
    expect(second.equals(first)).toBe(true);
  });

  it("encrypts and decrypts API keys round-trip with tamper detection", () => {
    const dir = createTempDir();
    const key = ensureModelCipherKey(dir);

    const cipherA = encryptApiKey("sk-test-secret-123", key);
    const cipherB = encryptApiKey("sk-test-secret-123", key);
    expect(cipherA).not.toBe(cipherB);
    expect(cipherA).not.toContain("sk-test-secret-123");
    expect(decryptApiKey(cipherA, key)).toBe("sk-test-secret-123");
    expect(decryptApiKey(cipherB, key)).toBe("sk-test-secret-123");

    const bytes = Buffer.from(cipherA, "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    expect(() => decryptApiKey(bytes.toString("base64"), key)).toThrow();
    expect(() => decryptApiKey(cipherA, Buffer.alloc(32, 7))).toThrow();
  });

  it("allows valid HTTPS/HTTP endpoints and blocks SSRF metadata and malformed URLs", () => {
    expect(
      validateConsoleModelUrl("https://api.openai.com/v1", { nodeEnv: "production" }),
    ).toBeNull();
    expect(
      validateConsoleModelUrl("https://10.0.0.164/v1", { nodeEnv: "production" }),
    ).toBeNull();
    expect(
      validateConsoleModelUrl("http://127.0.0.1:8080/v1", { nodeEnv: "development" }),
    ).toBeNull();
    expect(
      validateConsoleModelUrl("http://10.0.0.164/v1", { nodeEnv: "development" }),
    ).toBeNull();

    expect(
      validateConsoleModelUrl("http://api.openai.com/v1", { nodeEnv: "production" }),
    ).not.toBeNull();
    expect(
      validateConsoleModelUrl("http://fixture:38462/v1", {
        nodeEnv: "production",
        allowHttpHosts: ["fixture"],
      }),
    ).toBeNull();

    for (const blocked of [
      "http://169.254.169.254/latest/meta-data",
      "https://100.100.100.200/v1",
      "https://metadata.google.internal/v1",
      "http://0.0.0.0:8080/v1",
      "http://[::]:8080/v1",
      "http://[fd00:ec2::254]/v1",
      "https://user:pass@api.openai.com/v1",
      "https://api.openai.com/v1?foo=bar",
      "https://api.openai.com/v1#frag",
      "ftp://api.openai.com/v1",
      "not-a-url",
    ]) {
      expect(
        validateConsoleModelUrl(blocked, { nodeEnv: "development" }),
        blocked,
      ).not.toBeNull();
    }
  });
});
