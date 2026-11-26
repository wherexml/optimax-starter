import { agentTools, createAgent, registerTools } from "@ui-sdk/react/agent";

type AgentAllowCallback = NonNullable<NonNullable<Parameters<typeof createAgent>[0]>["allow"]>;
type AgentAllowStep = Parameters<AgentAllowCallback>[0];

function requestHumanConfirmation(step: AgentAllowStep): boolean {
  if (typeof window === "undefined") return false;
  if (step.confirm) {
    return window.confirm(step.confirm);
  }
  if (step.action === "press") {
    const target = step.label || step.ref;
    return window.confirm(`确认通过智能体触发界面操作「${target}」？`);
  }
  return true;
}

const uiAgent = createAgent({
  allow: (step) => requestHumanConfirmation(step),
});

if (typeof window !== "undefined") {
  Object.assign(window, { __starterUiAgent: uiAgent });
  const unregister = registerTools(uiAgent, {
    allow: (step) => requestHumanConfirmation(step),
  });
  if (import.meta.hot) {
    import.meta.hot.dispose(unregister);
  }
}

export { agentTools, uiAgent };
