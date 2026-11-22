import {
  ASSET_IMPORT_SYNC_MAX_ROWS,
  type AssetImportDuplicateMode,
  type AssetImportRow,
} from "@optimax-starter/api";
import { useMutation } from "@tanstack/react-query";
import { Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldHint, FieldLayout } from "@optimax-starter/ui/components/field";
import { FormDialog } from "@/components/ui/FormDialog";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@optimax-starter/ui/components/segmented-control";
import { assetsApi, type AssetImportCommitResult } from "@/console-client";

const DUPLICATE_OPTIONS = [
  { value: "fail", label: "遇到重名报错" },
  { value: "skip", label: "跳过重名" },
] as const satisfies readonly { value: AssetImportDuplicateMode; label: string }[];

const MAX_CSV_BYTES = 2 * 1024 * 1024;

const statusBadge = (row: AssetImportRow) =>
  row.status === "valid" ? (
    <Badge variant="brand">可导入</Badge>
  ) : row.status === "duplicate" ? (
    <Badge variant="warning">{row.duplicateOf === "file" ? "文件内重名" : "台账已存在"}</Badge>
  ) : (
    <Badge variant="danger">无效</Badge>
  );

/**
 * CSV bulk import: pick file → server preview (validation + duplicates) → choose duplicate mode → commit.
 * The same file is re-sent on commit; the server re-validates inside the write transaction.
 */
export function AssetImportDialog({
  trigger,
  close,
}: {
  trigger: HTMLElement | null;
  close: (result?: AssetImportCommitResult) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<AssetImportDuplicateMode>("fail");
  const [pickError, setPickError] = useState("");

  const preview = useMutation({
    mutationFn: (f: File) => assetsApi.importPreview(f, "skip"),
  });
  const commit = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("请选择 CSV 文件");
      return assetsApi.importCommit(file, mode);
    },
    onSuccess: (result) => close(result),
  });

  const choose = (next: File | undefined) => {
    setPickError("");
    commit.reset();
    if (!next) return;
    if (!/\.csv$/i.test(next.name)) {
      setPickError("仅支持 .csv 文件");
      return;
    }
    if (next.size > MAX_CSV_BYTES) {
      setPickError("CSV 文件不能超过 2 MiB");
      return;
    }
    setFile(next);
    preview.mutate(next);
  };

  const data = preview.data;
  const blocked =
    !data ||
    data.total === 0 ||
    data.errorCount > 0 ||
    Boolean(data.headerErrors?.length) ||
    (mode === "fail" && data.duplicateCount > 0) ||
    data.validCount === 0;
  const problemRows = data?.rows.filter((r) => r.status !== "valid") ?? [];
  const shownRows = problemRows.length ? problemRows : (data?.rows ?? []);
  const busy = preview.isPending || commit.isPending;

  return (
    <FormDialog
      open
      title="批量导入资产"
      size="lg"
      submitText="确认导入"
      submitVariant="default"
      submitDisabled={blocked || busy}
      loading={commit.isPending}
      onSubmit={() => commit.mutate()}
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (!open && !commit.isPending) close();
      }}
      footerStart={
        <a
          href={assetsApi.importTemplatePath}
          download
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Download size={14} aria-hidden="true" />
          下载导入模板
        </a>
      }
    >
      <div className="flex flex-col gap-5">
        <FieldLayout>
          <Label htmlFor="asset-import-file">CSV 文件</Label>
          <input
            ref={input}
            id="asset-import-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              choose(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <FileUp size={15} aria-hidden="true" />
              {file ? "重新选择" : "选择文件"}
            </Button>
            {file && (
              <span className="min-w-0 truncate text-sm text-muted-foreground" title={file.name}>
                {file.name}
              </span>
            )}
          </div>
          <FieldHint>
            表头：名称、业务域、责任团队、登记状态；单次最多 {ASSET_IMPORT_SYNC_MAX_ROWS} 行，文件不超过 2 MiB
          </FieldHint>
          {pickError && (
            <p role="alert" className="m-0 text-xs font-medium leading-[18px] text-destructive">
              {pickError}
            </p>
          )}
        </FieldLayout>

        {preview.isPending && <p className="m-0 text-sm text-muted-foreground">正在校验…</p>}
        {preview.error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {preview.error.message}
          </p>
        )}

        {data && !preview.isPending && (
          <>
            <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="校验结果">
              {(
                [
                  ["数据行", data.total, ""],
                  ["可导入", data.validCount, ""],
                  ["重名", data.duplicateCount, data.duplicateCount ? "text-warning-foreground" : ""],
                  ["无效", data.errorCount, data.errorCount ? "text-destructive" : ""],
                ] as const
              ).map(([label, value, tone]) => (
                <div key={label} className="rounded-md border-[0.5px] border-[var(--hairline)] px-3 py-2">
                  <dt className="text-xs leading-[18px] text-muted-foreground">{label}</dt>
                  <dd className={`m-0 mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
                </div>
              ))}
            </dl>

            {data.headerErrors?.length ? (
              <ul role="alert" className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-destructive">
                {data.headerErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}

            {data.duplicateCount > 0 && (
              <FieldLayout>
                <Label id="asset-import-duplicate-label">重名处理</Label>
                <SegmentedControl
                  label="重名处理"
                  value={mode}
                  onValueChange={setMode}
                  options={DUPLICATE_OPTIONS}
                />
              </FieldLayout>
            )}

            {shownRows.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-md border-[0.5px] border-[var(--hairline)]">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">{problemRows.length ? "需处理的行" : "预览行"}</caption>
                  <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">行</th>
                      <th className="px-3 py-2 font-medium">名称</th>
                      <th className="px-3 py-2 font-medium">业务域</th>
                      <th className="px-3 py-2 font-medium">责任团队</th>
                      <th className="px-3 py-2 font-medium">登记状态</th>
                      <th className="px-3 py-2 font-medium">结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((row) => (
                      <tr key={row.row} className="border-t-[0.5px] border-[var(--hairline)] align-top">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.row}</td>
                        <td className="max-w-40 break-words px-3 py-2">{row.name || "—"}</td>
                        <td className="px-3 py-2">{row.domain || "—"}</td>
                        <td className="px-3 py-2">{row.owner || "—"}</td>
                        <td className="px-3 py-2">{row.stage || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-start gap-1">
                            {statusBadge(row)}
                            {row.errors.map((e) => (
                              <span key={e} className="text-xs text-destructive">
                                {e}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.rows.length < data.total && (
              <FieldHint>仅展示前 {data.rows.length} 行（问题行优先）</FieldHint>
            )}
          </>
        )}

        {commit.error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {commit.error.message}
          </p>
        )}
      </div>
    </FormDialog>
  );
}
