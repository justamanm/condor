export interface RuntimeConfigErrorFeedback {
  message: string;
  fields: string[];
}

const FIELD_RULES: Array<{ marker: string; fields: string[] }> = [
  {
    marker: "最大买入反弹比例不能小于基础买入反弹比例",
    fields: ["buy_trailing_rebound_percent", "buy_trailing_rebound_max_percent"],
  },
  {
    marker: "跟踪阶段的检查间隔必须短于普通阶段",
    fields: ["normal_check_interval", "trailing_check_interval"],
  },
];

export function describeRuntimeConfigError(error: unknown): RuntimeConfigErrorFeedback {
  const raw = error instanceof Error ? error.message : "保存失败，请稍后重试。";
  const valueError = raw.match(/Value error,\s*([^\n]+?)(?:\s*\[type=|$)/);
  const message = valueError?.[1]?.trim() || raw.replace(/^Failed to save controller config:\s*/i, "");
  const rule = FIELD_RULES.find(({ marker }) => message.includes(marker));
  return { message, fields: rule?.fields ?? [] };
}
