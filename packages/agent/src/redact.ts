export const redact = (text: string) =>
  text
    .replace(/(?<!\d)\d{17}[\dXx](?![\dXx])/g, "[证件号码已遮蔽]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号已遮蔽]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, "[邮箱已遮蔽]");
