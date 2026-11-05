// Structural port of skylance-easm pages/Index.tsx:
// - Four DashboardStatCards (each value is the drilldown link, with subtitle links below).
// - A 2:1 main grid: the left list replaces TenantSecurityList; the right column is RecentActivityList for admins
//   and the review queue for members.
// - Quick access cards (FeatureCard).
// Every figure comes from /console/assets, /console/accounts or /console/audit; there are no trends, risks or tenants.
import { Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Clock,
  KeyRound,
  Layers,
  LogOut,
  Pencil,
  Power,
  RotateCw,
  ScrollText,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  request,
  type Account,
  type Asset,
  type AuditPage,
} from "@/console-client";
import { useAccount } from "@/features/auth/session";
import { AUDIT_ACTION_LABELS } from "@/features/filters/search";

const QUEUE_SIZE = 6;
const ACTIVITY_SIZE = 5;
const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  "account.create": UserPlus,
  "account.update": Pencil,
  "account.role": ShieldCheck,
  "account.status": Power,
  "account.password_reset": KeyRound,
  "account.revoke": LogOut,
  "profile.update": Pencil,
  "profile.password_change": KeyRound,
};

export function DashboardPage() {
  const me = useAccount();
  const admin = me.data?.role === "admin";
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => request<Asset[]>("/assets"),
  });
  // 成员不发起账户与日志请求。
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => request<Account[]>("/accounts"),
    enabled: admin,
  });
  const recent = useQuery({
    queryKey: ["audit", "recent"],
    queryFn: () => request<AuditPage>(`/audit?size=${ACTIVITY_SIZE}`),
    enabled: admin,
  });
  const fetching =
    assets.isFetching || (admin && (accounts.isFetching || recent.isFetching));
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
            onClick={() => {
              void assets.refetch();
              if (admin) {
                void accounts.refetch();
                void recent.refetch();
              }
            }}
          >
            <RotateCw size={15} className={fetching ? "animate-spin" : undefined} />
          </Button>
        }
      />
      <div className="dash">
        <div className="stat-grid">
          {assets.isPending ? (
            [0, 1, 2].map((i) => <StatSkeleton key={i} />)
          ) : assets.isError ? (
            <StatError
              message={assets.error.message}
              retry={() => void assets.refetch()}
              wide
            />
          ) : (
            <AssetStats rows={assets.data} />
          )}
          {admin ? (
            accounts.isPending ? (
              <StatSkeleton />
            ) : accounts.isError ? (
              <StatError
                message={accounts.error.message}
                retry={() => void accounts.refetch()}
              />
            ) : (
              <AccountStat rows={accounts.data} />
            )
          ) : assets.isPending ? (
            <StatSkeleton />
          ) : assets.data ? (
            <DomainStat rows={assets.data} />
          ) : null}
        </div>

        <div className="dash-main">
          <Panel
            title="业务域"
            action={
              <Link to="/assets">
                资产台账
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            }
          >
            <Loaded query={assets} empty="暂无资产" isEmpty={(d) => !d.length}>
              {(rows) => <DomainList rows={rows} />}
            </Loaded>
          </Panel>
          {admin ? (
            <Panel
              title="最近操作"
              action={
                <Link to="/audit">
                  操作日志
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              }
            >
              <Loaded
                query={recent}
                empty="暂无操作记录"
                isEmpty={(d) => !d.items.length}
              >
                {(d) => <RecentActivity page={d} />}
              </Loaded>
            </Panel>
          ) : (
            <Panel
              title="待复核资产"
              action={
                <Link to="/assets" search={{ stage: "待复核" }}>
                  全部待复核
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              }
            >
              <Loaded query={assets} empty="暂无资产" isEmpty={(d) => !d.length}>
                {(rows) => <ReviewQueue rows={rows} />}
              </Loaded>
            </Panel>
          )}
        </div>

        <QuickAccess admin={admin} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- DashboardStatCard
