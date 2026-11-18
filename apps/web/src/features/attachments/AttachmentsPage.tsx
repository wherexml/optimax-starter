import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Attachment } from "@optimax-starter/ui/components/attachment";
import { hasPermission, useAccount } from "@/features/auth/session";
import { deleteAttachment, fetchAttachments, fetchSignedUrl, uploadAttachment } from "./client";

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function AttachmentsPage() {
  const { data: me } = useAccount();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const canManage = me ? hasPermission(me, "attachments:manage") : false;
  const list = useQuery({
    queryKey: ["attachments"],
    queryFn: () => fetchAttachments(),
  });

  const upload = useMutation({
    mutationFn: uploadAttachment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attachments"] }),
  });

  const remove = useMutation({
    mutationFn: deleteAttachment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attachments"] }),
  });

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await upload.mutateAsync(file);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (id: number) => {
    const { url } = await fetchSignedUrl(id);
    window.open(url, "_blank", "noopener");
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
      <PageHeader
        title="附件管理"
        actions={
          canManage ? (
            <Button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <Paperclip className="size-4" aria-hidden />
              {uploading ? "上传中…" : "上传附件"}
            </Button>
          ) : null
        }
      />
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.zip"
        onChange={(event) => void onPick(event.target.files?.[0])}
      />
      <div className="mt-4 overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">名称</th>
              <th className="px-4 py-2 font-medium">类型</th>
              <th className="px-4 py-2 font-medium">大小</th>
              <th className="px-4 py-2 font-medium">上传者</th>
              <th className="px-4 py-2 font-medium">时间</th>
              <th className="px-4 py-2 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  加载中…
                </td>
              </tr>
            ) : !list.data?.items.length ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  暂无附件
                </td>
              </tr>
            ) : (
              list.data.items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-4 py-2">
                    <Attachment state="done" size="sm">
                      <span data-slot="attachment-content" className="max-w-60 truncate">{item.name}</span>
                    </Attachment>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{item.mime}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatSize(item.size)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{item.uploadedByUsername ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{item.createdAt.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void download(item.id)}>
                        <Download className="size-4" aria-hidden />
                        下载
                      </Button>
                      {canManage ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => remove.mutate(item.id)}>
                          <Trash2 className="size-4" aria-hidden />
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
