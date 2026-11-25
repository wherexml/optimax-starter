import { ATTACHMENT_ALLOWED_EXTENSIONS, ATTACHMENT_DEFAULT_MAX_BYTES } from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { attachmentDownloadPath, attachmentsApi, type Attachment } from "@/console-client";

const ACCEPT = ATTACHMENT_ALLOWED_EXTENSIONS.join(",");
const MAX_MIB = Math.round(ATTACHMENT_DEFAULT_MAX_BYTES / 1024 / 1024);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
};

/**
 * Asset attachments. The server is authoritative for type/size/magic-byte checks and always serves
 * downloads as `application/octet-stream` + `Content-Disposition: attachment`, so nothing renders inline.
 */
export function AttachmentPanel({
  entityId,
  canManage,
  title = "相关附件",
}: {
  entityId: number;
  canManage: boolean;
  title?: string;
}) {
  const cache = useQueryClient();
  const queryKey = ["attachments", "asset", entityId] as const;
  const list = useQuery({
    queryKey,
    queryFn: () => attachmentsApi.list("asset", entityId),
  });
  const input = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    row: Attachment;
    trigger: HTMLElement | null;
  } | null>(null);

  const uploader = useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(entityId, file),
    onSuccess: async (row) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey }),
        cache.invalidateQueries({ queryKey: ["assets", "detail", entityId] }),
        cache.invalidateQueries({ queryKey: ["audit"] }),
      ]);
      toast.success(`已上传 ${row.originalName}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > ATTACHMENT_DEFAULT_MAX_BYTES) {
      toast.error(`文件超过 ${MAX_MIB} MiB 上限`);
      return;
    }
    uploader.mutate(file);
  };

  const rows = list.data ?? [];

  return (
    <section data-slot="detail-section" aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-border pb-2">
        <h3 className="m-0 text-sm font-semibold leading-5 text-foreground">{title}</h3>
        {canManage && (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                pick(e.currentTarget.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={uploader.isPending}
              title={`支持 ${ATTACHMENT_ALLOWED_EXTENSIONS.join(" ")}，单个文件不超过 ${MAX_MIB} MiB`}
              onClick={() => input.current?.click()}
            >
              <Upload size={14} aria-hidden="true" />
              {uploader.isPending ? "上传中…" : "上传附件"}
            </Button>
          </>
        )}
      </div>
      {canManage && (
        <p className="m-0 text-xs leading-[18px] text-muted-foreground">
          PDF、图片、CSV、Excel、Word、文本、Markdown、JSON，单个不超过 {MAX_MIB} MiB
        </p>
      )}
      {list.isLoading ? (
        <p className="m-0 text-sm text-muted-foreground">正在加载附件…</p>
      ) : list.error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {list.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">暂无附件</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="附件列表">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-w-0 items-center gap-2 rounded-md border-[0.5px] border-[var(--hairline)] px-2.5 py-1.5"
            >
              <Paperclip size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-medium" title={row.originalName}>
                  {row.originalName}
                </p>
                <p className="m-0 text-xs leading-[18px] text-muted-foreground tabular-nums">
                  {formatBytes(row.sizeBytes)} · {formatTime(row.createdAt)}
                </p>
              </div>
              <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <a
                  href={attachmentDownloadPath(row.id)}
                  download
                  rel="noopener"
                  aria-label={`下载附件 ${row.originalName}`}
                  title="下载"
                >
                  <Download size={14} aria-hidden="true" />
                </a>
              </Button>
              {canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  aria-label={`删除附件 ${row.originalName}`}
                  title="删除"
                  onClick={(e) => setPendingDelete({ row, trigger: e.currentTarget })}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="删除附件"
          description={`将永久删除「${pendingDelete.row.originalName}」，并写入操作日志。`}
          submitText="删除附件"
          trigger={pendingDelete.trigger}
          action={() => attachmentsApi.remove(pendingDelete.row.id)}
          close={async (done) => {
            const name = pendingDelete.row.originalName;
            setPendingDelete(null);
            if (done) {
              await Promise.all([
                cache.invalidateQueries({ queryKey }),
                cache.invalidateQueries({ queryKey: ["assets", "detail", entityId] }),
                cache.invalidateQueries({ queryKey: ["audit"] }),
              ]);
              toast.success(`已删除附件 ${name}`);
            }
          }}
        />
      )}
    </section>
  );
}
