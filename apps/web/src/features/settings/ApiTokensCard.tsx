import {
  API_TOKEN_ACTOR_SOURCES,
  API_TOKEN_TTL_DAYS,
  PERMISSION_CATALOG,
  sortPermissionCodes,
  type Account,
} from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormDialog } from "@/components/ui/FormDialog";
import { Input } from "@/components/ui/input";
import { CopyableInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectControl, SelectItem } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { tokensApi, type ApiToken, type ApiTokenCreated, type ApiTokenCreateInput } from "@/console-client";
import { FieldError, FieldHint, FieldLayout } from "@optimax-starter/ui/components/field";

type TtlDays = (typeof API_TOKEN_TTL_DAYS)[number];
type TokenActorSource = (typeof API_TOKEN_ACTOR_SOURCES)[number];

const ACTOR_SOURCE_LABELS: Record<TokenActorSource, string> = { agent: "Agent", system: "系统集成" };
const TTL_LABELS: Record<TtlDays, string> = { 1: "1 天", 7: "7 天", 30: "30 天", 90: "90 天", 365: "365 天" };
const PERMISSION_LABELS = new Map(PERMISSION_CATALOG.map((p) => [p.code, p.label]));

const formatTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
};

const tokenState = (t: ApiToken): "active" | "revoked" | "expired" =>
  t.revokedAt ? "revoked" : new Date(t.expiresAt).getTime() <= Date.now() ? "expired" : "active";

/**
 * Personal API tokens (Bearer). Management is Cookie-session only; the plaintext token is shown once.
 * Effective Bearer permissions are always the live role permissions ∩ selected scopes.
 */
