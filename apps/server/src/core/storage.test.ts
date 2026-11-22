// Pure upload validation, storage key safety and SigV4 signing (no DB, no network).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  LocalStorageDriver,
  assertSafeStorageKey,
  magicMatches,
  newStorageKey,
  resolveInside,
  sanitizeOriginalName,
  sigV4Encode,
  signSigV4,
  toAmzDate,
  validateUploadFile,
} from "./storage";

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...enc(p)] : p)));

const PDF = bytes("%PDF-1.7\n%âãÏÓ\n");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const MiB = 1024 * 1024;

const validate = (filename: string, data: Uint8Array, declaredMime?: string, maxBytes = 10 * MiB) =>
  validateUploadFile({ filename, bytes: data, declaredMime, maxBytes });

describe("upload extension whitelist", () => {
  it("accepts every whitelisted extension with matching content", () => {
    const samples: Record<string, Uint8Array> = {
      ".pdf": PDF,
      ".png": PNG,
      ".jpg": JPEG,
      ".jpeg": JPEG,
      ".webp": WEBP,
      ".xlsx": ZIP,
      ".docx": ZIP,
      ".csv": enc("名称,业务域\n门户,采购\n"),
      ".txt": enc("plain text"),
      ".md": enc("# 标题\n正文"),
      ".json": enc('{"ok":true}'),
    };
    expect(new Set(Object.keys(samples))).toEqual(new Set(ALLOWED_UPLOAD_EXTENSIONS));
    for (const [ext, data] of Object.entries(samples)) {
      const result = validate(`file${ext}`, data);
      expect(result, ext).toMatchObject({ ok: true, ext });
    }
  });

  it("maps stored MIME from the extension, never from the client", () => {
    const result = validate("a.png", PNG, "application/octet-stream");
    expect(result).toMatchObject({ ok: true, storedMime: "image/png" });
  });

  it("normalises extension case", () => {
    expect(validate("SCAN.PDF", PDF)).toMatchObject({ ok: true, ext: ".pdf" });
  });

  it.each([".html", ".htm", ".svg", ".js", ".exe", ".sh"])("explicitly blocks %s", (ext) => {
    expect(validate(`payload${ext}`, enc("x"))).toMatchObject({
      ok: false,
      status: 415,
      code: "FILE_TYPE_BLOCKED",
    });
  });

  it("blocks dangerous inner extensions (evil.php.txt, x.html.pdf is allowed)", () => {
    expect(validate("evil.php.txt", enc("x"))).toMatchObject({ ok: false, code: "FILE_TYPE_BLOCKED" });
    expect(validate("page.html.txt", enc("x"))).toMatchObject({ ok: false, code: "FILE_TYPE_BLOCKED" });
  });

  it("rejects extensions outside the whitelist", () => {
    for (const name of ["archive.zip", "noext", "photo.gif", "data.xls"]) {
      expect(validate(name, ZIP), name).toMatchObject({ ok: false, status: 415, code: "FILE_TYPE_BLOCKED" });
    }
  });

  it("rejects active declared MIME types even on a whitelisted extension", () => {
    for (const mime of ["text/html", "image/svg+xml", "application/javascript", "application/xml"]) {
      expect(validate("note.txt", enc("hello"), mime), mime).toMatchObject({
        ok: false,
        code: "FILE_TYPE_BLOCKED",
      });
    }
  });
});

describe("active content in text uploads", () => {
  it.each([
    ["<script>alert(1)</script>"],
    ["hello < script src=x>"],
    ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ["<!doctype html><title>x</title>"],
    ["<!DOCTYPE HTML>"],
    ["<html><body>x</body></html>"],
  ])("rejects %j", (payload) => {
    for (const ext of [".txt", ".md", ".csv", ".json"]) {
      expect(validate(`f${ext}`, enc(payload)), ext).toMatchObject({
        ok: false,
        status: 415,
        code: "FILE_TYPE_BLOCKED",
      });
    }
  });

  it("rejects NUL bytes in text files", () => {
    expect(validate("a.txt", bytes("abc", [0], "def"))).toMatchObject({ ok: false, code: "FILE_TYPE_MISMATCH" });
  });

  it("allows harmless angle brackets", () => {
    expect(validate("a.md", enc("a < b && c > d; <scripted> word"))).toMatchObject({ ok: true });
  });
});

describe("binary magic bytes", () => {
  it("matches the expected signatures", () => {
    expect(magicMatches(".pdf", PDF)).toBe(true);
    expect(magicMatches(".png", PNG)).toBe(true);
    expect(magicMatches(".jpg", JPEG)).toBe(true);
    expect(magicMatches(".webp", WEBP)).toBe(true);
    expect(magicMatches(".xlsx", ZIP)).toBe(true);
    expect(magicMatches(".docx", ZIP)).toBe(true);
  });

  it.each([
    ["report.pdf", PNG],
    ["report.pdf", enc("%PDF")],
    ["image.png", JPEG],
    ["image.png", bytes([0x89, 0x50, 0x4e, 0x47])],
    ["photo.jpg", PNG],
    ["photo.jpeg", bytes([0xff, 0xd8])],
    ["photo.webp", bytes("RIFF", [0, 0, 0, 0], "WAVE")],
    ["photo.webp", bytes("RIFX")],
    ["sheet.xlsx", PDF],
    ["doc.docx", bytes([0x50, 0x4b, 0x05, 0x06])],
    ["disguised.pdf", enc("<script>alert(1)</script>")],
  ])("rejects %s with mismatched content", (name, data) => {
    expect(validate(name, data)).toMatchObject({ ok: false, status: 415, code: "FILE_TYPE_MISMATCH" });
  });
});

