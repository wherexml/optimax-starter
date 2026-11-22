const SUPPORTED_TYPES = new Set([
  "string",
  "text",
  "number",
  "int",
  "boolean",
  "date",
  "enum",
]);

const RESERVED_NAMES = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
]);

export const DEFAULT_FIELDS = [
  { name: "name", type: "string", label: "名称", optional: false },
  { name: "category", type: "string", label: "分类", optional: false },
  { name: "owner", type: "string", label: "负责人", optional: false },
  {
    name: "status",
    type: "enum",
    options: ["启用", "停用"],
    label: "状态",
    optional: false,
  },
];

export function toSnakeCase(name) {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

export function getPrimaryField(fields) {
  return (
    fields.find((f) => f.name === "name" && (f.type === "string" || f.type === "text")) ??
    fields.find((f) => f.type === "string" && !f.optional) ??
    fields.find((f) => f.type === "string" || f.type === "text") ??
    fields[0]
  );
}

/**
 * 解析 `--fields` 参数为结构化字段数组。
 * 语法: `<name>:<type>[:<中文标签>][?]`，enum 为 `<name>:enum:<opt1|opt2>[:<中文标签>][?]`
 */
export function parseFieldsSpec(spec) {
  if (spec === undefined || spec === null || String(spec).trim() === "") {
    return DEFAULT_FIELDS.map((f) =>
      f.options ? { ...f, options: [...f.options] } : { ...f },
    );
  }

  const rawTokens = String(spec)
    .split(",")
    .map((s) => s.trim());

  if (rawTokens.some((t) => t.length === 0)) {
    throw new Error(`--fields 格式错误，存在空字段定义: "${spec}"`);
  }

  const seenNames = new Set();
  const seenColumns = new Set();
  const fields = [];

  for (const rawToken of rawTokens) {
    let token = rawToken;
    let optional = false;
    if (token.endsWith("?")) {
      optional = true;
      token = token.slice(0, -1).trim();
    }

    const parts = token.split(":").map((p) => p.trim());
    if (parts.length < 2) {
      throw new Error(`字段定义缺少类型: "${rawToken}"`);
    }

    const [name, type, ...rest] = parts;
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
      throw new Error(
        `字段名 "${name}" 不合法，必须以小写字母开头且仅包含字母数字`,
      );
    }

    const columnName = toSnakeCase(name);
    if (RESERVED_NAMES.has(name) || RESERVED_NAMES.has(columnName)) {
      throw new Error(`字段名 "${name}" 与系统保留列冲突`);
    }
    if (seenNames.has(name) || seenColumns.has(columnName)) {
      throw new Error(`字段名 "${name}" 重复`);
    }
    seenNames.add(name);
    seenColumns.add(columnName);

    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error(
        `字段 "${name}" 的类型 "${type}" 不支持，可选: ${[...SUPPORTED_TYPES].join(", ")}`,
      );
    }

    if (type === "enum") {
      if (rest.length < 1 || rest.length > 2) {
        throw new Error(
          `枚举字段 "${name}" 格式应为 ${name}:enum:选项A|选项B[:标签][?]`,
        );
      }
      const rawOptions = rest[0]
        .split("|")
        .map((o) => o.trim())
        .filter(Boolean);
      const uniqueOptions = [...new Set(rawOptions)];
      if (uniqueOptions.length < 2 || uniqueOptions.length !== rawOptions.length) {
        throw new Error(
          `枚举字段 "${name}" 至少需要 2 个不重复的非空选项: "${rest[0]}"`,
        );
      }
      const label = rest[1] && rest[1].length > 0 ? rest[1] : name;
      fields.push({
        name,
        type: "enum",
        options: uniqueOptions,
        label,
        optional,
      });
      continue;
    }

    if (rest.length > 1) {
      throw new Error(`字段 "${name}" 定义包含多余的冒号分隔段: "${rawToken}"`);
    }

    const label = rest[0] && rest[0].length > 0 ? rest[0] : name;
    fields.push({
      name,
      type,
      label,
      optional,
    });
  }

  return fields;
}
