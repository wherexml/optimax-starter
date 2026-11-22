import { ROLE_LABELS, type AccountRole } from "@optimax-starter/api";

export function getRoleLabel(role: string | null | undefined): string {
  if (role && role in ROLE_LABELS) {
    return ROLE_LABELS[role as AccountRole];
  }
  return role || "成员";
}

function sanitizeAgentText(raw: string): string {
  return [...raw]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Chrome\/|CriOS\//i.test(ua)) return "Chrome";
  if (/Firefox\/|FxiOS\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return "";
}

function detectOs(ua: string): string {
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}

export function formatUserAgent(ua: string | null | undefined): string {
  if (!ua) return "未知设备";
  const cleaned = sanitizeAgentText(ua);
  if (!cleaned) return "未知设备";

  const browser = detectBrowser(cleaned);
  const os = detectOs(cleaned);
  if (browser && os) return `${browser} / ${os}`;
  if (browser) return browser;
  if (os) return os;
  return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
}
