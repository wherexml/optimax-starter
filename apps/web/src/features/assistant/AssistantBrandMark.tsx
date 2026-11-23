import { APP_CONFIG } from "@/config/app-config";

export function AssistantBrandMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={APP_CONFIG.logoSrc}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={
        "pointer-events-none shrink-0 select-none object-contain" +
        (className ? ` ${className}` : "")
      }
    />
  );
}
