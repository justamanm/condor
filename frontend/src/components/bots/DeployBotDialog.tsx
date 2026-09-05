import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Package,
  Pencil,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  api,
  type ControllerConfigSummary,
} from "@/lib/api";
import { configDisplayInfo } from "@/lib/config-display";
import { calculateBuySize, type BuySizeMode } from "./buy-size";
import { isFieldApplicable } from "./field-applicability";
import { PriceQueryGroupSelect } from "./PriceQueryGroupSelect";

// ── Helpers ──

export const HIDDEN_KEYS = new Set([
  "id",
  "controller_name",
  "controller_type",
  "candles_config",
]);

export const MICRODUCK_DEPLOY_KEYS = new Set([
  "wallet_address", "live_trading", "auto_start_next_cycle", "buy_size_mode", "buy_budget_usd", "buy_amount_base", "buy_price_min_usd",
  "buy_price_upward_tolerance_usd", "buy_trailing_rebound_mode",
  "buy_trailing_rebound_usd", "buy_trailing_rebound_percent",
  "buy_trailing_rebound_adjustment_factor", "buy_trailing_rebound_max_percent",
  "sell_profit_multiple", "sell_price_max_usd", "sell_trailing_drop_mode",
  "sell_price_downward_tolerance_usd", "sell_trailing_drop_usd", "sell_trailing_drop_percent",
  "normal_check_interval", "buy_trailing_check_interval", "sell_trailing_check_interval", "price_query_group",
]);

export const MICRODUCK_FIELD_INFO: Record<string, { label: string; description: string }> = {
  buy_size_mode: { label: "买入方式", description: "按预算：固定最多投入的美元；按数量：固定要买入的 MICRODUCK 数量。" },
  buy_budget_usd: { label: "买入预算", description: "本轮最多投入多少美元买入 MICRODUCK。" },
  buy_amount_base: { label: "买入数量", description: "数量模式下要求精确买入的 MICRODUCK 数量。路由不支持精确数量时不会提交交易。" },
  buy_price_min_usd: { label: "买入触发价格", description: "可成交买入价进入这个价格以下后，开始跟踪最低价。单位：美元。" },
  buy_price_upward_tolerance_usd: { label: "买入向上容差", description: "允许买入触发价格向上放宽的金额。设置为 0 表示不放宽。单位：美元。" },
  buy_trailing_rebound_mode: { label: "买入反弹方式", description: "百分比：按最低价的一定比例反弹；固定金额：按固定美元金额反弹。" },
  buy_trailing_rebound_usd: { label: "买入反弹金额", description: "使用固定金额方式时，价格从最低点反弹多少美元后买入。" },
  buy_trailing_rebound_percent: { label: "买入基础反弹比例", description: "原字段 buy_trailing_rebound_percent。动态计算的起始比例，5 表示 5%。" },
  buy_trailing_rebound_adjustment_factor: { label: "买入反弹调整系数", description: "原字段 buy_trailing_rebound_adjustment_factor。实际比例增加量等于相对买入触发价的跌幅乘以此系数。" },
  buy_trailing_rebound_max_percent: { label: "最大买入反弹比例", description: "原字段 buy_trailing_rebound_max_percent。动态增加后的反弹比例不会超过此值，10 表示 10%。" },
  wallet_address: { label: "交易钱包", description: "本次 Bot 使用的钱包地址。部署后不能在运行中修改。" },
  live_trading: { label: "真实交易", description: "开启后会实际提交链上买卖；关闭时只观察和记录，不会成交。" },
  auto_start_next_cycle: { label: "卖出后自动开始下一轮", description: "开启后，卖出交易确认成功便自动回到等待买入；关闭时停留在本轮已完成状态。历史交易和累计利润都会保留。" },
  sell_price_max_usd: { label: "卖出价格上限", description: "可选。留空时只按利润倍数计算卖出目标；填写后，最终目标取计算值和此值中较低的一个。单位：美元。" },
  sell_price_downward_tolerance_usd: { label: "卖出向下容差", description: "允许最终卖出价低于触发点的最大金额。设置为 0 表示不额外放宽。单位：美元。" },
  sell_profit_multiple: { label: "卖出利润倍数", description: "根据实际买入价计算卖出目标。例如 1.5 表示目标价为买入价的 1.5 倍。" },
  sell_trailing_drop_mode: { label: "卖出回落方式", description: "百分比：按最高价的一定比例回落；固定金额：按固定美元金额回落。" },
  sell_trailing_drop_usd: { label: "卖出回落金额", description: "使用固定金额方式时，价格从最高点回落多少美元后卖出。" },
  sell_trailing_drop_percent: { label: "卖出回落比例", description: "使用百分比方式时，价格从最高点回落多少百分比后卖出。例如 5 表示 5%。" },
  normal_check_interval: { label: "普通检查间隔", description: "未进入买入或卖出跟踪时的价格检查间隔。单位：秒。" },
  buy_trailing_check_interval: { label: "买入跟踪检查间隔", description: "进入买入跟踪后检查价格的间隔。默认 1 秒。" },
  sell_trailing_check_interval: { label: "卖出跟踪检查间隔", description: "进入卖出跟踪后检查价格的间隔。默认 2 秒。" },
  price_query_group: { label: "报价分组", description: "留空时独立查询。同名 Bot 会共享日常跟踪报价；下单前仍各自重新报价和校验。" },
};

