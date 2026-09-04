import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleHelp, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { inferInputType, parseConfigValue, MICRODUCK_DEPLOY_KEYS, MICRODUCK_FIELD_INFO } from "@/components/bots/DeployBotDialog";
import { isFieldApplicable } from "./field-applicability";
import { runtimeConfigMatches } from "./runtime-config-match";
import { describeRuntimeConfigError } from "./runtime-config-error";
import { api } from "@/lib/api";
import { configDisplayInfo } from "@/lib/config-display";

const SAFE_FIELDS = [
  "buy_size_mode", "buy_budget_usd", "buy_amount_base", "buy_price_min_usd", "buy_price_upward_tolerance_usd",
  "buy_trailing_rebound_mode", "buy_trailing_rebound_usd", "buy_trailing_rebound_percent",
  "buy_trailing_rebound_adjustment_factor", "buy_trailing_rebound_max_percent",
  "sell_profit_multiple", "sell_price_max_usd", "sell_price_downward_tolerance_usd",
  "sell_trailing_drop_mode", "sell_trailing_drop_usd", "sell_trailing_drop_percent",
  "normal_check_interval", "trailing_check_interval", "status_log_interval_seconds", "live_trading",
  "price_query_group",
] as const;

const FIELD_LABELS: Record<string, string> = {
  buy_size_mode: "买入方式", buy_budget_usd: "买入预算（美元）",
  buy_amount_base: "买入数量（MICRODUCK）", buy_price_min_usd: "买入触发价格",
  buy_price_upward_tolerance_usd: "买入向上容差", buy_trailing_rebound_mode: "买入反弹模式",
  buy_trailing_rebound_usd: "买入反弹固定值", buy_trailing_rebound_percent: "买入基础反弹比例",
  buy_trailing_rebound_adjustment_factor: "买入反弹调整系数",
  buy_trailing_rebound_max_percent: "最大买入反弹比例",
  sell_profit_multiple: "卖出利润倍数", sell_price_max_usd: "卖出价格上限",
  sell_price_downward_tolerance_usd: "卖出向下容差", sell_trailing_drop_mode: "卖出回落模式",
  sell_trailing_drop_usd: "卖出回落固定值", sell_trailing_drop_percent: "卖出回落百分比",
  normal_check_interval: "普通检查间隔（秒）", trailing_check_interval: "跟踪检查间隔（秒）",
  status_log_interval_seconds: "状态日志间隔（秒）", live_trading: "真实交易",
  price_query_group: "报价分组",
};

// 配置字段的内部名称不能让用户判断数值单位；统一在输入框右侧展示，避免把价格、币数量和比例混淆。
const FIELD_UNITS: Record<string, string> = {
  buy_budget_usd: "USDG（≈美元）",
  buy_amount_base: "MICRODUCK",
  buy_price_min_usd: "美元 / MICRODUCK",
  buy_price_upward_tolerance_usd: "美元 / MICRODUCK",
  buy_trailing_rebound_usd: "美元 / MICRODUCK",
  buy_trailing_rebound_percent: "%",
  buy_trailing_rebound_adjustment_factor: "小数",
  buy_trailing_rebound_max_percent: "%",
  sell_profit_multiple: "倍",
  sell_price_max_usd: "美元 / MICRODUCK",
  sell_price_downward_tolerance_usd: "美元 / MICRODUCK",
  sell_trailing_drop_usd: "美元 / MICRODUCK",
  sell_trailing_drop_percent: "%",
  normal_check_interval: "秒",
  trailing_check_interval: "秒",
  status_log_interval_seconds: "秒",
};

