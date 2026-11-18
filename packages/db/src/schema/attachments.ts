import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { accounts } from "./console";

// 附件元数据（LD-02）：文件本体在 Storage 磁盘（local / S3 兼容 OSS），本表只存元数据。
// uploaded_by 引用 console_account.id（RESTRICT 语义：保留上传者外键，不级联删除）。
export const attachments = pgTable("console_attachment", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  disk: text("disk").notNull(),
  path: text("path").notNull(),
  sha256: text("sha256").notNull(),
  uploadedBy: integer("uploaded_by").references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