const FIELD_UNITS: Record<string, string> = {
  buy_budget_usd: "USDG（≈美元）", buy_amount_base: "MICRODUCK",
  buy_price_min_usd: "美元 / MICRODUCK", buy_price_upward_tolerance_usd: "美元 / MICRODUCK",
  buy_trailing_rebound_usd: "美元 / MICRODUCK", buy_trailing_rebound_percent: "%",
  buy_trailing_rebound_adjustment_factor: "小数", buy_trailing_rebound_max_percent: "%",
  sell_profit_multiple: "倍", sell_price_max_usd: "美元 / MICRODUCK",
  sell_price_downward_tolerance_usd: "美元 / MICRODUCK", sell_trailing_drop_usd: "美元 / MICRODUCK",
  sell_trailing_drop_percent: "%",
  normal_check_interval: "秒", buy_trailing_check_interval: "秒", sell_trailing_check_interval: "秒",
};

export function inferInputType(value: unknown): "number" | "boolean" | "text" | "json" {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "object" && value !== null) return "json";
  return "text";
}

export function parseValue(raw: string, type: "number" | "boolean" | "text" | "json"): unknown {
  if (type === "number") {
    const n = Number(raw);
    return isNaN(n) ? raw : n;
  }
  if (type === "boolean") return raw === "true";
  if (type === "json") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

export function parseConfigValue(key: string, raw: string, type: "number" | "boolean" | "text" | "json"): unknown {
  if (key === "sell_price_max_usd" && raw.trim() === "") return null;
  if (key === "price_query_group" && raw.trim() === "") return null;
  return parseValue(raw, type);
}

// ── Config Editor for a single config ──

export function ConfigEditor({
  server,
  configId,
  onDirtyChange,
  onConfirmedChange,
  confirmed,
  onRemove,
}: {
  server: string;
  configId: string;
  onDirtyChange: (configId: string, edits: Record<string, unknown> | null) => void;
  onConfirmedChange: (configId: string, confirmed: boolean) => void;
  confirmed: boolean;
  onRemove?: (configId: string) => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(true);
  const [conversionMessage, setConversionMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["config-detail", server, configId],
    queryFn: () => api.getConfigDetail(server, configId),
    enabled: true,
  });

  const config = data?.config ?? {};
  const isMicroduck = data?.controller_name === "microduck_profit_trailing";
  const editableConfig = useMemo(
    () => isMicroduck
      ? {
          buy_size_mode: "quantity",
          buy_amount_base: 1,
          buy_trailing_rebound_adjustment_factor: 0.2,
          buy_trailing_rebound_max_percent: 5,
          auto_start_next_cycle: false,
          price_query_group: "",
          ...config,
        }
      : config,
    [config, isMicroduck],
  );
  const displayInfo = configDisplayInfo(configId);
  const effectiveBuyMode = String(
    edits.buy_size_mode ?? editableConfig.buy_size_mode ?? "budget",
  ) as BuySizeMode;
  const hasPriceQueryGroup = Boolean(String(
    edits.price_query_group ?? editableConfig.price_query_group ?? "",
  ).trim());
  const entries = useMemo(
    () => Object.entries(editableConfig).filter(([key]) =>
      !HIDDEN_KEYS.has(key) &&
      (!isMicroduck || MICRODUCK_DEPLOY_KEYS.has(key)) &&
      (!hasPriceQueryGroup || !["normal_check_interval", "buy_trailing_check_interval"].includes(key)),
    ).sort(([a], [b]) => isMicroduck
      ? [...MICRODUCK_DEPLOY_KEYS].indexOf(a) - [...MICRODUCK_DEPLOY_KEYS].indexOf(b)
      : 0),
    [editableConfig, effectiveBuyMode, hasPriceQueryGroup, isMicroduck],
  );

  const walletsQuery = useQuery({
    queryKey: ["gateway-wallets", server],
    queryFn: () => api.getGatewayWallets(server),
    enabled: isMicroduck,
    staleTime: 30_000,
    retry: false,
  });
  const walletAddresses = [...new Set((walletsQuery.data?.wallets ?? [])
    .filter((group) => group.chain.toLowerCase() === String(editableConfig.chain ?? "ethereum").toLowerCase())
    .flatMap((group) => group.walletAddresses))];

  const { data: walletBalances } = useQuery({
    queryKey: ["microduck-buy-conversion-price", server, configId],
    queryFn: () => api.getWalletBalances(
      server,
      String(editableConfig.chain ?? "ethereum"),
      String(editableConfig.network ?? "robinhoodchain"),
      ["MICRODUCK", "ETH"],
    ),
    enabled: isMicroduck,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const currentBuyPrice = useMemo(() => {
    const price = Number(walletBalances?.prices?.MICRODUCK);
    return Number.isFinite(price) && price > 0 ? price : null;
  }, [walletBalances?.prices?.MICRODUCK]);

  const isDirty = Object.keys(edits).length > 0;

  useEffect(() => {
    if (!isMicroduck || !data) return;
    setEdits((previous) => {
      const next = { ...previous };
      let changed = false;
      if (!("buy_size_mode" in config) && !("buy_size_mode" in next)) {
        next.buy_size_mode = "quantity";
        changed = true;
      }
      if (!("buy_amount_base" in config) && !("buy_amount_base" in next)) {
        next.buy_amount_base = "1";
        changed = true;
      }
      if (!("buy_trailing_rebound_adjustment_factor" in config) && !("buy_trailing_rebound_adjustment_factor" in next)) {
        next.buy_trailing_rebound_adjustment_factor = "0.2";
        changed = true;
      }
      if (!("buy_trailing_rebound_max_percent" in config) && !("buy_trailing_rebound_max_percent" in next)) {
        next.buy_trailing_rebound_max_percent = "5";
        changed = true;
      }
      if (!("buy_trailing_check_interval" in config) && !("buy_trailing_check_interval" in next)) {
        next.buy_trailing_check_interval = "1";
        changed = true;
      }
      if (!("sell_trailing_check_interval" in config) && !("sell_trailing_check_interval" in next)) {
        next.sell_trailing_check_interval = "2";
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [config, data, isMicroduck]);

  // Notify parent about dirty state
  useEffect(() => {
    if (!isDirty) {
      onDirtyChange(configId, null);
      return;
    }
    const parsed: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(edits)) {
      const originalValue = editableConfig[key];
      parsed[key] = parseConfigValue(key, raw, inferInputType(originalValue));
    }
    onDirtyChange(configId, parsed);
  }, [edits, configId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEdit = useCallback((key: string, value: string) => {
    setEdits((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "price_query_group" && value.trim()) {
        delete next.normal_check_interval;
        delete next.buy_trailing_check_interval;
      }
      return next;
    });
    if (key === "buy_size_mode" || key === "buy_budget_usd" || key === "buy_amount_base") {
      setConversionMessage(null);
    }
    onConfirmedChange(configId, false);
  }, [configId, onConfirmedChange]);

  const handleReset = useCallback((key: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    onConfirmedChange(configId, false);
  }, [configId, onConfirmedChange]);

  const handleResetAll = useCallback(() => {
    setEdits({});
    onConfirmedChange(configId, false);
  }, [configId, onConfirmedChange]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]" />
          Loading {configId}...
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border overflow-hidden transition-colors ${isDirty ? "border-[var(--color-warning)]/60" : "border-[var(--color-border)]"}`}>
      {/* Header */}
      <div className="flex items-center bg-[var(--color-surface)]">
        <button
          className="flex flex-1 items-center gap-2 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          )}
          <Package className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <span className="text-sm font-medium truncate" title={displayInfo.tooltip}>
            {displayInfo.name}
          </span>
          {data?.controller_name && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {data.controller_name}
            </span>
          )}
          {isDirty && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-warning)]">
              <Pencil className="h-3 w-3" />
              {Object.keys(edits).length} edited
            </span>
          )}
        </button>
        {onRemove && (
          <button
            onClick={() => onRemove(configId)}
            className="px-3 py-3 text-[var(--color-text-muted)] hover:text-[var(--color-red)] transition-colors"
            title="Remove config"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Fields */}
      {expanded && (
        <div className="border-t border-[var(--color-border)]/30">
          <div className="px-4 pt-3 text-xs text-[var(--color-text-muted)]" title={displayInfo.tooltip}>
            {displayInfo.description}
          </div>
          {/* Reset all button */}
          {isDirty && (
            <div className="flex justify-end px-4 pt-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleResetAll(); }}
                className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset all
              </button>
            </div>
          )}
          <div className="grid gap-2 p-4 pt-2">
            {(isMicroduck ? [
              { title: "买入设置", fields: entries.filter(([key]) => key.startsWith("buy_")) },
              { title: "卖出设置", fields: entries.filter(([key]) => key.startsWith("sell_")) },
              { title: "通用设置", fields: entries.filter(([key]) => !key.startsWith("buy_") && !key.startsWith("sell_")) },
            ] : [{ title: "", fields: entries }]).map((section) => (
              <fieldset key={section.title} className="min-w-0 grid gap-2 rounded-lg border border-[var(--color-border)] p-3 mt-2">
                {section.title && <legend className="px-2 text-sm font-semibold text-[var(--color-text)]">{section.title}</legend>}
                {section.fields.map(([key, originalValue]) => {
              const inputType = inferInputType(originalValue);
              const applicable = !isMicroduck || isFieldApplicable(key, { ...editableConfig, ...edits });
              const isEdited = key in edits;
              const displayValue = isEdited
                ? edits[key]
                : key === "sell_price_max_usd" && (originalValue === null || Number(originalValue) === 0)
                  ? ""
                : inputType === "json"
                  ? JSON.stringify(originalValue, null, 2)
                  : String(originalValue ?? "");

              return (
                <div key={key} className="grid grid-cols-[minmax(120px,1fr)_2fr] gap-2 items-start">
                  <div className={`flex items-center gap-1 pt-2 text-xs ${isEdited ? "text-[var(--color-warning)] font-medium" : "text-[var(--color-text-muted)]"}`}>
                    <span className="truncate">{MICRODUCK_FIELD_INFO[key]?.label ?? key}</span>
                    {MICRODUCK_FIELD_INFO[key] && (
                      <span className="group relative inline-flex shrink-0">
                        <CircleHelp className="h-3 w-3" />
                        <span className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-xs font-normal leading-5 text-[var(--color-text)] shadow-lg group-hover:block">
                          <span className="block">{MICRODUCK_FIELD_INFO[key].description}</span>
                          <span className="mt-1 block font-mono text-[10px] text-[var(--color-text-muted)]">原字段名：{key}</span>
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-start gap-1">
                    {!applicable ? (
                      <input aria-label={MICRODUCK_FIELD_INFO[key]?.label ?? key} disabled value="不适用" className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] opacity-60 cursor-not-allowed" />
                    ) : key === "price_query_group" && isMicroduck ? (
                      <PriceQueryGroupSelect server={server} value={displayValue} onChange={(nextValue) => handleEdit(key, nextValue)} />
                    ) : key === "wallet_address" && isMicroduck ? (
                      <div className="min-w-0 w-full">
                        <select
                          aria-label="交易钱包"
                          value={walletAddresses.find((address) => address.toLowerCase() === displayValue.toLowerCase()) ?? displayValue}
                          onChange={(e) => handleEdit(key, e.target.value)}
                          disabled={walletsQuery.isLoading || walletAddresses.length === 0}
                          className="w-full min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)]"
                        >
                          {!walletAddresses.some((address) => address.toLowerCase() === displayValue.toLowerCase()) && (
                            <option value={displayValue} disabled>{displayValue || "请选择钱包"}（当前配置）</option>
                          )}
                          {walletAddresses.map((address) => <option key={address} value={address}>{address}</option>)}
                        </select>
                        {walletsQuery.isLoading && <p className="mt-1 text-xs text-[var(--color-text-muted)]">正在读取钱包列表</p>}
                        {walletsQuery.isError && <p className="mt-1 text-xs text-[var(--color-red)]">钱包列表读取失败，未更改当前地址</p>}
                        {!walletsQuery.isLoading && !walletsQuery.isError && walletAddresses.length === 0 && <p className="mt-1 text-xs text-[var(--color-text-muted)]">当前链没有已接入钱包，请先在设置中添加</p>}
                      </div>
                    ) : key === "buy_size_mode" ? (
                      <select
                        value={displayValue}
                        onChange={(e) => handleEdit(key, e.target.value)}
                        className={`w-full rounded-md border bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] ${isEdited ? "border-[var(--color-warning)]/60" : "border-[var(--color-border)]"}`}
                      >
                        <option value="budget">按预算</option>
                        <option value="quantity">按数量</option>
                      </select>
                    ) : key === "buy_trailing_rebound_mode" || key === "sell_trailing_drop_mode" ? (
                      <select
                        value={displayValue}
                        onChange={(e) => handleEdit(key, e.target.value)}
                        className={`w-full rounded-md border bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] ${isEdited ? "border-[var(--color-warning)]/60" : "border-[var(--color-border)]"}`}
                      >
                        <option value="percentage">按百分比</option>
                        <option value="fixed">按固定金额</option>
                      </select>
                    ) : inputType === "boolean" ? (
                      <button
                        onClick={() => {
                          const current = isEdited ? edits[key] === "true" : Boolean(originalValue);
                          handleEdit(key, String(!current));
                        }}
                        className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                          (isEdited ? edits[key] === "true" : Boolean(originalValue))
                            ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                        }`}
                      >
                        <div className={`h-3 w-3 rounded-sm border flex items-center justify-center ${
                          (isEdited ? edits[key] === "true" : Boolean(originalValue))
                            ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                            : "border-[var(--color-border)]"
                        }`}>
                          {(isEdited ? edits[key] === "true" : Boolean(originalValue)) && (
                            <Check className="h-2 w-2 text-white" />
                          )}
                        </div>
                        {(isEdited ? edits[key] === "true" : Boolean(originalValue)) ? "开启" : "关闭"}
                      </button>
                    ) : inputType === "json" ? (
                      <textarea
                        value={displayValue}
                        onChange={(e) => handleEdit(key, e.target.value)}
                        rows={Math.min(6, displayValue.split("\n").length + 1)}
                        className={`w-full rounded-md border bg-[var(--color-bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] resize-y ${
                          isEdited ? "border-[var(--color-warning)]/60" : "border-[var(--color-border)]"
                        }`}
                      />
                    ) : (
                      <div className="w-full">
                        <div className="flex gap-1">
                          <input
                            type={inputType === "number" ? "number" : "text"}
                            step={inputType === "number" ? "any" : undefined}
                            value={displayValue}
                            onChange={(e) => handleEdit(key, e.target.value)}
                            placeholder={key === "sell_price_max_usd" ? "不设置（按利润倍数）" : undefined}
                            className={`min-w-0 flex-1 rounded-md border bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] ${
                              inputType === "number" ? "font-mono tabular-nums" : ""
                            } ${isEdited ? "border-[var(--color-warning)]/60" : "border-[var(--color-border)]"}`}
                          />
                          {FIELD_UNITS[key] && <span className="flex shrink-0 items-center rounded-md border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-muted)]">{FIELD_UNITS[key]}</span>}
                          {(key === "buy_budget_usd" || key === "buy_amount_base") && (
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  const result = calculateBuySize(
                                    effectiveBuyMode,
                                    Number(displayValue),
                                    Number(currentBuyPrice),
                                  );
                                  setConversionMessage(
                                    effectiveBuyMode === "budget"
                                      ? `当前约可买 ${result.amountBase.toFixed(6)} MICRODUCK`
                                      : `当前约需 $${result.budgetUsd.toFixed(4)}`,
                                  );
                                } catch (error) {
                                  setConversionMessage(error instanceof Error ? error.message : "换算失败");
                                }
                              }}
                              className="whitespace-nowrap rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                            >
                              按当前价格换算
                            </button>
                          )}
                        </div>
                        {(key === "buy_budget_usd" || key === "buy_amount_base") && conversionMessage && (
                          <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">{conversionMessage}</div>
                        )}
                      </div>
                    )}
                    {isEdited && applicable && (
                      <button
                        onClick={() => handleReset(key)}
                        className="mt-1 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        title="Reset to original"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
                })}
              </fieldset>
            ))}
            <label className="mt-2 flex items-center gap-2 border-t border-[var(--color-border)] pt-3 text-xs font-medium text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => onConfirmedChange(configId, event.target.checked)}
              />
              我已核对并确认这份 Bot 的部署参数
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Dialog ──

