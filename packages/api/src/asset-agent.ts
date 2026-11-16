import { z } from "zod";

export const assetAgentFilters = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  qOp: z.enum(["contains", "equals"]).optional(),
  stage: z.union([z.enum(["已登记", "待复核"]), z.array(z.enum(["已登记", "待复核"])).max(2)]).optional(),
  domain: z.union([z.string().trim().min(1).max(80), z.array(z.string().trim().min(1).max(80)).max(20)]).optional(),
}).strict().refine(value => !value.qOp || Boolean(value.q), { message: "匹配方式需要资产名称" });

export type AssetAgentFilters = z.infer<typeof assetAgentFilters>;

export function validateAssetAgentFilters(value: unknown, domains: readonly string[]): AssetAgentFilters {
  const result = assetAgentFilters.safeParse(value);
  if (!result.success) throw new Error("筛选参数无效，仅支持资产名称、登记状态和业务域");
  const selected = result.data.domain === undefined ? [] : Array.isArray(result.data.domain) ? result.data.domain : [result.data.domain];
  if (selected.some(domain => !domains.includes(domain))) throw new Error("业务域不存在，请使用当前页面中的选项");
  return result.data;
}

export const assetAgentRequest = z.object({
  instruction: z.string().trim().min(1).max(500),
  current: assetAgentFilters,
}).strict();

export type AssetAgentPlan = {
  filters: AssetAgentFilters;
  runId: string;
  model: string;
  callId: string;
};
