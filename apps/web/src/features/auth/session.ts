import { useQuery } from "@tanstack/react-query";
import { defaultPermissionCodes } from "@optimax-starter/api";
import { request, type Account } from "@/console-client";
import { getRoleLabel } from "./session-utils";

export { getRoleLabel };

export function useAccount() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => request<Account>("/me"),
    retry: false,
  });
}

export function hasPermission(
  account: Account | null | undefined,
  code: string,
): boolean {
  if (!account) return false;
  if (account.role === "super_admin") return true;
  const held = Array.isArray(account.permissions)
    ? account.permissions
    : defaultPermissionCodes(account.role);
  return held.includes(code);
}

export function hasAnyPermission(
  account: Account | null | undefined,
  codes: readonly string[],
): boolean {
  return codes.some((code) => hasPermission(account, code));
}
