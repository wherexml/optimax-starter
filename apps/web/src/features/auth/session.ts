import { useQuery } from "@tanstack/react-query";
import { request, type Account } from "@/console-client";
export function useAccount() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => request<Account>("/me"),
    retry: false,
  });
}
