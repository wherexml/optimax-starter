import { useBlocker } from "@tanstack/react-router";
import { useRef } from "react";

// Uses the installed TanStack Router useBlocker({ shouldBlockFn, withResolver }).
// It blocks in-app route changes (shown as a confirmation dialog) as well as page reloads and closes.
export function useUnsavedGuard(shouldBlock: () => boolean) {
  const latest = useRef(shouldBlock);
  latest.current = shouldBlock;
  const blocker = useBlocker({
    shouldBlockFn: () => latest.current(),
    enableBeforeUnload: () => latest.current(),
    withResolver: true,
  });
  return {
    blocked: blocker.status === "blocked",
    stay: () => blocker.reset?.(),
    leave: () => blocker.proceed?.(),
  };
}
