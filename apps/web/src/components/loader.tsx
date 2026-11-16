import { PageSkeleton } from "@optimax-starter/ui/components/content-refresh";
import { APP_CONFIG } from "@/config/app-config";

export default function Loader() {
  return <PageSkeleton label="正在加载页面" logoSrc={APP_CONFIG.logoSrc} />;
}
