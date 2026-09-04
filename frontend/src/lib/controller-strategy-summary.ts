import type { ControllerInfo } from "@/lib/api";

export type SummaryValue<T> = T | "multiple" | null;

export interface ControllerStrategySummary {
  configuredBuyPrice: SummaryValue<number>;
  estimatedSellPrice: SummaryValue<number>;
  profitPercent: SummaryValue<number>;
  availableBaseBalance: SummaryValue<number>;
  walletCount: number;
  tradeState: SummaryValue<string>;
}

const SELL_STATES = new Set(["holding", "trailing", "selling"]);

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function oneValue<T>(values: T[]): SummaryValue<T> {
  if (values.length === 0) return null;
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : "multiple";
}

function stateLabel(state: string, custom: Record<string, unknown>): string {
  if (state === "external_exit") {
    const change = custom.external_balance_change;
    const reason = change && typeof change === "object"
      ? String((change as Record<string, unknown>).reason || "")
      : "";
    if (reason === "wallet_balance_below_managed_position") {
      return "检测到钱包 MICRODUCK 持仓变化，已暂停";
    }
    return "检测到钱包余额变化，已暂停";
  }
  return ({
    waiting_to_buy: "Buy · Waiting",
    trailing_buy: "Buy · Tracking",
    buying: "Buy · Confirming",
    holding: "Sell · Waiting",
    trailing: "Sell · Tracking",
    selling: "Sell · Confirming",
    completed: "Completed",
  } as Record<string, string>)[state] || state;
}

/**
 * 汇总活动控制器的交易规则。持仓前显示配置卖出价；持仓后显示实际生效价。
 */
export function controllerStrategySummary(
  controllers: ControllerInfo[],
): ControllerStrategySummary {
  const buyPrices: number[] = [];
  const sellPrices: number[] = [];
  const profitPercents: number[] = [];
  const walletBalances = new Map<string, number>();
  const walletKeys = new Set<string>();
  const states: string[] = [];

  for (const controller of controllers) {
    const custom = controller.custom_info || {};
    const config = controller.config || {};
    const walletAddress = String(custom.wallet_address ?? config.wallet_address ?? "").trim();
    const walletKey = walletAddress
      ? walletAddress.toLowerCase()
      : `${controller.bot_name}:${controller.controller_id || controller.controller_name}`;
    walletKeys.add(walletKey);
    const heldPosition = (controller.positions_summary || []).find((position) =>
      positiveNumber(position.amount ?? position.net_amount_base) !== null,
    );
    const state = String(custom.state || (heldPosition ? "holding" : "waiting_to_buy"));

    const buyPrice = positiveNumber(
      custom.buy_price_min_usd ?? config.buy_price_min_usd,
    );
    if (buyPrice !== null) buyPrices.push(buyPrice);

    const configuredSellPrice = positiveNumber(
      custom.sell_price_max_usd ?? config.sell_price_max_usd,
    );
    const finalSellLowerLimit = positiveNumber(
      custom.calculated_sell_unit_price_usd,
    );
    const effectiveSellTarget = positiveNumber(
      custom.effective_sell_target_unit_price_usd,
    );
    const entryPrice = positiveNumber(
      custom.entry_unit_price_usd ?? heldPosition?.entry_price,
    );
    const profitMultiple = positiveNumber(
      custom.sell_profit_multiple ?? config.sell_profit_multiple ?? config.profit_multiple,
    );
    const downwardTolerance = Number(
      custom.sell_price_downward_tolerance_usd
        ?? config.sell_price_downward_tolerance_usd
        ?? 0,
    );
    // 买入前没有实际成交价时，策略本身也会使用配置买入价预估卖出目标。
    // 持仓后才切换为实际买入价，保证状态卡与实际交易规则完全一致。
    const sellPriceBasis = entryPrice ?? buyPrice;
    const sellTarget = sellPriceBasis !== null && profitMultiple !== null
      ? configuredSellPrice === null
        ? sellPriceBasis * profitMultiple
        : Math.min(sellPriceBasis * profitMultiple, configuredSellPrice)
      : null;
    const fallbackEffectivePrice = sellTarget === null
      ? null
      : Math.max(0, sellTarget - (Number.isFinite(downwardTolerance) ? downwardTolerance : 0));
    const estimatedSellPrice = SELL_STATES.has(state) && finalSellLowerLimit !== null
      ? finalSellLowerLimit
      : effectiveSellTarget !== null
        ? Math.max(0, effectiveSellTarget - (Number.isFinite(downwardTolerance) ? downwardTolerance : 0))
        : fallbackEffectivePrice;
    if (estimatedSellPrice !== null) sellPrices.push(estimatedSellPrice);

    const currentPrice = positiveNumber(
      custom.unit_sell_price_usd ?? heldPosition?.current_price,
    );
    if (SELL_STATES.has(state) && entryPrice !== null && currentPrice !== null) {
      profitPercents.push(((currentPrice - entryPrice) / entryPrice) * 100);
    }

    const externalChange = custom.external_balance_change;
    const externalWalletBalance = externalChange && typeof externalChange === "object"
      ? (externalChange as Record<string, unknown>).wallet_balance_base
      : null;
    const rawAvailableBaseBalance = custom.available_base_balance ?? externalWalletBalance;
    if (rawAvailableBaseBalance !== null && rawAvailableBaseBalance !== undefined && rawAvailableBaseBalance !== "") {
      const availableBaseBalance = Number(rawAvailableBaseBalance);
      if (Number.isFinite(availableBaseBalance) && availableBaseBalance >= 0) {
        walletBalances.set(walletKey, availableBaseBalance);
      }
    }

    if (state) states.push(stateLabel(state, custom));
  }

  return {
    configuredBuyPrice: oneValue(buyPrices),
    estimatedSellPrice: oneValue(sellPrices),
    profitPercent: oneValue(profitPercents),
    availableBaseBalance: walletBalances.size > 0
      ? [...walletBalances.values()].reduce((sum, balance) => sum + balance, 0)
      : null,
    walletCount: walletKeys.size,
    tradeState: oneValue(states),
  };
}
