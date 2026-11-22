export type DataTone = "brand" | "success" | "warning" | "danger" | "neutral";

export interface DataToneStyle {
  /** 实色描边或状态主色 */
  solid: string;
  /** 柔和浅底色 */
  soft: string;
  /** 浅底上的高对比前景色 */
  text: string;
  /** 水平分布条柔底填充 */
  barSoft: string;
}

export const DATA_TONE_STYLES: Record<DataTone, DataToneStyle> = {
  brand: {
    solid: "var(--primary)",
    soft: "var(--accent)",
    text: "var(--accent-foreground)",
    barSoft: "color-mix(in srgb, var(--primary) 13%, transparent)",
  },
  success: {
    solid: "var(--success-solid, #30a46c)",
    soft: "var(--success, #e6f6eb)",
    text: "var(--success-foreground, #218358)",
    barSoft: "var(--success, #e6f6eb)",
  },
  warning: {
    solid: "var(--warning-solid, #f5a623)",
    soft: "var(--warning, #fff7c2)",
    text: "var(--warning-foreground, #ab6400)",
    barSoft: "var(--warning, #fff7c2)",
  },
  danger: {
    solid: "var(--destructive, #dc3e42)",
    soft: "var(--danger-subtle, #feebec)",
    text: "var(--danger-foreground, #ce2c31)",
    barSoft: "var(--danger-subtle, #feebec)",
  },
  neutral: {
    solid: "var(--muted-foreground)",
    soft: "var(--muted)",
    text: "var(--muted-foreground)",
    barSoft: "var(--muted)",
  },
};
