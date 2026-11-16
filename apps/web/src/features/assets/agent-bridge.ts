import { createAgent } from "@ui-sdk/react/agent";

export const assetAgent = createAgent({
  allow: step => step.component === "asset-filters" && step.action === "setValue" && !step.confirm,
});

export function assetFilterSnapshot() {
  return assetAgent.snapshot().filter(entry => entry.component === "asset-filters" && !entry.offPage);
}
