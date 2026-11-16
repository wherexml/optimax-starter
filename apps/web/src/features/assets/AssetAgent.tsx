import { useQuery } from "@tanstack/react-query";
import { Input } from "@ui-sdk/react/input";
import { Button } from "@ui-sdk/react/button";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { validateAssetAgentFilters, type AssetAgentFilters, type AssetAgentPlan } from "@optimax-starter/api/asset-agent";
import { request } from "@/console-client";
import { parseAssetSearch } from "@/features/filters/search";
import { AssetFilterScope } from "./AssetFilterScope";
import { assetAgent, assetFilterSnapshot } from "./agent-bridge";

export type FilterDraft = { dirty: boolean; signature: string };
type Props = {
  filters: AssetAgentFilters;
  domains: string[];
  matched: number;
  ready: boolean;
  draft: FilterDraft;
  apply: (filters: AssetAgentFilters) => void | Promise<void>;
  children: ReactNode;
};
const signature = (value: AssetAgentFilters) => JSON.stringify(parseAssetSearch(value));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export function AssetAgent(props: Props) {
  const config = useQuery({ queryKey: ['asset-agent-config'], queryFn: () => request<{ enabled: boolean }>('/assets/agent/config'), retry: false, staleTime: 60_000 });
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'success' | 'error'; message: string }>({ kind: 'idle', message: '' });
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const active = useRef<{ controller: AbortController; filters: string; draft: string; applied: boolean } | null>(null);
  const application = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.controller.abort(); active.current = null; };
  }, []);

  function stop() {
    const applied = active.current?.applied;
    active.current?.controller.abort();
    active.current = null;
    setState({ kind: applied ? 'success' : 'idle', message: applied ? '筛选已应用，已停止等待回执' : '已停止' });
  }
  async function run(event: FormEvent) {
    event.preventDefault();
    if (active.current || !instruction.trim()) return;
    if (latest.current.draft.dirty) {
      setState({ kind: 'error', message: '请先应用或清除手动筛选中的更改' });
      return;
    }
    if (!latest.current.ready) {
      setState({ kind: 'error', message: '请等待资产加载完成后重试' });
      return;
    }
    const permit = { controller: new AbortController(), filters: signature(latest.current.filters), draft: latest.current.draft.signature, applied: false };
    active.current = permit;
    const signal = permit.controller.signal;
    let plan: AssetAgentPlan | undefined;
    let applied = false;
    setState({ kind: 'loading', message: '正在筛选…' });
    try {
      plan = await request<AssetAgentPlan>('/assets/agent/plan', 'POST', { instruction: instruction.trim(), current: latest.current.filters }, { signal });
      signal.throwIfAborted();
      if (active.current !== permit) return;
      const next = validateAssetAgentFilters(plan.filters, latest.current.domains);
      const targets = assetFilterSnapshot();
      if (targets.length !== 1 || !targets[0]) throw new Error('资产筛选暂不可用，请刷新后重试');
      const result = await assetAgent.act({ steps: [{ ref: targets[0].ref, action: 'setValue', args: [next] }] });
      if (!result.ok) throw new Error(result.error?.message || '筛选未应用');
      await application.current;
      signal.throwIfAborted();
      if (signature(latest.current.filters) !== signature(next)) throw new Error('筛选状态已变化，请重试');
      applied = true;
      permit.applied = true;
      await request('/assets/agent/result', 'POST', { runId: plan.runId, ok: true, filters: latest.current.filters, matched: latest.current.matched }, { signal });
      if (active.current === permit && mounted.current) setState({ kind: 'success', message: '已应用筛选' });
    } catch (error) {
      if (!signal.aborted && active.current === permit && mounted.current) {
        const message = error instanceof Error ? error.message : '筛选未完成，请重试';
        if (plan && !applied) {
          await request('/assets/agent/result', 'POST', { runId: plan.runId, ok: false, filters: latest.current.filters, matched: latest.current.matched, error: message.slice(0, 200) }, { signal }).catch(() => undefined);
        }
        if (!signal.aborted && active.current === permit && mounted.current) setState({ kind: 'error', message: applied ? '筛选已应用，模型回执暂不可用' : message });
      }
    } finally {
      if (active.current === permit) active.current = null;
    }
  }

  if (!config.data?.enabled) return props.children;
  return <>
    <div className="asset-agent" data-agent-hidden>
      <form onSubmit={run} aria-label="资产自然语言筛选" className="asset-agent-form">
        <Input
          type="search"
          name="asset-filter-instruction"
          data-1p-ignore="true"
          aria-label="自然语言筛选"
          placeholder="只看履约和运营中待复核的资产"
          value={instruction}
          onValueChange={value => setInstruction(value)}
          maxLength={500}
          disabled={state.kind === 'loading'}
          autoComplete="off"
          onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
        />
        {state.kind === 'loading'
          ? <Button type="button" aria-label="停止筛选" title="停止筛选" onClick={event => { event.preventDefault(); stop(); }}><Square size={14} aria-hidden="true" /></Button>
          : <Button type="submit" aria-label="执行筛选" title="执行筛选" disabled={!instruction.trim() || !props.ready}><ArrowUp size={17} aria-hidden="true" /></Button>}
      </form>
      <p role={state.kind === 'error' ? 'alert' : 'status'} data-asset-agent-status={state.kind} aria-live="polite">{state.message}</p>
    </div>
    <AssetFilterScope
      aria-label="资产筛选"
      value={props.filters}
      domains={props.domains}
      onValueChange={(value, details) => {
        const permit = active.current, current = latest.current;
        const scope = document.querySelector('[data-slot="asset-filters-root"]');
        if (details.source !== 'agent' || !permit || permit.controller.signal.aborted) { details.cancel(); throw new Error('筛选请求已停止'); }
        if (!current.ready || scope?.closest('[inert]')) { details.cancel(); throw new Error('请等待资产加载完成后重试'); }
        if (current.draft.dirty || current.draft.signature !== permit.draft || signature(current.filters) !== permit.filters) { details.cancel(); throw new Error('筛选已被手动更改，请重试'); }
        application.current = (async () => { await current.apply(parseAssetSearch(value)); await frame(); await frame(); })();
      }}
    >{props.children}</AssetFilterScope>
  </>;
}
