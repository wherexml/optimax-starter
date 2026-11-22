// Tiny registry of entity types that own attachments. Business modules self-register on import;
// modules/attachments.ts only dispatches through it and never imports business tables.
import type { Actor, Tx } from "./guards";

export type AttachmentEntity = {
  /** Chinese noun used in user-facing messages, e.g. "资产". */
  label: string;
  /** Whether the caller may read/download attachments of this entity. */
  canRead: (actor: Actor, entityId: number) => boolean | Promise<boolean>;
  /** Permission required to upload/delete attachments (re-checked under the permission lock). */
  managePermission: string;
  /** false: attachments are written by the server only (e.g. job artifacts). */
  allowUserUpload: boolean;
  /** Pre-flight existence check before storing bytes. */
  verifyTarget?: (entityId: number) => Promise<boolean>;
  /** Locks the target row inside the upload transaction; false means it disappeared meanwhile. */
  lockTargetInTx?: (tx: Tx, entityId: number) => Promise<boolean>;
  notFoundMessage: string;
};

const ATTACHMENT_ENTITIES = new Map<string, AttachmentEntity>();

export function registerAttachmentEntity(type: string, entity: AttachmentEntity): void {
  ATTACHMENT_ENTITIES.set(type, entity);
}

export function getAttachmentEntity(type: string): AttachmentEntity | undefined {
  return ATTACHMENT_ENTITIES.get(type);
}

/** Labels of entity types that accept user uploads, in registration order. */
export function getUploadableAttachmentLabels(): string[] {
  return [...ATTACHMENT_ENTITIES.values()].filter((e) => e.allowUserUpload).map((e) => e.label);
}
