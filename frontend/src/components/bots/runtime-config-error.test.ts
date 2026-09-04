import { expect, it } from "vitest";
import { describeRuntimeConfigError } from "./runtime-config-error";

it("提取配置模型的中文校验原因并定位相关字段", () => {
  const feedback = describeRuntimeConfigError(new Error(
    "Failed to save controller config: 1 validation error for MicroduckProfitTrailingConfig\n  Value error, 最大买入反弹比例不能小于基础买入反弹比例 [type=value_error]",
  ));

  expect(feedback.message).toBe("最大买入反弹比例不能小于基础买入反弹比例");
  expect(feedback.fields).toEqual([
    "buy_trailing_rebound_percent",
    "buy_trailing_rebound_max_percent",
  ]);
});

it("保留无法定位字段的其他校验错误", () => {
  const feedback = describeRuntimeConfigError(new Error("buy_price_min_usd: Input should be greater than 0"));

  expect(feedback.message).toBe("buy_price_min_usd: Input should be greater than 0");
  expect(feedback.fields).toEqual([]);
});
