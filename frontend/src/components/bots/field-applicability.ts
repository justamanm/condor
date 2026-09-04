/** 只控制编辑界面，不改变未启用字段的配置值。 */
export function isFieldApplicable(key: string, config: Record<string, unknown>): boolean {
  const conditions: Record<string, [string, string, string]> = {
    buy_budget_usd: ["buy_size_mode", "budget", "budget"],
    buy_amount_base: ["buy_size_mode", "quantity", "budget"],
    buy_trailing_rebound_usd: ["buy_trailing_rebound_mode", "fixed", "fixed"],
    buy_trailing_rebound_percent: ["buy_trailing_rebound_mode", "percentage", "fixed"],
    buy_trailing_rebound_adjustment_factor: ["buy_trailing_rebound_mode", "percentage", "fixed"],
    buy_trailing_rebound_max_percent: ["buy_trailing_rebound_mode", "percentage", "fixed"],
    sell_trailing_drop_usd: ["sell_trailing_drop_mode", "fixed", "fixed"],
    sell_trailing_drop_percent: ["sell_trailing_drop_mode", "percentage", "fixed"],
  };
  const condition = conditions[key];
  return !condition || String(config[condition[0]] ?? condition[2]) === condition[1];
}