// The EASM card used role=button with nested buttons inside. Here the label and value are one link and the subtitle entries are separate links, so no interactive elements are nested.
function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  main,
  links = [],
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "primary" | "warning";
  main: (content: ReactNode) => ReactNode;
  links?: ReactNode[];
}) {
  return (
    <section className="stat-card" aria-label={label}>
      {main(
        <>
          <span className="stat-label">
            <span className="stat-icon" data-tone={tone}>
              <Icon size={18} aria-hidden="true" />
            </span>
            {label}
          </span>
          <span className="stat-value" data-tone={tone}>
            {value}
          </span>
        </>,
      )}
      {links.length > 0 && (
        <p className="stat-links">
          {links.map((link, i) => (
            <span key={i}>
              {i > 0 && <span aria-hidden="true"> / </span>}
              {link}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
function StatSkeleton() {
  return (
    <div className="stat-card" role="status" aria-label="正在加载">
      <span className="skeleton short" />
      <span className="skeleton" />
    </div>
  );
}
function StatError({
  message,
  retry,
  wide,
}: {
  message: string;
  retry: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="stat-card stat-error"
      role="alert"
      style={wide ? { gridColumn: "span 3" } : undefined}
    >
      <p>{message || "加载失败"}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        重试
      </Button>
    </div>
  );
}

function countBy(rows: Asset[], key: (r: Asset) => string) {
  const map = new Map<string, number>();
  for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
}

function AssetStats({ rows }: { rows: Asset[] }) {
  const pending = rows.filter((r) => r.stage === "待复核");
  const registered = rows.length - pending.length;
  const share = rows.length ? Math.round((registered / rows.length) * 100) : 0;
  return (
    <>
      <StatCard
        label="资产总数"
        value={rows.length}
        icon={Boxes}
        tone="primary"
        main={(c) => (
          <Link to="/assets" className="stat-main">
            {c}
          </Link>
        )}
        links={[
          <Link key="r" to="/assets" search={{ stage: "已登记" }}>
            已登记：{registered}
          </Link>,
          <Link key="p" to="/assets" search={{ stage: "待复核" }}>
            待复核：{pending.length}
          </Link>,
        ]}
      />
      <StatCard
        label="待复核资产"
        value={pending.length}
        icon={Clock}
        tone="warning"
        main={(c) => (
          <Link to="/assets" search={{ stage: "待复核" }} className="stat-main">
            {c}
          </Link>
        )}
        links={countBy(pending, (r) => r.domain)
          .slice(0, 3)
          .map(([domain, n]) => (
            <Link key={domain} to="/assets" search={{ stage: "待复核", domain }}>
              {domain}：{n}
            </Link>
          ))}
      />
      <StatCard
        label="已登记资产"
        value={registered}
        icon={BadgeCheck}
        main={(c) => (
          <Link to="/assets" search={{ stage: "已登记" }} className="stat-main">
            {c}
          </Link>
        )}
        links={[<span key="s">占全部 {share}%</span>]}
      />
    </>
  );
}

function AccountStat({ rows }: { rows: Account[] }) {
  const active = rows.filter((r) => r.active).length;
  return (
    <StatCard
      label="账户"
      value={rows.length}
      icon={Users}
      tone="primary"
      main={(c) => (
        <Link to="/accounts" className="stat-main">
          {c}
        </Link>
      )}
      links={[
        <Link key="a" to="/accounts" search={{ status: "active" }}>
          已启用：{active}
        </Link>,
        <Link key="d" to="/accounts" search={{ status: "disabled" }}>
          已停用：{rows.length - active}
        </Link>,
      ]}
    />
  );
}

function DomainStat({ rows }: { rows: Asset[] }) {
  const domains = countBy(rows, (r) => r.domain);
  return (
    <StatCard
      label="业务域"
      value={domains.length}
      icon={Layers}
      tone="primary"
      main={(c) => (
        <Link to="/assets" className="stat-main">
          {c}
        </Link>
      )}
      links={domains.slice(0, 3).map(([domain, n]) => (
        <Link key={domain} to="/assets" search={{ domain }}>
          {domain}：{n}
        </Link>
      ))}
    />
  );
}

// ---------------------------------------------------------------- panels
function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="panel" aria-labelledby={id}>
      <header className="panel-head">
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Loaded<D>({
  query,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<D, Error>;
  empty: string;
  isEmpty: (data: D) => boolean;
  children: (data: D) => ReactNode;
}) {
  if (query.isPending)
    return (
      <div role="status" aria-label="正在加载" className="panel-state">
        <span className="skeleton" />
        <span className="skeleton short" />
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="panel-state">
        <p>{query.error.message || "加载失败"}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  if (isEmpty(query.data)) return <p className="panel-state">{empty}</p>;
  return <>{children(query.data)}</>;
}

// Replaces TenantSecurityList: one row per business domain, sorted by pending count.
function DomainList({ rows }: { rows: Asset[] }) {
  const domains = countBy(rows, (r) => r.domain).map(([domain, total]) => ({
    domain,
    total,
    pending: rows.filter((r) => r.domain === domain && r.stage === "待复核").length,
  }));
  domains.sort((a, b) => b.pending - a.pending || b.total - a.total);
  const max = Math.max(...domains.map((d) => d.total), 1);
  return (
    <ul className="domain-list">
      {domains.map((d) => (
        <li key={d.domain}>
          <Link
            to="/assets"
            search={{ domain: d.domain }}
            className="domain-main"
            aria-label={`${d.domain}：${d.total} 项资产，查看台账`}
          >
            <strong>{d.domain}</strong>
            <span className="domain-bar" aria-hidden="true">
              <span style={{ width: `${((d.total - d.pending) / max) * 100}%` }} />
              <span
                data-tone="warning"
                style={{ width: `${(d.pending / max) * 100}%` }}
              />
            </span>
            <span className="count">{d.total}</span>
          </Link>
          {d.pending > 0 ? (
            <Link
              to="/assets"
              search={{ domain: d.domain, stage: "待复核" }}
              className="domain-pending"
              aria-label={`${d.domain}待复核 ${d.pending} 项`}
            >
              待复核 {d.pending}
            </Link>
          ) : (
            <span className="domain-pending" data-empty="">
              待复核 0
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function relative(at: string) {
  const diff = Date.now() - new Date(at).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

// RecentActivityList: the latest real audit entries; each opens the audit log filtered by that action.
function RecentActivity({ page }: { page: AuditPage }) {
  return (
    <ol className="activity">
      {page.items.slice(0, ACTIVITY_SIZE).map((e) => {
        const Icon = ACTIVITY_ICONS[e.action] ?? Activity;
        const label = AUDIT_ACTION_LABELS[e.action] ?? e.action;
        const target =
          e.targetName && e.targetId !== e.actorId ? ` · ${e.targetName}` : "";
        return (
          <li key={e.id}>
            <Link to="/audit" search={{ action: e.action }}>
              <span className="activity-icon">
                <Icon size={16} aria-hidden="true" />
              </span>
              <span className="activity-main">
                <span className="activity-text">
                  {e.actorName} · {label}
                  {target}
                </span>
                <time className="activity-meta" dateTime={e.at}>
                  {relative(e.at)}
                </time>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function ReviewQueue({ rows }: { rows: Asset[] }) {
  const pending = rows.filter((r) => r.stage === "待复核");
  if (!pending.length) return <p className="panel-state">暂无待复核资产</p>;
  return (
    <>
      <ol className="queue">
        {pending.slice(0, QUEUE_SIZE).map((r) => (
          <li key={r.id}>
            <Link to="/assets" search={{ q: r.name, stage: "待复核" }}>
              <span className="queue-id">
                AS-{String(r.id).padStart(3, "0")}
              </span>
              <span className="queue-main">
                <strong>{r.name}</strong>
                <small>
                  {r.domain} · {r.owner}
                </small>
              </span>
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
      {pending.length > QUEUE_SIZE && (
        <p className="queue-more">另有 {pending.length - QUEUE_SIZE} 项待复核</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- FeatureCard quick access
function Feature({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <>
      <span className="stat-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span>{title}</span>
      <ArrowRight size={16} aria-hidden="true" />
    </>
  );
}
function QuickAccess({ admin }: { admin: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="dash-section-title">
        快捷入口
      </h2>
      <div className="feature-grid">
        <Link to="/assets" className="feature-card">
          <Feature icon={Boxes} title="资产台账" />
        </Link>
        <Link to="/assets" search={{ stage: "待复核" }} className="feature-card">
          <Feature icon={Clock} title="待复核资产" />
        </Link>
        {admin && (
          <>
            <Link to="/accounts" className="feature-card">
              <Feature icon={Users} title="账户管理" />
            </Link>
            <Link to="/audit" className="feature-card">
              <Feature icon={ScrollText} title="操作日志" />
            </Link>
          </>
        )}
        <Link to="/settings" className="feature-card">
          <Feature icon={Settings} title="个人设置" />
        </Link>
      </div>
    </section>
  );
}