export function DeployBotDialog({
  open,
  onClose,
  server,
}: {
  open: boolean;
  onClose: () => void;
  server: string;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Bot settings
  const [botName, setBotName] = useState(
    () => `bot_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(0, 15)}`,
  );
  const [displayName, setDisplayName] = useState("");
  const [accountName, setAccountName] = useState("master_account");
  const [image, setImage] = useState("microduck/hummingbot:local");
  const [maxGlobalDrawdown, setMaxGlobalDrawdown] = useState("");
  const [maxControllerDrawdown, setMaxControllerDrawdown] = useState("");

  // Track edits per config
  const [configEdits, setConfigEdits] = useState<Record<string, Record<string, unknown> | null>>({});
  const [confirmedConfigs, setConfirmedConfigs] = useState<Set<string>>(new Set());

  const dirtyConfigs = useMemo(
    () => Object.entries(configEdits).filter(([, v]) => v !== null) as [string, Record<string, unknown>][],
    [configEdits],
  );

  const handleDirtyChange = useCallback((configId: string, edits: Record<string, unknown> | null) => {
    setConfigEdits((prev) => {
      if (prev[configId] === edits) return prev;
      if (edits === null && !(configId in prev)) return prev;
      const next = { ...prev };
      if (edits === null) delete next[configId];
      else next[configId] = edits;
      return next;
    });
  }, []);

  const handleConfirmedChange = useCallback((configId: string, confirmed: boolean) => {
    setConfirmedConfigs((previous) => {
      const next = new Set(previous);
      if (confirmed) next.add(configId);
      else next.delete(configId);
      return next;
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["available-configs", server],
    queryFn: () => api.getAvailableConfigs(server),
    enabled: open,
  });

  const configs = data?.configs ?? [];

  const filteredConfigs = useMemo(() => {
    if (!search.trim()) return configs;
    const q = search.toLowerCase();
    return configs.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.controller_name.toLowerCase().includes(q) ||
        c.connector_name.toLowerCase().includes(q) ||
        c.trading_pair.toLowerCase().includes(q),
    );
  }, [configs, search]);

  // Group unselected configs by type for browsing
  const unselectedConfigs = useMemo(
    () => filteredConfigs.filter((c) => !selected.has(c.id)),
    [filteredConfigs, selected],
  );

  const groupedUnselected = useMemo(() => {
    const groups: Record<string, ControllerConfigSummary[]> = {};
    for (const c of unselectedConfigs) {
      const type = c.controller_type || "other";
      (groups[type] ??= []).push(c);
    }
    return groups;
  }, [unselectedConfigs]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setConfigEdits((ce) => { const n = { ...ce }; delete n[id]; return n; });
        setConfirmedConfigs((items) => { const n = new Set(items); n.delete(id); return n; });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Deploy
  const deployMutation = useMutation({
    mutationFn: async () => {
      return api.deployBot(server, {
        bot_name: botName,
        display_name: displayName.trim() || null,
        controllers_config: Array.from(selected),
        controller_overrides: Object.fromEntries(dirtyConfigs),
        account_name: accountName,
        image,
        max_global_drawdown_quote: maxGlobalDrawdown ? parseFloat(maxGlobalDrawdown) : null,
        max_controller_drawdown_quote: maxControllerDrawdown ? parseFloat(maxControllerDrawdown) : null,
      });
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["bots", server], type: "active" });
      queryClient.invalidateQueries({ queryKey: ["config-detail"] });
      queryClient.invalidateQueries({ queryKey: ["available-configs", server] });
      handleClose();
    },
    onError: (err) => {
      setDeployError(err instanceof Error ? err.message : "Deployment failed");
    },
  });

  const handleClose = () => {
    setSelected(new Set());
    setSearch("");
    setShowAdvanced(false);
    setDeployError(null);
    setConfigEdits({});
    setConfirmedConfigs(new Set());
    setDisplayName("");
    onClose();
  };

  // Reset bot name on open
  useEffect(() => {
    if (open) {
      setBotName(`bot_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(0, 15)}`);
      setDisplayName("");
    }
  }, [open]);

  useEscapeKey(open, handleClose);

  if (!open) return null;

  const hasSelected = selected.size > 0;
  const allSelectedConfirmed = hasSelected && Array.from(selected).every((id) => confirmedConfigs.has(id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-[var(--color-primary)]" />
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              Deploy Bot
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-[var(--color-surface-hover)] transition-colors"
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {deployError && (
            <div className="rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-4 py-3">
              <p className="text-sm text-[var(--color-red)]">{deployError}</p>
              <button onClick={() => { setDeployError(null); deployMutation.mutate(); }} className="mt-2 text-xs font-medium text-[var(--color-red)] underline">重试</button>
            </div>
          )}

          {/* Selected configs with inline editors */}
          {hasSelected && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Selected ({selected.size})
              </h3>
              <div className="space-y-2">
                {Array.from(selected).map((id) => (
                  <ConfigEditor
                    key={id}
                    server={server}
                    configId={id}
                    onDirtyChange={handleDirtyChange}
                    onConfirmedChange={handleConfirmedChange}
                    confirmed={confirmedConfigs.has(id)}
                    onRemove={toggleSelect}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Available configs */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {hasSelected ? "Add more" : "Select configs"}
            </h3>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search configs..."
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)]/50 outline-none transition-colors focus:border-[var(--color-primary)]"
                autoFocus
              />
            </div>

            {isLoading ? (
              <div className="flex h-24 items-center justify-center text-[var(--color-text-muted)]">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]" />
              </div>
            ) : unselectedConfigs.length === 0 ? (
              <div className="flex h-16 items-center justify-center text-[var(--color-text-muted)]">
                <p className="text-xs">{configs.length === 0 ? "No configs available" : "All configs selected"}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--color-border)] overflow-hidden max-h-[300px] overflow-y-auto">
                {Object.entries(groupedUnselected).map(([type, cfgs]) => (
                  <div key={type}>
                    <div className="px-4 py-1.5 bg-[var(--color-surface)] text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] sticky top-0 border-b border-[var(--color-border)]/30">
                      {type} ({cfgs.length})
                    </div>
                    {cfgs.map((cfg) => (
                      <button
                        key={cfg.id}
                        onClick={() => toggleSelect(cfg.id)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-[var(--color-surface-hover)]/50 transition-colors border-b border-[var(--color-border)]/20 last:border-b-0"
                      >
                        <div className="h-4 w-4 rounded border border-[var(--color-border)] flex items-center justify-center shrink-0" />
                        <span className="text-sm font-medium truncate" title={configDisplayInfo(cfg.id).tooltip}>
                          {configDisplayInfo(cfg.id).name}
                        </span>
                        {cfg.connector_name && (
                          <span className="text-xs text-[var(--color-text-muted)]">{cfg.connector_name}</span>
                        )}
                        {cfg.trading_pair && (
                          <span className="text-xs font-mono text-[var(--color-text-muted)]">{cfg.trading_pair}</span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advanced settings (collapsed by default) */}
          <div className="border-t border-[var(--color-border)] pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="font-medium">Advanced Settings</span>
              {showAdvanced ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Bot 别名（可选）</label>
                  <input
                    type="text"
                    value={displayName}
                    maxLength={80}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="例如：低位买入策略"
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
                  />
                  <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">只用于页面显示，之后可随时修改。</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Bot 系统名称</label>
                  <input
                    type="text"
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Account</label>
                    <input
                      type="text"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Image</label>
                    <input
                      type="text"
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Max Global Drawdown</label>
                    <input
                      type="number"
                      value={maxGlobalDrawdown}
                      onChange={(e) => setMaxGlobalDrawdown(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)]/50 outline-none transition-colors focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Max Controller Drawdown</label>
                    <input
                      type="number"
                      value={maxControllerDrawdown}
                      onChange={(e) => setMaxControllerDrawdown(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)]/50 outline-none transition-colors focus:border-[var(--color-primary)]"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-6 py-4">
          <span className="text-xs text-[var(--color-text-muted)]">
            {selected.size} config{selected.size !== 1 ? "s" : ""}
            {dirtyConfigs.length > 0 && ` · ${dirtyConfigs.length} modified`}
          </span>
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
            <button
              onClick={() => deployMutation.mutate()}
              disabled={!allSelectedConfirmed || !botName.trim() || deployMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
            >
              <Rocket className="h-4 w-4" />
              {deployMutation.isPending
                ? "正在部署..."
                : "部署独立配置"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