export function ApiTokensCard({ account }: { account: Account }) {
  const id = useId();
  const cache = useQueryClient();
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [revoking, setRevoking] = useState<{ token: ApiToken; trigger: HTMLElement | null } | null>(null);

  const query = useQuery({
    queryKey: ["my-tokens", account.id],
    queryFn: () => tokensApi.list(),
  });
  const tokens = query.data ?? [];
  const active = tokens.filter((t) => tokenState(t) === "active");
  const inactive = tokens.filter((t) => tokenState(t) !== "active");

  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["my-tokens"] }),
      cache.invalidateQueries({ queryKey: ["audit"] }),
    ]);

  return (
    <section className="settings-card" aria-labelledby={id}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="m-0 flex items-center gap-2 text-base font-semibold leading-6">
          <KeyRound size={18} aria-hidden="true" className="text-primary" />
          API 密钥
        </h2>
        <Button ref={createTrigger} type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" />
          创建密钥
        </Button>
      </div>

      {query.isPending ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          正在加载 API 密钥…
        </p>
      ) : query.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3">
          <p className="m-0 text-sm text-destructive">{query.error.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      ) : !tokens.length ? (
        <p className="m-0 text-sm text-muted-foreground">暂无 API 密钥</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y-[0.5px] divide-border p-0" aria-label="API 密钥列表">
          {[...active, ...inactive].map((t) => {
            const state = tokenState(t);
            return (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {t.prefix}…
                    </code>
                    <Badge variant="outline">{ACTOR_SOURCE_LABELS[t.actorSource as TokenActorSource] ?? t.actorSource}</Badge>
                    {state === "revoked" && <Badge variant="danger">已撤销</Badge>}
                    {state === "expired" && <Badge variant="neutral">已过期</Badge>}
                  </div>
                  <p className="m-0 mt-1 text-xs leading-[18px] text-muted-foreground" title={t.scopes.join(", ")}>
                    权限：{t.scopes.map((s) => PERMISSION_LABELS.get(s) ?? s).join("、") || "—"}
                  </p>
                  <p className="m-0 mt-0.5 text-xs leading-[18px] text-muted-foreground tabular-nums">
                    最近使用 {formatTime(t.lastUsedAt)}
                    {t.lastUsedIp ? ` · IP ${t.lastUsedIp}` : ""} · 到期于 {formatTime(t.expiresAt)}
                    {t.revokedAt ? ` · 撤销于 ${formatTime(t.revokedAt)}` : ""}
                  </p>
                </div>
                {state === "active" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`撤销密钥 ${t.name}`}
                    onClick={(e) => setRevoking({ token: t, trigger: e.currentTarget })}
                  >
                    撤销
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <CreateTokenDialog
          account={account}
          trigger={createTrigger.current}
          close={async (result) => {
            setCreating(false);
            if (result) {
              setCreated(result);
              await refresh();
            }
          }}
        />
      )}

      {created && (
        <FormDialog
          open
          title="API 密钥已创建"
          description={`「${created.token.name}」的密钥仅显示这一次，请立即复制并妥善保存。`}
          size="md"
          submitText="我已复制"
          submitVariant="default"
          onSubmit={() => setCreated(null)}
          onOpenChange={(open) => {
            if (!open) setCreated(null);
          }}
          onCloseAutoFocus={(e) => {
            if (createTrigger.current?.isConnected) {
              e.preventDefault();
              createTrigger.current.focus();
            }
          }}
        >
          <div className="flex flex-col gap-3">
            <CopyableInput aria-label="API 密钥" value={created.plainToken} copyLabel="复制 API 密钥" className="font-mono text-xs" />
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              <li>
                请求头使用 <code className="font-mono text-xs">Authorization: Bearer &lt;密钥&gt;</code>；Bearer 请求不会回退到网页登录会话。
              </li>
              <li>实际权限 = 账户当前角色权限 ∩ 所选权限，角色降级立即生效。</li>
              <li>服务端只保存摘要，关闭后无法再次查看；遗失请撤销后重新创建。</li>
            </ul>
          </div>
        </FormDialog>
      )}

      {revoking && (
        <ConfirmDialog
          title="撤销 API 密钥"
          description={`撤销后「${revoking.token.name}」（${revoking.token.prefix}…）将立即失效，并写入操作日志。`}
          submitText="撤销密钥"
          trigger={revoking.trigger}
          action={() => tokensApi.revoke(revoking.token.id)}
          close={async (done) => {
            const name = revoking.token.name;
            setRevoking(null);
            if (done) {
              await refresh();
              toast.success(`已撤销密钥 ${name}`);
            }
          }}
        />
      )}
    </section>
  );
}

function CreateTokenDialog({
  account,
  trigger,
  close,
}: {
  account: Account;
  trigger: HTMLElement | null;
  close: (result?: ApiTokenCreated) => void;
}) {
  const nameId = useId();
  const ttlId = useId();
  const scopesId = useId();
  const available = useMemo(() => sortPermissionCodes(account.permissions ?? []), [account.permissions]);
  const [name, setName] = useState("");
  const [actorSource, setActorSource] = useState<TokenActorSource>("agent");
  const [ttlDays, setTtlDays] = useState<TtlDays>(30);
  const [scopes, setScopes] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  const nameError = touched && !name.trim() ? "请输入密钥名称" : "";
  const scopesError = touched && !scopes.length ? "请至少选择一项权限" : "";
  const allSelected = available.length > 0 && scopes.length === available.length;

  const create = useMutation({
    mutationFn: (input: ApiTokenCreateInput) => tokensApi.create(input),
    onSuccess: (result) => close(result),
  });

  const toggle = (code: string, on: boolean) =>
    setScopes((prev) => (on ? sortPermissionCodes(new Set([...prev, code])) : prev.filter((c) => c !== code)));

  return (
    <FormDialog
      open
      title="创建 API 密钥"
      size="md"
      submitText="创建密钥"
      submitVariant="default"
      loading={create.isPending}
      onSubmit={() => {
        setTouched(true);
        if (!name.trim() || !scopes.length) return;
        create.mutate({ name: name.trim(), actorSource, ttlDays, scopes });
      }}
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (!open && !create.isPending) close();
      }}
    >
      <div className="flex flex-col gap-5">
        <FieldLayout>
          <Label htmlFor={nameId} required>
            名称
          </Label>
          <Input
            id={nameId}
            value={name}
            maxLength={64}
            autoComplete="off"
            aria-invalid={Boolean(nameError) || undefined}
            placeholder="例如：资产同步 Agent"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <FieldError>{nameError}</FieldError>
        </FieldLayout>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLayout>
            <Label>调用来源</Label>
            <SegmentedControl
              label="调用来源"
              value={actorSource}
              onValueChange={setActorSource}
              options={API_TOKEN_ACTOR_SOURCES.map((v) => ({ value: v, label: ACTOR_SOURCE_LABELS[v] }))}
            />
          </FieldLayout>
          <FieldLayout>
            <Label htmlFor={ttlId}>有效期</Label>
            <SelectControl
              id={ttlId}
              aria-label="有效期"
              value={String(ttlDays)}
              onValueChange={(v) => setTtlDays(Number(v) as TtlDays)}
            >
              {API_TOKEN_TTL_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {TTL_LABELS[d]}
                </SelectItem>
              ))}
            </SelectControl>
          </FieldLayout>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={scopesId}>
          <div className="flex items-center justify-between gap-2">
            <legend className="text-sm font-medium leading-5">权限</legend>
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox
                checked={allSelected ? true : scopes.length ? "indeterminate" : false}
                disabled={!available.length}
                onCheckedChange={(v) => setScopes(v === true ? [...available] : [])}
              />
              全选可用权限
            </label>
          </div>
          <div className="grid max-h-56 gap-1.5 overflow-auto rounded-md border-[0.5px] border-[var(--hairline)] p-2.5 sm:grid-cols-2">
            {available.map((code) => (
              <label key={code} className="flex min-w-0 items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent/50">
                <Checkbox checked={scopes.includes(code)} onCheckedChange={(v) => toggle(code, v === true)} />
                <span className="min-w-0">
                  <span className="block">{PERMISSION_LABELS.get(code) ?? code}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">{code}</span>
                </span>
              </label>
            ))}
          </div>
          <FieldHint id={scopesId}>仅可选择本账户当前拥有的权限</FieldHint>
          <FieldError>{scopesError}</FieldError>
        </fieldset>

        {create.error && (
          <p role="alert" className="m-0 text-xs font-medium leading-[18px] text-destructive">
            {create.error.message}
          </p>
        )}
      </div>
    </FormDialog>
  );
}
