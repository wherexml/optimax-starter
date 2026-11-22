// Core-only workbench written by `scripts/lib/strip-example.mjs` (--no-example).
// Every figure comes from /console/accounts or /console/audit; business modules add their own entries.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Bot, Power, RotateCw, Users, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { request, type Account, type AuditPage } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { AUDIT_ACTION_LABELS } from "@/features/filters/search";
import { useContentRefresh } from "@/features/refresh/WorkspaceRefresh";

const ACTIVITY_SIZE = 5;

export function DashboardPage() {
  const runRefresh = useContentRefresh();
  const me = useAccount();
  const canReadAccounts = hasPermission(me.data, "accounts:read");
  const canReadAudit = hasPermission(me.data, "audit:read");
  const canReadSystem =
    hasPermission(me.data, "system:settings:read") || hasPermission(me.data, "system:ai:read");
  const accounts = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["accounts"],
    queryFn: () => request<Account[]>("/accounts"),
    enabled: Boolean(me.data) && canReadAccounts,
  });
  const recent = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["audit", "recent"],
    queryFn: () => request<AuditPage>(`/audit?size=${ACTIVITY_SIZE}`),
    enabled: Boolean(me.data) && canReadAudit,
  });
  const fetching = (canReadAccounts && accounts.isFetching) || (canReadAudit && recent.isFetching);
  const activeAccounts = accounts.data?.filter((a) => a.active).length ?? 0;

  return (
    <>
      <PageHeader
        title="工作台"
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            title="刷新"
            aria-label="刷新工作台"
            disabled={fetching}
            onClick={() =>
              void runRefresh(() =>
                Promise.all([
                  ...(canReadAccounts ? [accounts.refetch()] : []),
                  ...(canReadAudit ? [recent.refetch()] : []),
                ]),
              )
            }
          >
            <RotateCw size={15} className={fetching ? "animate-spin" : undefined} />
          </Button>
        }
      />
      <div className="dash">
        {canReadAccounts && (
          <Panel title="账户">
            {accounts.isError ? (
              <p className="queue-more">{accounts.error.message}</p>
            ) : (
              <ol className="activity">
                <li>
                  <Link to="/accounts" search={{ status: "active" }}>
                    <span className="activity-icon">
                      <Users size={16} aria-hidden="true" />
                    </span>
                    <span className="activity-main">
                      <span className="activity-text">
                        已启用 {accounts.isPending ? "-" : activeAccounts}
                      </span>
                    </span>
                  </Link>
                </li>
                <li>
                  <Link to="/accounts" search={{ status: "disabled" }}>
                    <span className="activity-icon">
                      <Power size={16} aria-hidden="true" />
                    </span>
                    <span className="activity-main">
                      <span className="activity-text">
                        已停用{" "}
                        {accounts.isPending ? "-" : (accounts.data?.length ?? 0) - activeAccounts}
                      </span>
                    </span>
                  </Link>
                </li>
              </ol>
            )}
          </Panel>
        )}
        {canReadAudit && (
          <Panel title="最近操作">
            {recent.isError ? (
              <p className="queue-more">{recent.error.message}</p>
            ) : (
              <ol className="activity">
                {(recent.data?.items ?? []).slice(0, ACTIVITY_SIZE).map((e) => (
                  <li key={e.id}>
                    <Link to="/audit" search={{ action: e.action }}>
                      <span className="activity-icon">
                        <Activity size={16} aria-hidden="true" />
                      </span>
                      <span className="activity-main">
                        <span className="activity-text">
                          {e.actorName} {AUDIT_ACTION_LABELS[e.action] ?? e.action}
                        </span>
                        <time className="activity-meta" dateTime={e.at}>
                          {new Date(e.at).toLocaleString("zh-CN")}
                        </time>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}
        <QuickAccess
          canReadAccounts={canReadAccounts}
          canReadAudit={canReadAudit}
          canReadSystem={canReadSystem}
        />
      </div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="panel" aria-labelledby={id}>
      <header className="panel-head">
        <h2 id={id}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Feature({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <>
      <span className="stat-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="feature-text">
        <span>{title}</span>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </>
  );
}

function QuickAccess({
  canReadAccounts,
  canReadAudit,
  canReadSystem,
}: {
  canReadAccounts: boolean;
  canReadAudit: boolean;
  canReadSystem: boolean;
}) {
  const id = useId();
  const count = [canReadAccounts, canReadAudit, canReadSystem].filter(Boolean).length;
  if (!count) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="dash-section-title">
        常用任务
      </h2>
      <div className="feature-grid" data-count={count}>
        {canReadAccounts && (
          <Link to="/accounts" search={{ status: "disabled" }} className="feature-card">
            <Feature icon={Power} title="已停用账户" />
          </Link>
        )}
        {canReadAudit && (
          <Link to="/audit" search={{ source: "agent" }} className="feature-card">
            <Feature icon={Bot} title="Agent 操作日志" />
          </Link>
        )}
        {canReadSystem && (
          <Link to="/system" search={{ tab: "status" }} className="feature-card">
            <Feature icon={Activity} title="AI 运行状态" />
          </Link>
        )}
      </div>
    </section>
  );
}
