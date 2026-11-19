import { z } from "zod";
import type { PaginatedResult } from "./contracts";

// 附件模块契约（LD-02）。上传为 multipart（非 JSON），白名单/大小/签名 URL TTL 以
// 数据形态进 contracts:generate 产物（attachments.policy.json）供 PHP 消费。

export const ATTACHMENT_MIME_WHITELIST = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
] as const;

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_URL_TTL_SECONDS = 300;

export const attachmentRecordSchema = z.object({
  id: z.number(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  uploadedByUsername: z.string().nullable(),
  createdAt: z.string(),
});
export type AttachmentRecord = z.infer<typeof attachmentRecordSchema>;

export type AttachmentPage = PaginatedResult<AttachmentRecord>;

export const attachmentSignedUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export type AttachmentSignedUrl = z.infer<typeof attachmentSignedUrlSchema>;
