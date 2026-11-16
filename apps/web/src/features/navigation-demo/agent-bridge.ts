import { createAgent } from "@ui-sdk/react/agent";

export const navigationDemoAgent = createAgent({
  allow: step => step.component === "tabs" && step.action === "setValue" && !step.confirm,
});