export function RuntimeConfigDialog({ open, server, botName, botDisplayName, configId, onClose }: {
  open: boolean; server: string; botName: string; botDisplayName?: string | null; configId: string; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState("");
  const [pendingApply, setPendingApply] = useState<{ values: Record<string, unknown>; started: number } | null>(null);
  const configQuery = useQuery({
    queryKey: ["bot-controller-configs", server, botName],
    queryFn: () => api.getBotControllerConfigs(server, botName),
    enabled: open,
  });
  const config = useMemo(() => {
    const found = configQuery.data?.find((item) =>
      String(item._config_name ?? item.id ?? "") === configId,
    );
    if (!found) return found;
    return found.controller_name === "microduck_profit_trailing" ? {
      buy_trailing_rebound_adjustment_factor: 0.5,
      buy_trailing_rebound_max_percent: 10,
      price_query_group: "",
      ...found,
    } : found;
  }, [configId, configQuery.data]);
  const fields = useMemo(() => {
    const order = [...MICRODUCK_DEPLOY_KEYS, ...SAFE_FIELDS.filter((key) => !MICRODUCK_DEPLOY_KEYS.has(key))];
    return SAFE_FIELDS.filter((key) => config && (key in config || key === "price_query_group"))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [config]);
  useEffect(() => {
    setPendingApply(null);
    if (open) { setEdits({}); setSavedMessage(""); }
  }, [open, botName, configId]);

  const appliedQuery = useQuery({
    queryKey: ["runtime-apply-check", server, botName, configId, pendingApply?.started],
    queryFn: () => api.getBots(server),
    enabled: open && pendingApply !== null,
    refetchInterval: pendingApply ? 2000 : false,
    retry: false,
  });
  useEffect(() => {
    if (!open || !pendingApply) return;
    if (appliedQuery.isError) {
      setPendingApply(null);
      setSavedMessage("配置已保存，但读取 Bot 回报失败，暂不能确认生效。请稍后核对，不要重复提交。");
      return;
    }
    const controller = appliedQuery.data?.controllers.find((item) =>
      item.bot_name === botName && (item.controller_id || item.controller_name) === configId,
    );
    if (controller?.custom_info && runtimeConfigMatches(pendingApply.values, controller.custom_info)) {
      setPendingApply(null);
      onClose();
    }
  }, [open, pendingApply, appliedQuery.data, appliedQuery.isError, botName, configId, onClose]);
  useEffect(() => {
    if (!pendingApply) return;
    const timer = window.setTimeout(() => {
      setPendingApply(null);
      setSavedMessage("配置已保存，但 75 秒内未确认 Bot 已应用。请检查运行日志；请勿重复提交。");
    }, Math.max(0, 75_000 - (Date.now() - pendingApply.started)));
    return () => window.clearTimeout(timer);
  }, [pendingApply]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("未找到这个 Bot 的独立配置");
      const payload: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(edits)) {
        payload[key] = parseConfigValue(key, raw, inferInputType(config[key]));
      }
      // 真实交易的确认由页面内“保存并应用”操作承担，不使用浏览器原生确认窗口。
      if (config.live_trading === false && payload.live_trading === true) payload._confirm_live_trading = true;
      await api.updateBotControllerConfig(server, botName, configId, payload);
      return payload;
    },
    onSuccess: async (payload) => {
      setEdits({});
      setSavedMessage("已保存，正在等待 Bot 确认应用；确认后自动关闭…");
      setPendingApply({ values: payload, started: Date.now() });
      await queryClient.invalidateQueries({ queryKey: ["bot-controller-configs", server, botName] });
      await queryClient.invalidateQueries({ queryKey: ["bots", server] });
    },
  });
  const validationFeedback = useMemo(
    () => mutation.error ? describeRuntimeConfigError(mutation.error) : null,
    [mutation.error],
  );

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0"><div className="flex items-center gap-2 text-base font-semibold"><Settings className="h-4 w-4" />调整运行参数</div><div className="mt-1 truncate text-xs text-[var(--color-text-muted)]" title={configDisplayInfo(configId).tooltip}>{botDisplayName?.trim() || botName} · {configDisplayInfo(configId).name}</div></div>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--color-surface-hover)]" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {savedMessage && <p className="mb-3 rounded-md border border-[var(--color-green)]/30 bg-[var(--color-green)]/10 px-3 py-2 text-sm text-[var(--color-green)]">{savedMessage}</p>}
          {validationFeedback && <p className="mb-3 rounded-md border border-[var(--color-red)]/30 bg-[var(--color-red)]/10 px-3 py-2 text-sm text-[var(--color-red)]">保存失败：{validationFeedback.message}</p>}
          {configQuery.isLoading ? <div className="text-sm text-[var(--color-text-muted)]">正在读取这个 Bot 的独立配置…</div>
            : configQuery.error ? <div className="text-sm text-[var(--color-red)]">{configQuery.error instanceof Error ? configQuery.error.message : "读取失败"}</div>
              : !config ? <div className="text-sm text-[var(--color-red)]">未找到配置“{configDisplayInfo(configId).name}”</div>
                : <div className="grid gap-4">{[
                  { title: "买入设置", keys: fields.filter((key) => key.startsWith("buy_")) },
                  { title: "卖出设置", keys: fields.filter((key) => key.startsWith("sell_")) },
                  { title: "通用设置", keys: fields.filter((key) => !key.startsWith("buy_") && !key.startsWith("sell_")) },
                ].map((section) => <fieldset key={section.title} disabled={pendingApply !== null || mutation.isPending} className="min-w-0 grid gap-2 rounded-lg border border-[var(--color-border)] p-3">
                  <legend className="px-2 text-sm font-semibold">{section.title}</legend>
                  {section.keys.map((key) => {
                  const original = config[key]; const type = inferInputType(original);
                  const edited = key in edits; const value = edited ? edits[key] : key === "sell_price_max_usd" && (original === null || Number(original) === 0) ? "" : String(original ?? "");
                  const applicable = isFieldApplicable(key, { ...config, ...edits });
                  const info = MICRODUCK_FIELD_INFO[key];
                  const label = info?.label ?? FIELD_LABELS[key] ?? key;
                  const unit = FIELD_UNITS[key];
                  const hasValidationError = validationFeedback?.fields.includes(key) ?? false;
                  const inputBorder = hasValidationError ? "border-[var(--color-red)]" : edited ? "border-[var(--color-warning)]" : "border-[var(--color-border)]";
                  return <div key={key} className="grid grid-cols-[minmax(120px,1fr)_2fr] items-start gap-2">
                    <div className="flex items-center gap-1 pt-2 text-xs text-[var(--color-text-muted)]"><label htmlFor={`runtime-${key}`}>{label}</label>
                      {info && <span className="group relative inline-flex shrink-0"><CircleHelp className="h-3 w-3" /><span className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-xs leading-5 shadow-lg group-hover:block">{info.description}<span className="block text-[10px]">原字段名：{key}</span></span></span>}
                    </div>
                    {!applicable ? <input id={`runtime-${key}`} disabled value="不适用" className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)] opacity-60 cursor-not-allowed" />
                      : ["buy_size_mode", "buy_trailing_rebound_mode", "sell_trailing_drop_mode"].includes(key) ? <select id={`runtime-${key}`} value={value} onChange={(event) => setEdits((previous) => ({ ...previous, [key]: event.target.value }))} className={`w-full rounded-md border bg-[var(--color-surface)] px-3 py-2 text-xs outline-none focus:border-[var(--color-primary)] ${inputBorder}`}>{(key === "buy_size_mode" ? [["budget", "按预算"], ["quantity", "按数量"]] : [["percentage", "按百分比"], ["fixed", "按固定金额"]]).map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select>
                      : type === "boolean" ? <button type="button" onClick={() => setEdits((previous) => ({ ...previous, [key]: String(value !== "true") }))} className={`flex w-full items-center gap-2 rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm ${inputBorder}`}><span className={`flex h-4 w-4 items-center justify-center rounded border ${value === "true" ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--color-border)]"}`}>{value === "true" && <Check className="h-3 w-3 text-white" />}</span>{value === "true" ? "已开启" : "已关闭"}</button>
                      : <div className="relative w-full"><input type={type === "number" ? "number" : "text"} step={type === "number" ? "any" : undefined} value={value} placeholder={key === "sell_price_max_usd" ? "不设置（按利润倍数）" : undefined} onChange={(event) => setEdits((previous) => ({ ...previous, [key]: event.target.value }))} className={`w-full rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] ${unit ? "pr-28" : ""} ${inputBorder}`} />{unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-[var(--color-text-muted)]">{unit}</span>}</div>}
                  </div>;
                })}</fieldset>)}</div>}
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">钱包、交易对象和控制器类型不能在运行中修改。正在提交买入或卖出时，交易参数会临时锁定。</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-4"><button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-[var(--color-text-muted)]">关闭</button><button disabled={!config || Object.keys(edits).length === 0 || mutation.isPending} onClick={() => mutation.mutate()} className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{mutation.isPending ? "正在保存…" : "保存并应用"}</button></div>
      </div>
    </div>
  );
}
