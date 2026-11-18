import { request } from "@/console-client";
import type { AttachmentPage, AttachmentSignedUrl } from "@optimax-starter/api/attachments";

export async function fetchAttachments(page = 1, size = 20): Promise<AttachmentPage> {
  return request<AttachmentPage>(`/attachments?page=${page}&size=${size}`);
}

export async function fetchSignedUrl(id: number): Promise<AttachmentSignedUrl> {
  return request<AttachmentSignedUrl>(`/attachments/${id}/url`);
}

export async function deleteAttachment(id: number): Promise<void> {
  await request(`/attachments/${id}`, "DELETE", undefined);
}

export async function uploadAttachment(file: File): Promise<void> {
  const body = new FormData();
  body.append("file", file);
  await fetch("/console/attachments", {
    method: "POST",
    headers: { Origin: location.origin },
    body,
  }).then(async (res) => {
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `上传失败（${res.status}）`);
    }
  });
}
export type { AttachmentPage, AttachmentSignedUrl };
