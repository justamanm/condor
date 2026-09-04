import { describe, expect, it } from "vitest";

import { calculateBuySize } from "./buy-size";

describe("calculateBuySize", () => {
  it("converts a dollar budget to MICRODUCK quantity", () => {
    expect(calculateBuySize("budget", 1, 0.02)).toEqual({
      budgetUsd: 1,
      amountBase: 50,
    });
  });

  it("converts MICRODUCK quantity to dollars", () => {
    expect(calculateBuySize("quantity", 50, 0.02)).toEqual({
      budgetUsd: 1,
      amountBase: 50,
    });
  });

  it("rejects missing prices and invalid values", () => {
    expect(() => calculateBuySize("budget", 1, 0)).toThrow("暂未取得当前价格");
    expect(() => calculateBuySize("quantity", 0, 0.02)).toThrow("买入值必须大于 0");
  });
});
