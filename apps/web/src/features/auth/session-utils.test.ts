import { describe, expect, it } from "vitest";
import { formatUserAgent, getRoleLabel } from "./session-utils";

describe("session utils", () => {
  it("maps all three system roles to Chinese labels", () => {
    expect(getRoleLabel("super_admin")).toBe("超级管理员");
    expect(getRoleLabel("admin")).toBe("管理员");
    expect(getRoleLabel("member")).toBe("成员");
    expect(getRoleLabel(null)).toBe("成员");
    expect(getRoleLabel(undefined)).toBe("成员");
    expect(getRoleLabel("custom_role")).toBe("custom_role");
  });

  it("formats browser and OS user agents cleanly without middle dots", () => {
    expect(formatUserAgent(null)).toBe("未知设备");
    expect(formatUserAgent("")).toBe("未知设备");

    const chromeMac = formatUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    expect(chromeMac).toBe("Chrome / macOS");
    expect(chromeMac.includes("·")).toBe(false);

    expect(
      formatUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      ),
    ).toBe("Edge / Windows");

    expect(
      formatUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari / iOS");

    expect(formatUserAgent("curl/8.7.1\r\n")).toBe("curl/8.7.1");
  });
});
