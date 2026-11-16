import { createChange, definePrimitive, type ChangeDetails } from "@ui-sdk/core";
import { validateAssetAgentFilters, type AssetAgentFilters } from "@optimax-starter/api/asset-agent";

type Options = {
  value: AssetAgentFilters;
  domains: string[];
  onValueChange: (value: AssetAgentFilters, details: ChangeDetails<"imperative">) => void;
};

export const assetFilters = definePrimitive({
  name: "asset-filters",
  options: { value: "value", domains: "list", onValueChange: "callback" },
  controlled: ["value"],
  state: (options: Options) => ({ value: options.value }),
  sync: options => ({ value: options.value }),
  api: context => {
    const change = createChange(context);
    return {
      setValue(value: unknown) {
        const next = validateAssetAgentFilters(value, context.options().domains);
        if (!change("value", next, { reason: "imperative" })) throw new Error("筛选未应用");
      },
    };
  },
  slots: slot => ({ root: slot({ role: "group" }) }),
  agent: { actions: ["setValue"] },
});
