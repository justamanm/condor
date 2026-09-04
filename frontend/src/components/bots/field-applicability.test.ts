import { expect, it } from "vitest";
import { isFieldApplicable } from "./field-applicability";

it("买入百分比和固定金额互斥，包含动态比例字段", () => {
  for (const mode of ["fixed", "percentage"]) {
    const config = { buy_trailing_rebound_mode: mode };
    expect(isFieldApplicable("buy_trailing_rebound_usd", config)).toBe(mode === "fixed");
    for (const key of ["buy_trailing_rebound_percent", "buy_trailing_rebound_adjustment_factor", "buy_trailing_rebound_max_percent"]) {
      expect(isFieldApplicable(key, config)).toBe(mode === "percentage");
    }
  }
});
it("卖出方式与买入数量方式控制各自字段", () => {
  for (const mode of ["fixed", "percentage"]) {
    expect(isFieldApplicable("sell_trailing_drop_usd", { sell_trailing_drop_mode: mode })).toBe(mode === "fixed");
    expect(isFieldApplicable("sell_trailing_drop_percent", { sell_trailing_drop_mode: mode })).toBe(mode === "percentage");
  }
  for (const mode of ["budget", "quantity"]) {
    expect(isFieldApplicable("buy_budget_usd", { buy_size_mode: mode })).toBe(mode === "budget");
    expect(isFieldApplicable("buy_amount_base", { buy_size_mode: mode })).toBe(mode === "quantity");
  }
});
it("切换不修改原始数值，普通字段始终适用", () => {
  const config = { buy_trailing_rebound_mode: "percentage", buy_trailing_rebound_usd: 0.0003 };
  expect(isFieldApplicable("buy_trailing_rebound_usd", config)).toBe(false);
  config.buy_trailing_rebound_mode = "fixed";
  expect(isFieldApplicable("buy_trailing_rebound_usd", config)).toBe(true);
  expect(config.buy_trailing_rebound_usd).toBe(0.0003);
  expect(isFieldApplicable("wallet_address", config)).toBe(true);
});