describe("size and filename limits", () => {
  it("rejects empty and oversized files", () => {
    expect(validate("a.txt", new Uint8Array())).toMatchObject({ ok: false, status: 400 });
    expect(validate("a.pdf", new Uint8Array([...PDF, ...new Uint8Array(64)]), undefined, 32)).toMatchObject({
      ok: false,
      status: 413,
      code: "FILE_TOO_LARGE",
    });
  });

  it("strips directories, control characters and quotes", () => {
    expect(sanitizeOriginalName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeOriginalName("C:\\Users\\x\\..\\report.pdf")).toBe("report.pdf");
    expect(sanitizeOriginalName('a"b\'c`d\u0000\u001f.txt')).toBe("abcd.txt");
    const long = sanitizeOriginalName(`${"x".repeat(400)}.pdf`);
    expect(long).toHaveLength(180);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("rejects names that sanitise to nothing", () => {
    for (const name of ["", "..", "/", "\u0000"]) {
      expect(validate(name, enc("x")), JSON.stringify(name)).toMatchObject({ ok: false, status: 400 });
    }
  });
});

describe("storage keys and LocalStorageDriver", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "optimax-storage-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates server-side keys that ignore user input", () => {
    const key = newStorageKey("asset", ".pdf");
    expect(key).toMatch(/^asset\/\d{6}\/[0-9a-f]{32}\.pdf$/);
    expect(newStorageKey("job", "../../x")).toMatch(/^job\/\d{6}\/[0-9a-f]{32}$/);
    expect(() => assertSafeStorageKey(key)).not.toThrow();
  });

  it.each([
    "../secret",
    "asset/../../etc/passwd",
    "/etc/passwd",
    "asset//x",
    "asset/./x",
    "asset\\..\\x",
    ".hidden",
    "",
    "a/".repeat(200),
  ])("rejects unsafe key %j", (key) => {
    expect(() => assertSafeStorageKey(key)).toThrow();
    expect(() => resolveInside(dir, key)).toThrow();
  });

  it("resolves safe keys inside the base directory", () => {
    const full = resolveInside(dir, "asset/202611/abc.pdf");
    expect(full.startsWith(path.resolve(dir) + path.sep)).toBe(true);
  });

  it("round-trips data and rejects traversal on every operation", async () => {
    const driver = new LocalStorageDriver(dir);
    await driver.put("asset/202611/ok.txt", enc("hello"));
    expect(new TextDecoder().decode((await driver.get("asset/202611/ok.txt"))!)).toBe("hello");
    expect(await driver.get("asset/202611/missing.txt")).toBeNull();
    await driver.delete("asset/202611/ok.txt");
    await driver.delete("asset/202611/ok.txt");
    expect(await driver.get("asset/202611/ok.txt")).toBeNull();

    await expect(driver.put("../escape.txt", enc("x"))).rejects.toThrow();
    await expect(driver.get("asset/../../escape.txt")).rejects.toThrow();
    await expect(driver.delete("/etc/passwd")).rejects.toThrow();
  });
});

describe("AWS SigV4 canonical signing", () => {
  const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const creds = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
  };

  it("reproduces the AWS S3 documentation example (GET Object with Range)", () => {
    const result = signSigV4({
      ...creds,
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      amzDate: "20130524T000000Z",
      payloadHash: EMPTY_SHA256,
      headers: { Range: "bytes=0-9" },
    });
    expect(result.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY_SHA256,
      ].join("\n"),
    );
    expect(result.signedHeaders).toBe("host;range;x-amz-content-sha256;x-amz-date");
    expect(result.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(result.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(result.stringToSign.split("\n").slice(0, 3)).toEqual([
      "AWS4-HMAC-SHA256",
      "20130524T000000Z",
      "20130524/us-east-1/s3/aws4_request",
    ]);
  });

  it("sorts query parameters and RFC 3986-encodes path segments", () => {
    const result = signSigV4({
      ...creds,
      method: "get",
      url: "http://minio.local:9000/bucket/asset/key (1)!.pdf?prefix=a%20b&list-type=2",
      amzDate: "20130524T000000Z",
      payloadHash: EMPTY_SHA256,
    });
    const [method, uri, query, host] = result.canonicalRequest.split("\n");
    expect(method).toBe("GET");
    expect(uri).toBe("/bucket/asset/key%20%281%29%21.pdf");
    expect(query).toBe("list-type=2&prefix=a%20b");
    expect(host).toBe("host:minio.local:9000");
  });

  it("encodes reserved characters per SigV4", () => {
    expect(sigV4Encode("a b*'()!~")).toBe("a%20b%2A%27%28%29%21~");
    expect(sigV4Encode("a/b c", true)).toBe("a/b%20c");
    expect(sigV4Encode("a/b")).toBe("a%2Fb");
  });

  it("formats x-amz-date without separators or millis", () => {
    expect(toAmzDate(new Date("2026-11-21T11:15:00.123Z"))).toBe("20261121T111500Z");
  });
});
