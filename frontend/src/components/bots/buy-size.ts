export type BuySizeMode = "budget" | "quantity";

export interface BuySizeConversion {
  budgetUsd: number;
  amountBase: number;
}

export function calculateBuySize(
  mode: BuySizeMode,
  value: number,
  priceUsd: number,
): BuySizeConversion {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("买入值必须大于 0");
  }
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("暂未取得当前价格");
  }
  return mode === "budget"
    ? { budgetUsd: value, amountBase: value / priceUsd }
    : { budgetUsd: value * priceUsd, amountBase: value };
}
