import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, rectSortingStrategy, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  GripVertical,
  Pause,
  Play,
  RefreshCw,
  ReceiptText,
  RotateCw,
  Pencil,
  Settings,
  Square,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentProps } from "react";

import { NoServerCard } from "@/components/NoServerCard";
import { AggregatedPnlChart } from "@/components/bots/AggregatedPnlChart";
import { BuyTrackingChart } from "@/components/bots/BuyTrackingChart";
import { ControllerBrowser } from "@/components/bots/ControllerBrowser";
import { ControllerTradingActivity } from "@/components/bots/ControllerTradingActivity";
import { PnlSparkline } from "@/components/bots/PnlSparkline";
import { RuntimeConfigDialog } from "@/components/bots/RuntimeConfigDialog";
import { WalletLedgerDialog } from "@/components/bots/WalletLedgerDialog";
import { FallbackSpinner } from "@/components/ui/FallbackSpinner";

import { useRates } from "@/hooks/useRates";
import { useServer } from "@/hooks/useServer";
import { useCondorWebSocket } from "@/hooks/useWebSocket";
import {
  api,
  type BotLogEntry,
  type BotSummary,
  type BotsPageResponse,
  type ControllerInfo,
  type ControllerPerformanceSnapshot,
  type ControllerConfigSummary,
  type GatewayWalletBalancesResponse,
  type GatewayWalletAllowancesResponse,
} from "@/lib/api";
import { formatCurrencyVolume, pnlColor } from "@/lib/formatters";
import { controllerStrategySummary } from "@/lib/controller-strategy-summary";
import { latestPositionPrice } from "@/lib/latest-position-price";
import { configDisplayInfo } from "@/lib/config-display";

function formatUptime(deployedAt: string | null): string {
  if (!deployedAt) return "—";
  try {
    const deployed = new Date(deployedAt);
    const now = new Date();
    const diffMs = now.getTime() - deployed.getTime();
    if (diffMs < 0) return "—";
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    if (days > 0) return `${days}d ${hours}h`;
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  } catch {
    return "—";
  }
}

type SortableHandleBindings = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef">;

const SortableHandleContext = createContext<SortableHandleBindings | null>(null);

function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const sortable = useSortable({ id });
  const { setNodeRef, transform, transition, isDragging } = sortable;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined, zIndex: isDragging ? 20 : undefined }}
      className="relative"
    >
      <SortableHandleContext.Provider value={sortable}>{children}</SortableHandleContext.Provider>
    </div>
  );
}

function SortableHandle({ children, ...props }: ComponentProps<"span">) {
  const bindings = useContext(SortableHandleContext);
  return (
    <span
      ref={bindings?.setActivatorNodeRef}
      {...bindings?.attributes}
      {...bindings?.listeners}
      {...props}
    >
      {children}
    </span>
  );
}


const WALLET_BALANCE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const WALLET_BALANCE_REFRESH_INTERVAL = 5 * 60 * 1000;

interface WalletBalanceCacheEntry {
  data: GatewayWalletBalancesResponse;
  savedAt: number;
}

function walletBalanceCacheKey(server: string): string {
  return `condor:wallet-balances:${server}:ethereum:robinhoodchain:MICRODUCK,ETH,USDG`;
}

function readWalletBalanceCache(server: string | null): WalletBalanceCacheEntry | undefined {
  if (!server) return undefined;
  try {
    const cached = JSON.parse(localStorage.getItem(walletBalanceCacheKey(server)) || "null");
    const savedAt = Number(cached?.savedAt);
    if (!cached || !Number.isFinite(savedAt) || Date.now() - savedAt > WALLET_BALANCE_CACHE_MAX_AGE) {
      return undefined;
    }
    return Array.isArray(cached.data?.wallets) ? { data: cached.data, savedAt } : undefined;
  } catch {
    return undefined;
  }
}

interface WalletAllowanceCacheEntry {
  data: GatewayWalletAllowancesResponse;
  savedAt: number;
}

function walletAllowanceCacheKey(server: string, address: string): string {
  return `condor:wallet-allowance:${server}:ethereum:robinhoodchain:${address.toLowerCase()}:uniswap/router:USDG`;
}

function readWalletAllowanceCache(server: string | null, address: string): WalletAllowanceCacheEntry | undefined {
  if (!server) return undefined;
  try {
    const cached = JSON.parse(localStorage.getItem(walletAllowanceCacheKey(server, address)) || "null");
    const savedAt = Number(cached?.savedAt);
    const amount = Number(cached?.data?.approvals?.USDG);
    if (!cached || !Number.isFinite(savedAt) || Date.now() - savedAt > WALLET_BALANCE_CACHE_MAX_AGE || !Number.isFinite(amount)) {
      return undefined;
    }
    return { data: cached.data, savedAt };
  } catch {
    return undefined;
  }
}

// ── Sort types ──

type SortKey =
  | "controller_name"
  | "connector"
  | "trading_pair"
  | "realized_pnl_quote"
  | "unrealized_pnl_quote"
  | "global_pnl_quote"
  | "volume_traded"
  | "deployed_at"
  | "status";

type SortDir = "asc" | "desc";

function compareControllers(a: ControllerInfo, b: ControllerInfo, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case "controller_name":
    case "connector":
    case "trading_pair":
    case "status":
      cmp = (a[key] || "").localeCompare(b[key] || "");
      break;
    case "realized_pnl_quote":
    case "unrealized_pnl_quote":
    case "global_pnl_quote":
    case "volume_traded":
      cmp = a[key] - b[key];
      break;
    case "deployed_at": {
      const aTime = a.deployed_at ? new Date(a.deployed_at).getTime() : 0;
      const bTime = b.deployed_at ? new Date(b.deployed_at).getTime() : 0;
      cmp = aTime - bTime;
      break;
    }
  }
  return dir === "asc" ? cmp : -cmp;
}

// ── Stat Card ──

function StatCard({
  label,
  value,
  valueColor,
  singleLine = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueColor?: string;
  singleLine?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="mb-3">
        <span className="text-base font-semibold text-[var(--color-text)]">
          {label}
        </span>
      </div>
      <p
        className={`${singleLine ? "whitespace-nowrap text-xs" : "break-words text-sm"} font-bold leading-snug tabular-nums text-[var(--color-text-muted)]`}
        style={valueColor ? { color: valueColor } : {}}
      >
        {value}
      </p>
    </div>
  );
}

// ── Status Dot ──

function StatusDot({ status }: { status: string }) {
  const isStopping = status === "stopping";
  const color =
    status === "running"
      ? "text-[var(--color-green)]"
      : status === "stopped" || status === "error"
        ? "text-[var(--color-red)]"
        : "text-[var(--color-yellow)]";
  return isStopping ? (
    <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-[var(--color-yellow)] border-t-transparent" />
  ) : (
    <Circle className={`h-2 w-2 fill-current ${color}`} />
  );
}

// ── Sortable Header ──

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right" | "center";
}) {
  const active = currentKey === sortKey;
  const alignCls =
    align === "right" ? "text-right justify-end" : align === "center" ? "text-center justify-center" : "text-left";

  return (
    <th
      className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] cursor-pointer select-none hover:text-[var(--color-text)] transition-colors ${alignCls}`}
      onClick={() => onSort(sortKey)}
    >
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : ""}`}>
        {label}
        {active ? (
          currentDir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <span className="w-3" />
        )}
      </div>
    </th>
  );
}

function formatLogTime(ts?: number): string {
  if (!ts) return "";
  try {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function LogsSection({ logs }: { logs: BotLogEntry[] }) {
  const [filter, setFilter] = useState<"all" | "error" | "general">("all");
  const filtered = filter === "all" ? logs : logs.filter((l) => l.log_category === filter);

  if (logs.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)] py-2">No logs available</p>
    );
  }

  const errorCount = logs.filter((l) => l.log_category === "error").length;
  const generalCount = logs.filter((l) => l.log_category === "general").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {(["all", "general", "error"] as const).map((f) => {
          const count = f === "all" ? logs.length : f === "error" ? errorCount : generalCount;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                filter === f
                  ? f === "error"
                    ? "bg-[var(--color-red)]/15 text-[var(--color-red)]"
                    : "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {f} ({count})
            </button>
          );
        })}
      </div>
      <div className="max-h-[300px] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-[11px] leading-relaxed">
        {filtered.map((log, i) => (
          <div
            key={i}
            className={`flex gap-2 px-2.5 py-1 border-b border-[var(--color-border)]/20 last:border-b-0 ${
              log.log_category === "error" ? "bg-[var(--color-red)]/5" : ""
            }`}
          >
            <span className="text-[var(--color-text-muted)] shrink-0 tabular-nums">
              {formatLogTime(log.timestamp)}
            </span>
            <span
              className={`break-all ${
                log.log_category === "error" ? "text-[var(--color-red)]" : "text-[var(--color-text)]"
              }`}
            >
              {log.msg || JSON.stringify(log)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Controller Row with actions ──

function ControllerRow({
  ctrl,
  server,
  isSelected,
  onSelect,
  formatPnlValue,
  formatValue,
  sparklineValues,
  isBotStopping,
}: {
  ctrl: ControllerInfo;
  server: string;
  isSelected: boolean;
  onSelect: () => void;
  formatPnlValue: (val: number, quote: string) => string;
  formatValue: (val: number, quote: string) => string;
  sparklineValues?: number[];
  isBotStopping?: boolean;
}) {
  const queryClient = useQueryClient();
  const isKilled = ctrl.config?.manual_kill_switch === true;
  const isStopping = ctrl.status === "stopping" || (isBotStopping && !isKilled);

  const toggleMutation = useMutation({
    mutationFn: () =>
      isKilled
        ? api.startControllers(server, ctrl.bot_name, [ctrl.controller_id])
        : api.stopControllers(server, ctrl.bot_name, [ctrl.controller_id]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots", server] });
    },
  });

  return (
    <tr
      className={`border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-hover)]/50 cursor-pointer transition-colors ${isSelected ? "bg-[var(--color-surface-hover)]/70" : ""}`}
      onClick={onSelect}
    >
      <td className="px-4 py-2.5">
        <div className="flex flex-col">
          <span className="text-sm font-medium" title={ctrl.controller_name}>MICRODUCK 跟踪策略</span>
          {ctrl.controller_id && ctrl.controller_id !== ctrl.controller_name && (
            <span className="text-xs text-[var(--color-text-muted)] truncate" title={configDisplayInfo(ctrl.controller_id).tooltip}>
              {configDisplayInfo(ctrl.controller_id).name}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-[var(--color-text-muted)]">
        {ctrl.connector || "—"}
      </td>
      <td className="px-4 py-2.5 text-sm">{ctrl.trading_pair || "—"}</td>
      {(() => {
        const quote = ctrl.trading_pair?.split("-")[1] || "USDT";
        return (
          <>
            <td
              className="px-4 py-2.5 text-sm text-right tabular-nums font-medium"
              style={{ color: pnlColor(ctrl.realized_pnl_quote) }}
            >
              {formatPnlValue(ctrl.realized_pnl_quote, quote)}
            </td>
            <td
              className="px-4 py-2.5 text-sm text-right tabular-nums font-medium"
              style={{ color: pnlColor(ctrl.unrealized_pnl_quote) }}
            >
              {formatPnlValue(ctrl.unrealized_pnl_quote, quote)}
            </td>
            <td
              className="px-4 py-2.5 text-sm text-right tabular-nums font-medium"
              style={{ color: pnlColor(ctrl.global_pnl_quote) }}
            >
              {formatPnlValue(ctrl.global_pnl_quote, quote)}
            </td>
            <td className="px-2 py-2.5">
              <div className="flex justify-center">
                {sparklineValues && sparklineValues.length >= 2 ? (
                  <PnlSparkline values={sparklineValues} />
                ) : (
                  <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                )}
              </div>
            </td>
            <td className="px-4 py-2.5 text-sm text-right tabular-nums text-[var(--color-text-muted)]">
              {formatValue(ctrl.volume_traded, quote)}
            </td>
          </>
        );
      })()}
      <td className="px-4 py-2.5 text-sm text-right tabular-nums text-[var(--color-text-muted)]">
        {formatUptime(ctrl.deployed_at)}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5 justify-center">
          <StatusDot status={isKilled ? "stopped" : isStopping ? "stopping" : ctrl.status} />
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending || isStopping}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              isStopping
                ? "text-[var(--color-yellow)]"
                : isKilled
                  ? "text-[var(--color-green)] hover:bg-[var(--color-green)]/10"
                  : "text-[var(--color-yellow)] hover:bg-[var(--color-yellow)]/10"
            }`}
            title={
              toggleMutation.isError
                ? `Failed to ${isKilled ? "start" : "pause"}: ${toggleMutation.error instanceof Error ? toggleMutation.error.message : "Unknown error"}`
                : isStopping
                  ? "Stopping..."
                  : isKilled
                    ? "Start controller"
                    : "Pause controller"
            }
          >
            {toggleMutation.isPending || isStopping ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : isKilled ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
          </button>
          {toggleMutation.isError && (
            <span
              className="text-[10px] text-[var(--color-red)] whitespace-nowrap"
              title={toggleMutation.error instanceof Error ? toggleMutation.error.message : "Unknown error"}
            >
              Failed to {isKilled ? "start" : "pause"}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Bots Collapsible Section ──

function BotRow({ bot, server, onStopInitiated, onStopSettled }: { bot: BotSummary; server: string; onStopInitiated?: (botName: string) => void; onStopSettled?: (botName: string) => void }) {
  const [showLogs, setShowLogs] = useState(false);
  const [pendingAction, setPendingAction] = useState<"remove" | null>(null);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState(bot.display_name || "");
  const queryClient = useQueryClient();
  const isStopping = bot.status === "stopping";
  const displayedBotName = bot.display_name?.trim() || bot.bot_name;

  useEffect(() => {
    setAliasInput(bot.display_name || "");
  }, [bot.display_name]);

  const aliasMutation = useMutation({
    mutationFn: () => api.updateBotDisplayName(server, bot.bot_name, aliasInput.trim() || null),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["bots", server], type: "active" });
      setEditingAlias(false);
    },
  });

  const restartMutation = useMutation({
    mutationFn: () => api.restartBot(server, bot.bot_name),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["bots", server], type: "active" });
      setPendingAction(null);
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => {
      onStopInitiated?.(bot.bot_name);
      return api.stopBot(server, bot.bot_name);
    },
    onSuccess: async () => {
      // Stop 已完成：立即从页面缓存移除旧机器人，再读取服务端最新状态确认。
      queryClient.setQueryData<BotsPageResponse>(["bots", server], (old) =>
        old
          ? {
              ...old,
              bots: old.bots.filter((item) => item.bot_name !== bot.bot_name),
              controllers: old.controllers.filter((item) => item.bot_name !== bot.bot_name),
            }
          : old,
      );
      await queryClient.refetchQueries({ queryKey: ["bots", server], type: "active" });
      setPendingAction(null);
    },
    onSettled: () => {
      onStopSettled?.(bot.bot_name);
    },
  });

  const allLogs: BotLogEntry[] = useMemo(() => {
    return [
      ...(bot.error_logs || []).map((l) => ({ ...l, log_category: "error" as const })),
      ...(bot.general_logs || []).map((l) => ({ ...l, log_category: "general" as const })),
    ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [bot.error_logs, bot.general_logs]);

  return (
    <div>
      <div
        className="flex items-center gap-4 px-4 py-2.5 text-sm cursor-pointer hover:bg-[var(--color-surface-hover)]/50 transition-colors"
        onClick={() => setShowLogs(!showLogs)}
      >
        <div className="p-0.5">
          {showLogs ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          )}
        </div>
        <StatusDot status={bot.status} />
        {editingAlias ? (
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); aliasMutation.mutate(); }}>
            <input autoFocus maxLength={80} value={aliasInput} onChange={(e) => setAliasInput(e.target.value)} onClick={(e) => e.stopPropagation()} className="w-44 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs" placeholder="留空清除别名" />
            <button type="submit" disabled={aliasMutation.isPending} className="rounded px-1.5 py-1 text-xs text-[var(--color-primary)]">保存</button>
            <button type="button" onClick={() => { setAliasInput(bot.display_name || ""); setEditingAlias(false); }} className="rounded px-1.5 py-1 text-xs text-[var(--color-text-muted)]">取消</button>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="font-medium truncate max-w-[250px]" title={bot.bot_name}>{displayedBotName}</span>
            <button onClick={() => setEditingAlias(true)} className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="修改 Bot 别名"><Pencil className="h-3 w-3" /></button>
          </div>
        )}
        <span className="text-[var(--color-text-muted)]">
          {bot.num_controllers} controller{bot.num_controllers !== 1 ? "s" : ""}
        </span>
        {bot.error_count > 0 && (
          <span className="text-[var(--color-yellow)] text-xs">
            {bot.error_count} error{bot.error_count !== 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-[var(--color-text-muted)] tabular-nums">
          {formatUptime(bot.deployed_at)}
        </span>
        {isStopping ? (
            <div className="flex items-center gap-1.5 text-[var(--color-yellow)]" onClick={(e) => e.stopPropagation()}>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span className="text-xs font-medium">Stopping</span>
            </div>
          ) : pendingAction ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending || restartMutation.isPending}
                className={`rounded px-2 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 ${pendingAction === "remove" ? "bg-[var(--color-red)]" : "bg-[var(--color-primary)]"}`}
              >
                {stopMutation.isPending ? "正在移除…" : "确认移除"}
              </button>
              <button
                onClick={() => setPendingAction(null)}
                className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                取消
              </button>
              <span className="text-xs text-[var(--color-text-muted)]">容器将被删除，运行记录会归档</span>
            </div>
          ) : (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => restartMutation.mutate()}
                disabled={restartMutation.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors disabled:opacity-50"
                title="重启 Bot 容器"
              >
                <RotateCw className={`h-3 w-3 ${restartMutation.isPending ? "animate-spin" : ""}`} />
                {restartMutation.isPending ? "正在重启…" : "重启"}
              </button>
              <button
                onClick={() => setPendingAction("remove")}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-red)] hover:bg-[var(--color-red)]/10 transition-colors"
                title="移除 Bot 容器并归档运行记录"
              >
                <Square className="h-3 w-3" />移除
              </button>
            </div>
          )}
      </div>
      {showLogs && (
        <div className="px-4 pb-3 pt-1">
          <LogsSection logs={allLogs} />
        </div>
      )}
      {stopMutation.isError && (
        <div className="px-4 py-2 text-xs text-[var(--color-red)]">
          移除 Bot 失败：{stopMutation.error instanceof Error ? stopMutation.error.message : "未知错误"}
        </div>
      )}
      {restartMutation.isError && (
        <div className="px-4 py-2 text-xs text-[var(--color-red)]">
          重启 Bot 失败：{restartMutation.error instanceof Error ? restartMutation.error.message : "未知错误"}
        </div>
      )}
      {aliasMutation.isError && (
        <div className="px-4 py-2 text-xs text-[var(--color-red)]">保存别名失败：{aliasMutation.error instanceof Error ? aliasMutation.error.message : "未知错误"}</div>
      )}
    </div>
  );
}

function BotsSection({ bots, server, onStopInitiated, onStopSettled }: { bots: BotSummary[]; server: string; onStopInitiated?: (botName: string) => void; onStopSettled?: (botName: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Chevron className="h-4 w-4 text-[var(--color-text-muted)]" />
        <span className="font-medium">Bots</span>
        <span className="text-sm text-[var(--color-text-muted)]">({bots.length})</span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]/30">
          {bots.map((bot) => (
            <BotRow key={bot.bot_name} bot={bot} server={server} onStopInitiated={onStopInitiated} onStopSettled={onStopSettled} />
          ))}
        </div>
      )}
    </div>
  );
}

function BotStatusNameEditor({
  server,
  botName,
  displayName,
}: {
  server: string;
  botName: string;
  displayName?: string | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName || "");
  const shownName = displayName?.trim() || botName;
  const mutation = useMutation({
    mutationFn: () => api.updateBotDisplayName(server, botName, value.trim() || null),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["bots", server], type: "active" });
      setEditing(false);
    },
  });

  useEffect(() => setValue(displayName || ""), [displayName]);

  if (editing) {
    return (
      <form className="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
        <input
          autoFocus
          maxLength={80}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-44 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
          placeholder="留空清除别名"
        />
        <button type="submit" disabled={mutation.isPending} className="rounded px-1.5 py-1 text-xs text-[var(--color-primary)]">保存</button>
        <button type="button" onClick={() => { setValue(displayName || ""); setEditing(false); }} className="rounded px-1.5 py-1 text-xs text-[var(--color-text-muted)]">取消</button>
      </form>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm font-semibold text-[var(--color-text)]" title={botName}>{shownName}</span>
      {displayName && <span className="truncate text-xs text-[var(--color-text-muted)]" title={botName}>{botName}</span>}
      <button type="button" onClick={() => setEditing(true)} className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="修改 Bot 别名"><Pencil className="h-3 w-3" /></button>
      {mutation.isError && <span className="text-xs text-[var(--color-red)]">保存失败</span>}
    </div>
  );
}

function UsdgAllowanceEditor({
  server,
  walletAddress,
  currentAllowance,
  suggestedAmount,
  ethUsdPrice,
  botName,
  controllerId,
}: {
  server: string;
  walletAddress: string;
  currentAllowance: number | null;
  suggestedAmount: number | null;
  ethUsdPrice: number | null;
  botName?: string;
  controllerId?: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const validAmount = Number(amount);
  const previewMutation = useMutation({
    mutationFn: () => api.previewWalletTokenApproval(
      server,
      "ethereum",
      "robinhoodchain",
      walletAddress,
      "uniswap/router",
      "USDG",
      amount,
    ),
  });
  const mutation = useMutation({
    mutationFn: () => api.approveWalletToken(
      server,
      "ethereum",
      "robinhoodchain",
      walletAddress,
      "uniswap/router",
      "USDG",
      amount,
      botName,
      controllerId,
    ),
    onSuccess: async () => {
      // 授权额度只随余额的实际刷新读取。刚完成授权时主动刷新一次余额，
      // 既立刻显示链上新额度，也不让普通页面刷新额外触发授权查询。
      await queryClient.refetchQueries({
        queryKey: ["gateway-wallet-balances", server, "ethereum", "robinhoodchain", "MICRODUCK,ETH,USDG"],
        type: "active",
      });
      await queryClient.refetchQueries({
        queryKey: ["gateway-wallet-allowance", server, "ethereum", "robinhoodchain", walletAddress.toLowerCase()],
        type: "active",
      });
      setEditing(false);
      setAmount("");
      setConfirming(false);
    },
  });

  const beginEditing = () => {
    setAmount(suggestedAmount !== null ? suggestedAmount.toFixed(6) : "");
    previewMutation.reset();
    mutation.reset();
    setConfirming(false);
    setEditing(true);
  };

  if (editing) {
    return (
      <form
        className="mt-1.5 space-y-1"
        onSubmit={(event) => {
          event.preventDefault();
          const preview = previewMutation.data;
          if (!Number.isFinite(validAmount) || validAmount <= 0 || !preview || preview.amount !== validAmount || preview.action_count <= 0) return;
          setConfirming(true);
        }}
      >
        <input
          autoFocus
          type="number"
          min="0.000001"
          step="0.000001"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            previewMutation.reset();
            mutation.reset();
          }}
          className="w-28 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs tabular-nums"
          aria-label="USDG 授权额度"
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending || !Number.isFinite(validAmount) || validAmount <= 0}
            className="rounded px-1.5 py-1 text-xs font-medium text-[var(--color-primary)] disabled:opacity-50"
          >
            {previewMutation.isPending ? "正在预估" : "预估 Gas"}
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || !previewMutation.data || previewMutation.data.amount !== validAmount || previewMutation.data.action_count <= 0}
            className="rounded px-1.5 py-1 text-xs font-medium text-[var(--color-primary)] disabled:opacity-50"
          >
            {mutation.isPending ? "提交中" : "确认授权"}
          </button>
          <button type="button" onClick={() => { setConfirming(false); setEditing(false); }} className="rounded px-1.5 py-1 text-xs text-[var(--color-text-muted)]">取消</button>
        </div>
        {previewMutation.data && <div className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
          {previewMutation.data.message}<br />
          {previewMutation.data.action_count > 0
            ? <>预估 Gas：约 {previewMutation.data.estimated_gas_eth.toFixed(8)} ETH（约 {ethUsdPrice === null ? "美元暂未获取" : `$${(previewMutation.data.estimated_gas_eth * ethUsdPrice).toFixed(6)}`}，{previewMutation.data.action_count} 笔）</>
            : <>预估 Gas：0 ETH</>}
        </div>}
        {confirming && previewMutation.data && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => { if (!mutation.isPending) setConfirming(false); }}
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="approval-confirmation-title"
              className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id="approval-confirmation-title" className="text-base font-semibold text-[var(--color-text)]">确认 USDG 授权</h3>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                将授权 <span className="font-semibold text-[var(--color-text)]">{validAmount.toFixed(6)} USDG</span>。预计需要 {previewMutation.data.action_count} 笔链上交易，Gas 约 <span className="font-semibold text-[var(--color-text)]">{previewMutation.data.estimated_gas_eth.toFixed(8)} ETH</span>{ethUsdPrice === null ? "" : `（约 $${(previewMutation.data.estimated_gas_eth * ethUsdPrice).toFixed(6)}）`}。
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">实际费用以链上确认结果为准。</p>
              {mutation.isError && (
                <div className="mt-3 rounded-md border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-red)]">
                  授权提交失败：{mutation.error instanceof Error ? mutation.error.message : "请检查网络、ETH Gas 余额和钱包授权状态后重试。"}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={mutation.isPending} className="rounded-md px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-background)] disabled:opacity-50">取消</button>
                <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{mutation.isPending ? "提交中" : "确认授权"}</button>
              </div>
            </section>
          </div>
        )}
        {previewMutation.isError && <div className="text-xs text-[var(--color-red)]">{previewMutation.error instanceof Error ? previewMutation.error.message : "Gas 预估失败"}</div>}
        {mutation.isError && <div className="text-xs text-[var(--color-red)]">{mutation.error instanceof Error ? mutation.error.message : "授权提交失败"}</div>}
      </form>
    );
  }

  return (
    <>
      <button type="button" onClick={beginEditing} className="mt-1 rounded px-1.5 py-0.5 text-xs text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)]">
        设置授权
      </button>
      {currentAllowance === null && <div className="mt-1 text-xs text-[var(--color-text-muted)]">链上额度暂未获取</div>}
    </>
  );
}

function ImportExternalPositionDialog({
  open,
  server,
  onClose,
}: {
  open: boolean;
  server: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [configId, setConfigId] = useState("");
  const [positionBase, setPositionBase] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const { data } = useQuery({
    queryKey: ["controller-configs", server],
    queryFn: () => api.getAvailableConfigs(server),
    enabled: open,
  });
  const configs = (data?.configs ?? []).filter(
    (config: ControllerConfigSummary) => config.controller_name === "microduck_profit_trailing",
  );
  const existingPosition = useQuery({
    queryKey: ["external-position", server, configId],
    queryFn: () => api.getExternalPosition(server, configId),
    enabled: open && Boolean(configId),
    retry: false,
  });
  useEffect(() => {
    if (!configId) {
      setPositionBase("");
      setEntryPrice("");
      setTransactionHash("");
      return;
    }
    if (existingPosition.data?.imported) {
      setPositionBase(existingPosition.data.position_base ?? "");
      setEntryPrice(existingPosition.data.entry_unit_price_usd ?? "");
      setTransactionHash(existingPosition.data.transaction_hash ?? "");
    }
  }, [configId, existingPosition.data]);
  const mutation = useMutation({
    mutationFn: () => api.importExternalPosition(server, configId, {
      position_base: positionBase,
      entry_unit_price_usd: entryPrice,
      transaction_hash: transactionHash || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots", server] });
      queryClient.invalidateQueries({ queryKey: ["external-position", server, configId] });
    },
  });

  if (!open) return null;
  const canSubmit = Boolean(configId && Number(positionBase) > 0 && Number(entryPrice) > 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="font-semibold">导入外部持仓</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">导入后请 Deploy 这个配置，机器人将从等待卖出开始。</p>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">×</button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm">配置文件
            <select value={configId} title={configId ? configDisplayInfo(configId).tooltip : undefined} onChange={(event) => {
              setConfigId(event.target.value);
              setPositionBase("");
              setEntryPrice("");
              setTransactionHash("");
              mutation.reset();
            }} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <option value="">选择一个 MICRODUCK 配置</option>
              {configs.map((config: ControllerConfigSummary) => (
                <option key={config.id} value={config.id} title={configDisplayInfo(config.id).tooltip}>
                  {configDisplayInfo(config.id).name}
                </option>
              ))}
            </select>
          </label>
          {configId && (
            <div className="rounded-md bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]" title={configDisplayInfo(configId).tooltip}>
              {configDisplayInfo(configId).description}
            </div>
          )}
          <label className="block text-sm">交给机器人管理的 MICRODUCK 数量
            <input value={positionBase} onChange={(event) => setPositionBase(event.target.value)} type="number" min="0" step="any" className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2" />
          </label>
          <label className="block text-sm">实际买入单价（美元）
            <input value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} type="number" min="0" step="any" className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2" />
          </label>
          <label className="block text-sm">交易哈希（可选）
            <input value={transactionHash} onChange={(event) => setTransactionHash(event.target.value)} placeholder="0x..." className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs" />
          </label>
          <div className="rounded-md bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {existingPosition.data?.imported
              ? "已回填这份配置的导入持仓。修改后会重新检查链上余额和其他配置的占用量。"
              : "系统会检查链上余额以及其他配置已经占用的数量。一个配置只能管理一笔持仓。"}
          </div>
          {existingPosition.isLoading && <p className="text-sm text-[var(--color-text-muted)]">正在读取已导入的持仓…</p>}
          {existingPosition.error && <p className="text-sm text-[var(--color-red)]">{existingPosition.error instanceof Error ? existingPosition.error.message : "读取已导入持仓失败"}</p>}
          {mutation.error && <p className="text-sm text-[var(--color-red)]">{mutation.error instanceof Error ? mutation.error.message : "导入失败"}</p>}
          {mutation.data?.imported && <p className="text-sm text-[var(--color-green)]">{mutation.data.updated ? "持仓已更新。现在可以使用这个配置 Deploy。" : "导入成功。现在可以使用这个配置 Deploy。"}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-4">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-[var(--color-text-muted)]">关闭</button>
          <button disabled={!canSubmit || mutation.isPending || existingPosition.isLoading || Boolean(existingPosition.error)} onClick={() => mutation.mutate()} className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {mutation.isPending ? "正在校验…" : existingPosition.data?.imported ? "校验并更新" : "校验并导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

const BOTS_WS_CHANNELS = ["bots", "controller_perf"];

export function ActiveBotsTab({
  showImportPosition = false,
  onImportPositionClose,
}: {
  showImportPosition?: boolean;
  onImportPositionClose?: () => void;
}) {
  const { server } = useServer();
  const [sortKey, setSortKey] = useState<SortKey>("global_pnl_quote");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [runtimeConfigTarget, setRuntimeConfigTarget] = useState<{ botName: string; botDisplayName?: string | null; configId: string } | null>(null);
  const [walletLedgerTarget, setWalletLedgerTarget] = useState<{
    address: string;
    ethUsdPrice: number | null;
    botName?: string;
    botDisplayName?: string | null;
    controllerId?: string;
  } | null>(null);
  const [pendingStopBots, setPendingStopBots] = useState<Set<string>>(new Set());
  const [pageNow, setPageNow] = useState(() => Date.now());
  const [latestPriceReceivedAt, setLatestPriceReceivedAt] = useState<number | null>(null);
  const [walletAliases, setWalletAliases] = useState<Record<string, string>>(() => {
    try { return JSON.parse(window.localStorage.getItem("microduck.walletAliases") || "{}"); } catch { return {}; }
  });
  const [editingWalletAlias, setEditingWalletAlias] = useState<string | null>(null);
  const [walletAliasInput, setWalletAliasInput] = useState("");
  const [botCardOrder, setBotCardOrder] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("microduck.botCardOrder") || "[]"); } catch { return []; }
  });
  const [walletCardOrder, setWalletCardOrder] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("microduck.walletCardOrder") || "[]"); } catch { return []; }
  });
  // 移动超过 8px 才进入拖动，普通点击不会被拖动行为拦截。
  const sortableSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const saveWalletAlias = useCallback((address: string) => {
    const key = address.toLowerCase();
    setWalletAliases((previous) => {
      const updated = { ...previous };
      const alias = walletAliasInput.trim();
      if (alias) updated[key] = alias.slice(0, 80); else delete updated[key];
      window.localStorage.setItem("microduck.walletAliases", JSON.stringify(updated));
      return updated;
    });
    setEditingWalletAlias(null);
  }, [walletAliasInput]);
  const handleSortEnd = useCallback((kind: "bot" | "wallet", event: DragEndEvent, allKeys: string[]) => {
    if (!event.over || event.active.id === event.over.id) return;
    const source = String(event.active.id).slice(kind.length + 1);
    const target = String(event.over.id).slice(kind.length + 1);
    const oldIndex = allKeys.indexOf(source);
    const newIndex = allKeys.indexOf(target);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(allKeys, oldIndex, newIndex);
    window.localStorage.setItem(kind === "bot" ? "microduck.botCardOrder" : "microduck.walletCardOrder", JSON.stringify(next));
    if (kind === "bot") setBotCardOrder(next); else setWalletCardOrder(next);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setPageNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const onStopInitiated = useCallback((botName: string) => {
    setPendingStopBots((prev) => new Set(prev).add(botName));
  }, []);
  const onStopSettled = useCallback((botName: string) => {
    setPendingStopBots((prev) => {
      const next = new Set(prev);
      next.delete(botName);
      return next;
    });
  }, []);

  // Subscribe to real-time bots updates via WS
  useCondorWebSocket(BOTS_WS_CHANNELS, server);

  const { data, isLoading, error } = useQuery({
    queryKey: ["bots", server],
    queryFn: () => api.getBots(server!),
    enabled: !!server,
    refetchInterval: 30000, // Slower polling since WS handles real-time updates
  });

  const { data: availableConfigs, error: availableConfigsError } = useQuery({
    queryKey: ["controller-configs", server],
    queryFn: () => api.getAvailableConfigs(server!),
    enabled: !!server,
  });

  const cachedWalletBalances = useMemo(() => readWalletBalanceCache(server), [server]);

  const {
    data: walletBalances,
    isLoading: walletBalancesLoading,
    isFetching: walletBalancesFetching,
    isFetchedAfterMount: walletBalancesFetchedAfterMount,
    error: walletBalancesError,
    dataUpdatedAt: walletBalancesUpdatedAt,
    refetch: refetchWalletBalances,
  } = useQuery({
    queryKey: ["gateway-wallet-balances", server, "ethereum", "robinhoodchain", "MICRODUCK,ETH,USDG"],
    queryFn: () => api.getWalletBalances(
      server!, "ethereum", "robinhoodchain", ["MICRODUCK", "ETH", "USDG"],
    ),
    enabled: !!server,
    staleTime: WALLET_BALANCE_REFRESH_INTERVAL,
    refetchInterval: WALLET_BALANCE_REFRESH_INTERVAL,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: true,
    initialData: cachedWalletBalances?.data,
    initialDataUpdatedAt: cachedWalletBalances?.savedAt,
  });

  useEffect(() => {
    if (!server || !walletBalances || walletBalancesUpdatedAt <= 0) return;
    try {
      localStorage.setItem(walletBalanceCacheKey(server), JSON.stringify({
        savedAt: walletBalancesUpdatedAt,
        data: walletBalances,
      }));
    } catch {
      // The live query still works when storage is disabled or full.
    }
  }, [server, walletBalances, walletBalancesUpdatedAt]);

  // Compute earliest deploy time from active bots for filtering perf history
  const earliestDeploy = useMemo(() => {
    if (!data?.bots?.length) return undefined;
    let earliest: number | undefined;
    for (const bot of data.bots) {
      if (bot.deployed_at) {
        const ms = Date.parse(bot.deployed_at);
        if (!isNaN(ms) && (earliest === undefined || ms < earliest)) earliest = ms;
      }
    }
    return earliest ? new Date(earliest).toISOString() : undefined;
  }, [data?.bots]);

  // Fetch performance history for sparklines (all controllers at once)
  const { data: perfHistory } = useQuery({
    queryKey: ["controller-perf-history-all", server, earliestDeploy],
    queryFn: () =>
      api.getControllerPerformanceHistory(server!, {
        interval: "5m",
        limit: 1000,
        start_time: earliestDeploy,
      }),
    enabled: !!server && (data?.controllers?.length ?? 0) > 0,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const bots = data?.bots ?? [];

  // Track which bots are stopping (server-side status + optimistic pending mutations)
  const stoppingBotNames = useMemo(() => {
    const names = new Set(pendingStopBots);
    for (const bot of bots) {
      if (bot.status === "stopping") names.add(bot.bot_name);
    }
    return names;
  }, [bots, pendingStopBots]);

  // Deduplicate controllers by bot_name + controller_id (WS updates can cause duplicates)
  const controllers = useMemo(() => {
    const raw = data?.controllers ?? [];
    const seen = new Map<string, ControllerInfo>();
    for (const ctrl of raw) {
      const key = `${ctrl.bot_name}:${ctrl.controller_id || ctrl.controller_name}`;
      seen.set(key, ctrl); // last wins (most recent data)
    }
    return Array.from(seen.values());
  }, [data?.controllers]);

  // 控制器的展示名可能是中文，而配置 ID 才包含 microduck；统一按多个可用字段识别。
  const buyTrackingControllers = useMemo(() => controllers.filter((controller) =>
    [
      controller.controller_name,
      controller.controller_id,
      controller.trading_pair,
      controller.config?.controller_name,
      controller.config?.id,
    ].some((value) => String(value ?? "").toLowerCase().includes("microduck")),
  ), [controllers]);

  // 钱包区展示的每个钱包都应查询授权；不能只查询已被 Bot 使用的钱包。
  const controllerWalletAddresses = useMemo(() => Array.from(new Set([
    ...controllers
      .map((controller) => String(
        controller.custom_info?.wallet_address ?? controller.config?.wallet_address ?? "",
      ).trim())
      .filter(Boolean),
    ...(walletBalances?.wallets ?? []).map((wallet) => String(wallet.address ?? "").trim()).filter(Boolean),
  ].map((address) => address.toLowerCase()))), [controllers, walletBalances?.wallets]);

  const walletAllowanceQueries = useQueries({
    queries: controllerWalletAddresses.map((address) => ({
      // 不能把余额刷新时间放进 key：每次刷新都会新建一个空查询，导致已知额度短暂消失。
      queryKey: ["gateway-wallet-allowance", server, "ethereum", "robinhoodchain", address, "uniswap/router", "USDG"],
      queryFn: () => api.getWalletAllowances(
        server!, "ethereum", "robinhoodchain", address, "uniswap/router", ["USDG"],
      ),
      enabled: !!server && walletBalancesUpdatedAt > 0,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      initialData: readWalletAllowanceCache(server, address)?.data,
      initialDataUpdatedAt: readWalletAllowanceCache(server, address)?.savedAt,
    })),
  });

  // 授权仍只跟随真实的钱包余额刷新读取；请求过程中保留旧成功值，不显示成“暂未获取”。
  useEffect(() => {
    if (!walletBalancesFetchedAfterMount || walletBalancesUpdatedAt <= 0) return;
    for (const query of walletAllowanceQueries) void query.refetch();
    // 余额刷新时间是唯一触发条件；query 数组每次渲染都会变化，不能作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletBalancesFetchedAfterMount, walletBalancesUpdatedAt]);

  useEffect(() => {
    if (!server) return;
    controllerWalletAddresses.forEach((address, index) => {
      const data = walletAllowanceQueries[index]?.data as GatewayWalletAllowancesResponse | undefined;
      const amount = Number(data?.approvals?.USDG);
      if (!data || !Number.isFinite(amount)) return;
      try {
        localStorage.setItem(walletAllowanceCacheKey(server, address), JSON.stringify({
          savedAt: Date.now(),
          data,
        }));
      } catch {
        // 不影响本页已获得的授权结果。
      }
    });
  }, [server, controllerWalletAddresses, walletAllowanceQueries]);

  const usdgAllowanceByWallet = useMemo(() => {
    const allowances = new Map<string, number | null>();
    controllerWalletAddresses.forEach((address, index) => {
      const response = walletAllowanceQueries[index]?.data as GatewayWalletAllowancesResponse | undefined;
      const rawAmount = response?.approvals?.USDG;
      const amount = Number(rawAmount);
      allowances.set(address, rawAmount === undefined || !Number.isFinite(amount) ? null : amount);
    });
    return allowances;
  }, [controllerWalletAddresses, walletAllowanceQueries]);

  const sortedControllers = useMemo(
    () => [...controllers].sort((a, b) => compareControllers(a, b, sortKey, sortDir)),
    [controllers, sortKey, sortDir],
  );

  // Filter performance snapshots to only active controllers and current run
  const activeSnapshots = useMemo(() => {
    if (!perfHistory?.snapshots || controllers.length === 0) return [];

    // Build set of active controller IDs and their deploy times
    const activeControllers = new Map<string, number>(); // id -> deployedAt ms
    for (const ctrl of controllers) {
      const cid = ctrl.controller_id || ctrl.controller_name;
      const deployMs = ctrl.deployed_at ? Date.parse(ctrl.deployed_at) : 0;
      activeControllers.set(cid, deployMs);
    }

    return perfHistory.snapshots.filter((snap) => {
      const key = snap.controller_id || snap.controller_name;
      if (!key || !activeControllers.has(key)) return false;
      const deployMs = activeControllers.get(key)!;
      if (!deployMs) return true; // no deploy time known, keep it
      const snapMs = Date.parse(snap.timestamp) || 0;
      return snapMs >= deployMs;
    });
  }, [perfHistory, controllers]);

  // Build a map: controller_id -> sorted pnl values for sparklines
  const sparklineMap = useMemo(() => {
    const map: Record<string, number[]> = {};
    if (activeSnapshots.length === 0) return map;
    // Group by controller_id
    const grouped: Record<string, ControllerPerformanceSnapshot[]> = {};
    for (const snap of activeSnapshots) {
      const key = snap.controller_id || snap.controller_name;
      if (!key) continue;
      (grouped[key] ??= []).push(snap);
    }
    for (const [key, snaps] of Object.entries(grouped)) {
      const sorted = snaps.sort((a, b) => {
        const ta = Date.parse(a.timestamp) || 0;
        const tb = Date.parse(b.timestamp) || 0;
        return ta - tb;
      });
      map[key] = sorted.map((s) => s.global_pnl_quote);
    }
    return map;
  }, [activeSnapshots]);

  // Currency conversion
  const quoteCurrencies = useMemo(
    () => controllers.map((c) => c.trading_pair?.split("-")[1] || "USDT"),
    [controllers],
  );
  const { convert, formatPnlValue, formatValue, resolvedSymbol: currencySymbol } = useRates(quoteCurrencies);
  const latestPrice = latestPositionPrice(controllers);

  // 必须在所有提前返回之前调用，避免加载完成后增加 Hook 而使页面崩溃。
  useEffect(() => {
    if (latestPrice?.kind === "price") setLatestPriceReceivedAt(Date.now());
  }, [latestPrice?.kind === "price" ? latestPrice.updatedAt : null]);

  if (!server) {
    return <NoServerCard message="Select a server from the sidebar to view active bots." />;
  }
  if (isLoading) return <FallbackSpinner />;
  if (error)
    return (
      <p className="text-[var(--color-red)]">
        {error instanceof Error ? error.message : "Error"}
      </p>
    );

  const serverOnline = data?.server_online !== false;
  const errorHint = data?.error_hint;
  const activeBots = bots.filter((b) => b.status === "running" || b.status === "stopping").length;
  const configNames = (availableConfigs?.configs ?? [])
    .map((config) => config.id)
    .sort((a, b) => a.localeCompare(b));
  const configSummary = availableConfigsError
    ? "配置列表获取失败"
    : availableConfigs
      ? configNames.length > 0 ? `共 ${configNames.length} 个` : "暂无配置"
      : "正在读取";
  const latestPriceValue = latestPrice?.kind === "price"
    ? `${currencySymbol}${latestPrice.price.toFixed(6)}`
    : latestPrice?.kind === "multiple"
      ? "多个机器人数据不同"
      : "暂未获取";
  const latestPriceAge = latestPrice?.kind === "price" && latestPrice.updatedAt
    ? Math.max(0, Math.floor((pageNow - new Date(latestPrice.updatedAt).getTime()) / 1000))
    : null;
  const latestPriceSource = latestPrice?.kind === "price"
    ? latestPrice.sourceBotDisplayName || latestPrice.sourceBotName
    : "";
  const latestPriceDetail = latestPrice?.kind === "price" && latestPriceAge !== null
    ? latestPrice.priceQueryGroup
      ? `${latestPriceAge} 秒前更新 · ${latestPrice.priceQueryGroup}（来自 ${latestPriceSource}）`
      : `${latestPriceAge} 秒前更新 · ${latestPriceSource}`
    : "更新时间暂未获取";
  const latestPriceTitle = latestPrice?.kind === "price"
    ? `来源 Bot：${latestPriceSource}\n报价分组：${latestPrice.priceQueryGroup || "未分组"}\n缓存状态：${latestPrice.cacheHit ? `命中（${latestPrice.cacheAgeSeconds?.toFixed(1) ?? "未知"} 秒）` : "未命中"}\n报价完成：${latestPrice.updatedAt || "未提供"}\nBot 回报：${latestPrice.reportedAt || "未提供"}\n页面收到：${latestPriceReceivedAt ? new Date(latestPriceReceivedAt).toISOString() : "未记录"}`
    : undefined;
  const formatStrategyPriceRange = (lower: number | null, upper: number | null) => {
    if (lower === null) return "暂未获取";
    if (upper === null || Math.abs(upper - lower) < 1e-12) {
      return `${currencySymbol}${lower.toFixed(6)}`;
    }
    return `${currencySymbol}${lower.toFixed(6)} – ${currencySymbol}${upper.toFixed(6)}`;
  };
  const botStrategyItems = controllers.map((controller) => {
    const summary = controllerStrategySummary([controller]);
    const custom = controller.custom_info || {};
    const config = controller.config || {};
    const buyMode = String(custom.buy_size_mode ?? config.buy_size_mode ?? "budget");
    const buySizeRaw = buyMode === "quantity"
      ? custom.buy_amount_base ?? config.buy_amount_base
      : custom.buy_budget_usd ?? config.buy_budget_usd;
    const buySize = Number(buySizeRaw);
    const configuredBuySize = buySizeRaw == null || !Number.isFinite(buySize) || buySize <= 0
      ? "暂未获取"
      : buyMode === "quantity"
        ? `${buySize.toLocaleString("en-US", { maximumFractionDigits: 6 })} MICRODUCK`
        : `$${buySize.toFixed(2)}`;
    const configuredBuyPrice = typeof summary.configuredBuyPrice === "number" && summary.configuredBuyPrice > 0
      ? summary.configuredBuyPrice
      : null;
    const buyTolerance = Number(custom.buy_price_upward_tolerance_usd ?? config.buy_price_upward_tolerance_usd ?? 0);
    const configuredBuyPriceUpper = configuredBuyPrice === null
      ? null
      : configuredBuyPrice + (Number.isFinite(buyTolerance) && buyTolerance > 0 ? buyTolerance : 0);
    const controllerState = String(custom.state ?? "").toLowerCase();
    const entryPrice = Number(custom.entry_unit_price_usd);
    const sellPriceBasis = ["holding", "trailing", "selling"].includes(controllerState)
      && Number.isFinite(entryPrice) && entryPrice > 0
      ? entryPrice
      : configuredBuyPrice;
    const sellMultiple = Number(custom.sell_profit_multiple ?? config.sell_profit_multiple ?? config.profit_multiple);
    const sellCap = Number(custom.sell_price_max_usd ?? config.sell_price_max_usd);
    const estimatedSellLower = typeof summary.estimatedSellPrice === "number" && summary.estimatedSellPrice > 0
      ? summary.estimatedSellPrice
      : null;
    const estimatedSellUpper = sellPriceBasis !== null && Number.isFinite(sellMultiple) && sellMultiple > 0
      ? Number.isFinite(sellCap) && sellCap > 0
        ? Math.min(sellPriceBasis * sellMultiple, sellCap)
        : sellPriceBasis * sellMultiple
      : estimatedSellLower;
    // 旧运行中的 Bot 仍按“先扣容差，再取上限”的规则执行；在其重启加载新规则前，
    // 页面必须继续显示旧的单一价格，不能把新范围误报成已经生效。
    const usesFinalSellTargetTolerance = custom.sell_tolerance_uses_final_target === true;
    const legacySellLower = sellPriceBasis !== null && Number.isFinite(sellMultiple) && sellMultiple > 0
      ? Number.isFinite(sellCap) && sellCap > 0
        ? Math.min(Math.max(0, sellPriceBasis * sellMultiple - Number(custom.sell_price_downward_tolerance_usd ?? config.sell_price_downward_tolerance_usd ?? 0)), sellCap)
        : Math.max(0, sellPriceBasis * sellMultiple - Number(custom.sell_price_downward_tolerance_usd ?? config.sell_price_downward_tolerance_usd ?? 0))
      : estimatedSellLower;
    const displayedSellLower = usesFinalSellTargetTolerance ? estimatedSellLower : legacySellLower;
    const displayedSellUpper = usesFinalSellTargetTolerance ? estimatedSellUpper : legacySellLower;
    // 未买入时按最高允许买入价估算，已持仓时按实际买入价估算；卖出始终采用
    // 已扣除卖出容差后的下沿价格，展示较保守的预计利润率。
    const expectedProfitBuyPrice = ["holding", "trailing", "selling"].includes(controllerState)
      && Number.isFinite(entryPrice) && entryPrice > 0
      ? entryPrice
      : configuredBuyPriceUpper;
    const expectedProfitPercent = expectedProfitBuyPrice !== null
      && displayedSellLower !== null
      && expectedProfitBuyPrice > 0
      ? (displayedSellLower / expectedProfitBuyPrice - 1) * 100
      : null;
    const expectedInvestmentUsd = buyMode === "quantity"
      ? configuredBuyPriceUpper !== null && Number.isFinite(buySize) && buySize > 0
        ? buySize * configuredBuyPriceUpper
        : null
      : Number.isFinite(buySize) && buySize > 0
        ? buySize
        : null;
    const walletAddress = String(custom.wallet_address ?? config.wallet_address ?? "").trim();
    const usdgAllowance = walletAddress
      ? usdgAllowanceByWallet.get(walletAddress.toLowerCase()) ?? null
      : null;
    const usdgAllowanceInsufficient = usdgAllowance !== null
      && expectedInvestmentUsd !== null
      && usdgAllowance + Number.EPSILON < expectedInvestmentUsd;
    const position = (controller.positions_summary || []).find((item) =>
      Number(item.amount ?? item.net_amount_base ?? 0) > 0,
    );
    const managedAmountRaw = custom.position_base ?? position?.amount ?? position?.net_amount_base ?? 0;
    const managedAmount = Number(managedAmountRaw);
    const validManagedAmount = Number.isFinite(managedAmount) && managedAmount > 0 ? managedAmount : 0;
    const currentValueRaw = custom.min_sell_usd;
    const currentUnitPrice = Number(custom.unit_sell_price_usd ?? position?.current_price);
    const currentValue = Number(currentValueRaw);
    const managedValueUsd = validManagedAmount === 0
      ? 0
      : Number.isFinite(currentValue) && currentValue >= 0
        ? currentValue
        : Number.isFinite(currentUnitPrice) && currentUnitPrice > 0
          ? validManagedAmount * currentUnitPrice
          : null;
    const quote = controller.trading_pair?.split("-")[1] || "USDT";
    const convertedPnl = convert(controller.global_pnl_quote, quote);
    const tradeHistory = Array.isArray(custom.trade_history)
      ? custom.trade_history as Record<string, unknown>[]
      : [];
    const tradeVolume = (side: "BUY" | "SELL") => tradeHistory.reduce((total, trade) => {
      if (String(trade.side ?? "").toUpperCase() !== side) return total;
      const value = Number(trade.total_usd);
      return Number.isFinite(value) && value >= 0 ? total + value : total;
    }, 0);
    const convertedBuyVolume = convert(tradeVolume("BUY"), quote);
    const convertedSellVolume = convert(tradeVolume("SELL"), quote);
    const tradeState = summary.tradeState === "multiple"
      ? "状态不同"
      : summary.tradeState || "暂未获取";
    const tradeIsStopped = typeof tradeState === "string" && tradeState.includes("已停止");
    const profitPercent = summary.profitPercent === "multiple"
      ? "数据不同"
      : summary.profitPercent === null
        ? tradeIsStopped ? "停止计算" : "暂未获取"
        : `${summary.profitPercent >= 0 ? "+" : ""}${summary.profitPercent.toFixed(2)}%`;
    const profitPercentColor = typeof summary.profitPercent === "number"
      ? summary.profitPercent >= 0 ? "var(--color-green)" : "var(--color-red)"
      : "var(--color-text-muted)";
    return {
      controller,
      buyMode,
      configuredBuySize,
      summary,
      configuredBuyPriceRange: formatStrategyPriceRange(configuredBuyPrice, configuredBuyPriceUpper),
      configuredBuyPriceUpper,
      estimatedSellPriceRange: formatStrategyPriceRange(displayedSellLower, displayedSellUpper),
      estimatedSellLower: displayedSellLower,
      estimatedSellUpper: displayedSellUpper,
      expectedProfitPercent,
      walletAddress,
      usdgAllowance,
      usdgAllowanceInsufficient,
      expectedInvestmentUsd,
      managedAmount: validManagedAmount,
      managedValueUsd,
      pnl: convertedPnl.value,
      buyVolume: convertedBuyVolume.value,
      sellVolume: convertedSellVolume.value,
      tradeState,
      profitPercent,
      profitPercentColor,
    };
  });

  // 下方日志区按状态栏中策略卡片的顺序排列。同一 Bot 有多个控制器时，
  // 取它最靠前的控制器位置，保证拖动状态栏后日志区立即跟随。
  const botsInStatusOrder = (() => {
    const orderByBot = new Map<string, number>();
    botStrategyItems.forEach((item, fallbackIndex) => {
      const controllerKey = `${item.controller.bot_name}:${item.controller.controller_id || item.controller.controller_name}`;
      const savedIndex = botCardOrder.indexOf(controllerKey);
      const order = savedIndex >= 0 ? savedIndex : botCardOrder.length + fallbackIndex;
      const current = orderByBot.get(item.controller.bot_name);
      if (current === undefined || order < current) orderByBot.set(item.controller.bot_name, order);
    });
    return [...bots].sort((left, right) => {
      const leftOrder = orderByBot.get(left.bot_name) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderByBot.get(right.bot_name) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  })();
  // 授权属于钱包。合计同一钱包所有 Bot 的预计投入，避免只为其中一个
  // Bot 设置额度后，另一个 Bot 同时买入时出现额度不足。
  const walletApprovalPlans = new Map<string, {
    expectedInvestmentUsd: number;
    botName: string;
    controllerId: string;
  }>();
  for (const item of botStrategyItems) {
    if (!item.walletAddress || item.expectedInvestmentUsd === null) continue;
    // 已持仓、卖出中或已结束的策略不会再次使用 USDG 买入，不能继续占用钱包授权额度。
    const controllerState = String(item.controller.custom_info?.state ?? "").toLowerCase();
    if (["holding", "trailing", "selling", "completed", "external_exit"].includes(controllerState)) continue;
    const key = item.walletAddress.toLowerCase();
    const previous = walletApprovalPlans.get(key);
    walletApprovalPlans.set(key, {
      expectedInvestmentUsd: (previous?.expectedInvestmentUsd ?? 0) + item.expectedInvestmentUsd,
      // 总账需要一个关联策略；金额本身始终是该钱包的共享授权。
      botName: previous?.botName ?? item.controller.bot_name,
      controllerId: previous?.controllerId ?? (item.controller.controller_id || item.controller.controller_name),
    });
  }
  const walletBalanceItems = walletBalances?.wallets.map((wallet) => {
    const microduck = Number(wallet.balances?.MICRODUCK);
    const eth = Number(wallet.balances?.ETH);
    const usdg = Number(wallet.balances?.USDG);
    const validMicroduck = Number.isFinite(microduck) ? microduck : null;
    const validEth = Number.isFinite(eth) ? eth : null;
    const validUsdg = Number.isFinite(usdg) ? usdg : null;
    const microduckPrice = Number(walletBalances.prices.MICRODUCK);
    const ethPrice = Number(walletBalances.prices.ETH);
    const usdgPrice = Number(walletBalances.prices.USDG);
    const microduckUsd = validMicroduck === null || !Number.isFinite(microduckPrice)
      ? null
      : validMicroduck * microduckPrice;
    const ethUsd = validEth === null || !Number.isFinite(ethPrice)
      ? null
      : validEth * ethPrice;
    const usdgUsd = validUsdg === null || !Number.isFinite(usdgPrice)
      ? null
      : validUsdg * usdgPrice;
    const convertedMicroduck = microduckUsd === null ? null : convert(microduckUsd, "USDT");
    const convertedEth = ethUsd === null ? null : convert(ethUsd, "USDT");
    const convertedUsdg = usdgUsd === null ? null : convert(usdgUsd, "USDT");
    const total = convertedMicroduck?.converted && convertedEth?.converted && convertedUsdg?.converted
      ? convertedMicroduck.value + convertedEth.value + convertedUsdg.value
      : null;
    const addressKey = wallet.address.toLowerCase();
    const approvalPlan = walletApprovalPlans.get(addressKey);
    const usdgAllowance = usdgAllowanceByWallet.get(addressKey) ?? null;
    // 授权为同一钱包共享：已占用是所有仍可能买入的 Bot 的计划投入；
    // 可用额度只表示还能分配给其他 Bot 的授权，不代表钱包实际 USDG 余额。
    const occupiedAllowance = approvalPlan?.expectedInvestmentUsd ?? 0;
    const availableAllowance = usdgAllowance === null
      ? null
      : Math.max(0, usdgAllowance - occupiedAllowance);
    return {
      ...wallet,
      microduck: validMicroduck,
      eth: validEth,
      ethUsdPrice: Number.isFinite(ethPrice) && ethPrice > 0 ? ethPrice : null,
      microduckValue: convertedMicroduck?.converted ? convertedMicroduck.value : null,
      ethValue: convertedEth?.converted ? convertedEth.value : null,
      usdg: validUsdg,
      usdgValue: convertedUsdg?.converted ? convertedUsdg.value : null,
      total,
      usdgAllowance,
      occupiedAllowance,
      availableAllowance,
      approvalPlan,
    };
  });

  const isEmpty = controllers.length === 0 && bots.length === 0;

  if (!serverOnline) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-[var(--color-yellow)]/40 bg-[var(--color-yellow)]/10 px-4 py-3">
          <p className="text-sm font-medium text-[var(--color-yellow)]">
            Unable to reach server
          </p>
          {errorHint && (
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{errorHint}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="最新价格"
          value={(
            <span title={latestPriceTitle}>
              <span className="block">{latestPriceValue}</span>
              <span className="mt-1 block text-xs font-normal">{latestPriceDetail}</span>
            </span>
          )}
        />
        <StatCard label="运行中机器人" value={String(activeBots)} />
        <StatCard label="控制器数量" value={String(controllers.length)} />
        <StatCard
          label="配置文件"
          value={(
            <span className="block min-w-0">
              <span className="block whitespace-nowrap text-sm font-bold text-[var(--color-text)]">
                {configSummary}
              </span>
              {configNames.length > 0 && (
                <span
                  className="mt-1 block truncate whitespace-nowrap text-xs font-normal text-[var(--color-text-muted)]"
                  title={configNames.map((id) => configDisplayInfo(id).tooltip).join("\n\n")}
                >
                  {configNames.map((id) => configDisplayInfo(id).name).join("、")}
                </span>
              )}
            </span>
          )}
        />
      </div>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <h3 className="mb-3 text-base font-semibold text-[var(--color-text)]">Bot 状态</h3>
        {botStrategyItems.length ? (
          <DndContext sensors={sortableSensors} collisionDetection={closestCenter} onDragEnd={(event) => handleSortEnd("bot", event, [...botStrategyItems].sort((left, right) => {
            const leftKey = `${left.controller.bot_name}:${left.controller.controller_id || left.controller.controller_name}`;
            const rightKey = `${right.controller.bot_name}:${right.controller.controller_id || right.controller.controller_name}`;
            const leftIndex = botCardOrder.indexOf(leftKey);
            const rightIndex = botCardOrder.indexOf(rightKey);
            return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
          }).map((item) => `${item.controller.bot_name}:${item.controller.controller_id || item.controller.controller_name}`))}>
          <SortableContext items={botStrategyItems.map((item) => `bot:${item.controller.bot_name}:${item.controller.controller_id || item.controller.controller_name}`)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {[...botStrategyItems].sort((left, right) => {
              const leftKey = `${left.controller.bot_name}:${left.controller.controller_id || left.controller.controller_name}`;
              const rightKey = `${right.controller.bot_name}:${right.controller.controller_id || right.controller.controller_name}`;
              const leftIndex = botCardOrder.indexOf(leftKey);
              const rightIndex = botCardOrder.indexOf(rightKey);
              return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
            }).map((item) => {
              const key = `${item.controller.bot_name}:${item.controller.controller_id || item.controller.controller_name}`;
              return (
                <SortableCard id={`bot:${key}`}>
                <article
                  key={key}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3"
                >
                  <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <SortableHandle
                        className="shrink-0 cursor-grab touch-none text-[var(--color-text-muted)] active:cursor-grabbing"
                        title="拖动调整 Bot 顺序"
                        aria-label="拖动调整 Bot 顺序"
                      >
                        <GripVertical className="h-4 w-4" />
                      </SortableHandle>
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.controller.status === "running" ? "bg-[var(--color-green)]" : "bg-[var(--color-red)]"}`}
                        aria-label={item.controller.status === "running" ? "Bot 运行中" : "Bot 未运行"}
                        title={item.controller.status === "running" ? "Bot 运行中" : "Bot 未运行"}
                      />
                      <BotStatusNameEditor
                        server={server}
                        botName={item.controller.bot_name}
                        displayName={item.controller.bot_display_name}
                      />
                      <span className="truncate text-xs text-[var(--color-text-muted)]" title={configDisplayInfo(item.controller.controller_id || item.controller.controller_name).tooltip}>
                        {configDisplayInfo(item.controller.controller_id || item.controller.controller_name).name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => item.walletAddress && setWalletLedgerTarget({
                          address: item.walletAddress,
                          ethUsdPrice: Number.isFinite(Number(walletBalances?.prices?.ETH)) && Number(walletBalances?.prices?.ETH) > 0
                            ? Number(walletBalances?.prices?.ETH)
                            : null,
                          botName: item.controller.bot_name,
                          botDisplayName: item.controller.bot_display_name,
                          controllerId: item.controller.controller_id || item.controller.controller_name,
                        })}
                        disabled={!item.walletAddress}
                        title={item.walletAddress ? "查看该 Bot 在管理钱包中的账单记录" : "暂未获取管理钱包"}
                        className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ReceiptText className="h-3 w-3" />交易记录
                      </button>
                      <button
                        type="button"
                        onClick={() => setRuntimeConfigTarget({
                          botName: item.controller.bot_name,
                          botDisplayName: item.controller.bot_display_name,
                          configId: item.controller.controller_id || item.controller.controller_name,
                        })}
                        className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      >
                        <Settings className="h-3 w-3" />调整配置
                      </button>
                      <span
                        className="whitespace-nowrap rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text)]"
                        title={String(item.tradeState)}
                      >
                        {item.tradeState}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[repeat(11,minmax(0,1fr))] 2xl:[&>div+div]:border-l 2xl:[&>div+div]:border-[var(--color-border)] 2xl:[&>div+div]:pl-5 2xl:[&>div:nth-child(2)]:pl-8">
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">当前持仓</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {item.managedAmount.toFixed(6)} MICRODUCK
                      </div>
                      <div className="whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                        {item.managedValueUsd === null
                          ? "价值暂未获取"
                          : formatCurrencyVolume(convert(item.managedValueUsd, "USDT").value, currencySymbol)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">{item.buyMode === "quantity" ? "配置买入数量" : "配置买入预算"}</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">{item.configuredBuySize}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">配置买入价格</div>
                      {item.configuredBuyPriceUpper !== null
                        && item.summary.configuredBuyPrice !== null
                        && item.summary.configuredBuyPrice !== "multiple"
                        && item.configuredBuyPriceUpper > item.summary.configuredBuyPrice + Number.EPSILON
                        ? <div className="mt-1 text-sm font-bold leading-5 tabular-nums text-[var(--color-text)]"><div>{currencySymbol}{item.summary.configuredBuyPrice.toFixed(6)} -</div><div>{currencySymbol}{item.configuredBuyPriceUpper.toFixed(6)}</div></div>
                        : <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">{item.configuredBuyPriceRange}</div>}
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">预计卖出价格</div>
                      {item.estimatedSellLower !== null
                        && item.estimatedSellUpper !== null
                        && item.estimatedSellUpper > item.estimatedSellLower + Number.EPSILON
                        ? <div className="mt-1 text-sm font-bold leading-5 tabular-nums text-[var(--color-text)]"><div>{currencySymbol}{item.estimatedSellLower.toFixed(6)} -</div><div>{currencySymbol}{item.estimatedSellUpper.toFixed(6)}</div></div>
                        : <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">{item.estimatedSellPriceRange}</div>}
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">预计利润</div>
                      <div
                        className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums"
                        style={{ color: item.expectedProfitPercent === null ? "var(--color-text-muted)" : item.expectedProfitPercent >= 0 ? "var(--color-green)" : "var(--color-red)" }}
                      >
                        {item.expectedProfitPercent === null
                          ? "暂未获取"
                          : `${item.expectedProfitPercent >= 0 ? "+" : ""}${item.expectedProfitPercent.toFixed(2)}%`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">管理钱包</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold text-[var(--color-text)]" title={item.walletAddress || undefined}>
                        {item.walletAddress ? `…${item.walletAddress.slice(-5)}` : "暂未获取"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">预计投入</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {item.expectedInvestmentUsd === null ? "暂未获取" : `$${item.expectedInvestmentUsd.toFixed(6)}`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">当前利润率</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums" style={{ color: item.profitPercentColor }}>
                        {item.profitPercent}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">总利润</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums" style={{ color: pnlColor(item.pnl) }}>
                        {(item.pnl >= 0 ? "+" : "")}{formatCurrencyVolume(item.pnl, currencySymbol)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">累计买入</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {formatCurrencyVolume(item.buyVolume, currencySymbol)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-muted)]">累计卖出</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {formatCurrencyVolume(item.sellVolume, currencySymbol)}
                      </div>
                    </div>
                  </div>
                </article>
                </SortableCard>
              );
            })}
          </div>
          </SortableContext>
          </DndContext>
        ) : (
          <div className="text-sm text-[var(--color-text-muted)]">当前没有运行中的 Bot 控制器</div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-[var(--color-text)]">钱包余额</h3>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">
              {walletBalancesFetching
                ? "正在后台更新"
                : walletBalancesError ? "更新失败，显示缓存" : "每 5 分钟更新"}
            </span>
            <button
              type="button"
              onClick={() => void refetchWalletBalances()}
              disabled={!server || walletBalancesFetching}
              className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-50"
              title="立即刷新全部钱包余额"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${walletBalancesFetching ? "animate-spin" : ""}`} />
              刷新余额
            </button>
          </div>
        </div>
        {walletBalanceItems?.length ? (
          <DndContext sensors={sortableSensors} collisionDetection={closestCenter} onDragEnd={(event) => handleSortEnd("wallet", event, [...walletBalanceItems].sort((left, right) => {
            const leftIndex = walletCardOrder.indexOf(left.address.toLowerCase());
            const rightIndex = walletCardOrder.indexOf(right.address.toLowerCase());
            return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
          }).map((wallet) => wallet.address.toLowerCase()))}>
          <SortableContext items={walletBalanceItems.map((wallet) => `wallet:${wallet.address.toLowerCase()}`)} strategy={rectSortingStrategy}>
          <div className="flex flex-wrap gap-3">
            {[...walletBalanceItems].sort((left, right) => {
              const leftIndex = walletCardOrder.indexOf(left.address.toLowerCase());
              const rightIndex = walletCardOrder.indexOf(right.address.toLowerCase());
              return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
            }).map((wallet) => (
              <SortableCard id={`wallet:${wallet.address.toLowerCase()}`}>
              <article
                key={wallet.address.toLowerCase()}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3 sm:w-[46rem]"
                title={wallet.address}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <SortableHandle
                      className="shrink-0 cursor-grab touch-none text-[var(--color-text-muted)] active:cursor-grabbing"
                      title="拖动调整钱包顺序"
                      aria-label="拖动调整钱包顺序"
                    >
                      <GripVertical className="h-4 w-4" />
                    </SortableHandle>
                    {editingWalletAlias === wallet.address.toLowerCase() ? (
                    <form className="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); saveWalletAlias(wallet.address); }}>
                      <input autoFocus maxLength={80} value={walletAliasInput} onChange={(event) => setWalletAliasInput(event.target.value)} className="w-36 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs" placeholder="留空清除别名" />
                      <button type="submit" className="rounded px-1.5 py-1 text-xs text-[var(--color-primary)]">保存</button>
                      <button type="button" onClick={() => setEditingWalletAlias(null)} className="rounded px-1.5 py-1 text-xs text-[var(--color-text-muted)]">取消</button>
                    </form>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--color-text-muted)]">
                      {walletAliases[wallet.address.toLowerCase()] ? (
                        <>
                          <span className="text-[var(--color-text)]">{walletAliases[wallet.address.toLowerCase()]}</span>
                          <span>钱包 …{wallet.address.slice(-5)}</span>
                        </>
                      ) : (
                        <span>钱包 …{wallet.address.slice(-5)}</span>
                      )}
                      <button type="button" onClick={() => { setWalletAliasInput(walletAliases[wallet.address.toLowerCase()] || ""); setEditingWalletAlias(wallet.address.toLowerCase()); }} className="rounded p-0.5 hover:text-[var(--color-text)]" title="修改钱包别名"><Pencil className="h-3 w-3" /></button>
                    </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setWalletLedgerTarget({ address: wallet.address, ethUsdPrice: wallet.ethUsdPrice })}
                    disabled={!server}
                    className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    title="查看这个钱包的本系统 Bot 账单"
                  >
                    <ReceiptText className="h-3.5 w-3.5" />
                    账单
                  </button>
                </div>
                {wallet.error || wallet.microduck === null || wallet.eth === null || wallet.usdg === null ? (
                  <div className="text-sm font-semibold text-[var(--color-text-muted)]">余额暂时无法获取</div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-[1.25fr_1fr_1.25fr_1.55fr_1fr]">
                    <div className="min-w-0">
                      <div className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">MICRODUCK</div>
                      <div className="whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {wallet.microduck.toFixed(6)}
                      </div>
                      <div className="whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                        {wallet.microduckValue === null
                          ? "价值暂未获取"
                          : formatCurrencyVolume(wallet.microduckValue, currencySymbol)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">ETH</div>
                      <div className="whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {wallet.eth.toFixed(6)}
                      </div>
                      <div className="whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                        {wallet.ethValue === null
                          ? "价值暂未获取"
                          : formatCurrencyVolume(wallet.ethValue, currencySymbol)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">USDG</div>
                      <div className="whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {wallet.usdg.toFixed(6)}
                      </div>
                      <div className="whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                        {wallet.usdgValue === null
                          ? "价值暂未获取"
                          : formatCurrencyVolume(wallet.usdgValue, currencySymbol)}
                      </div>
                    </div>
                    <div className="min-w-0 border-l border-[var(--color-border)] pl-3">
                      <div className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">USDG 总授权额度</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {wallet.usdgAllowance === null
                          ? "暂未获取"
                          : wallet.usdgAllowance <= 0
                            ? "未设置"
                            : `${wallet.usdgAllowance.toFixed(6)} USDG`}
                      </div>
                      <div className="mt-1 whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                        已占用额度 {wallet.occupiedAllowance.toFixed(6)} USDG
                      </div>
                      <div className="whitespace-nowrap text-xs tabular-nums text-[var(--color-text-muted)]">
                        可用额度 {wallet.availableAllowance === null ? "暂未获取" : `${wallet.availableAllowance.toFixed(6)} USDG`}
                      </div>
                      <UsdgAllowanceEditor
                        server={server}
                        walletAddress={wallet.address}
                        currentAllowance={wallet.usdgAllowance}
                        suggestedAmount={wallet.approvalPlan?.expectedInvestmentUsd ?? null}
                        ethUsdPrice={wallet.ethUsdPrice}
                        botName={wallet.approvalPlan?.botName}
                        controllerId={wallet.approvalPlan?.controllerId}
                      />
                    </div>
                    <div className="min-w-0 border-l border-[var(--color-border)] pl-3">
                      <div className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">总余额</div>
                      <div className="whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-text)]">
                        {wallet.total === null
                          ? "暂未获取"
                          : formatCurrencyVolume(wallet.total, currencySymbol)}
                      </div>
                    </div>
                  </div>
                )}
              </article>
              </SortableCard>
            ))}
          </div>
          </SortableContext>
          </DndContext>
        ) : (
          <div className="text-sm text-[var(--color-text-muted)]">
            {walletBalancesLoading
              ? "正在读取钱包余额"
              : walletBalancesError ? "钱包余额暂时无法获取" : "未配置钱包"}
          </div>
        )}
      </section>

      {/* Buy tracking charts are above the portfolio PnL chart by design. */}
      {server && buyTrackingControllers.map((controller) => (
        <BuyTrackingChart
          key={`${controller.bot_name}:${controller.controller_id || controller.controller_name}`}
          server={server}
          botName={controller.bot_name}
          controllerId={controller.controller_id || controller.controller_name}
          title={configDisplayInfo(controller.controller_id || controller.controller_name).name}
        />
      ))}

      {/* Aggregated PnL chart */}
      {activeSnapshots.length > 0 && (
        <AggregatedPnlChart
          snapshots={activeSnapshots}
          controllers={controllers}
          currencySymbol={currencySymbol}
          convert={convert}
        />
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center gap-2 py-16 text-[var(--color-text-muted)]">
          <Bot className="h-10 w-10" />
          <p>No bots running</p>
        </div>
      ) : (
        <>
          {/* Controllers table */}
          {controllers.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                      <SortHeader label="Controller" sortKey="controller_name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Connector" sortKey="connector" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Pair" sortKey="trading_pair" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Realized" sortKey="realized_pnl_quote" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Unrealized" sortKey="unrealized_pnl_quote" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Total PnL" sortKey="global_pnl_quote" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <th className="px-2 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] text-center">
                        Trend
                      </th>
                      <SortHeader label="Volume" sortKey="volume_traded" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Age" sortKey="deployed_at" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="center" />
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] text-center">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedControllers.map((ctrl) => {
                      const cid = ctrl.controller_id || ctrl.controller_name;
                      return (
                        <ControllerRow
                          key={`${ctrl.bot_name}-${cid}`}
                          ctrl={ctrl}
                          server={server!}
                          isSelected={selectedKey === `${ctrl.bot_name}-${ctrl.controller_id || ctrl.controller_name}`}
                          onSelect={() => setSelectedKey(`${ctrl.bot_name}-${ctrl.controller_id || ctrl.controller_name}`)}
                          formatPnlValue={formatPnlValue}
                          formatValue={formatValue}
                          sparklineValues={sparklineMap[cid]}
                          isBotStopping={stoppingBotNames.has(ctrl.bot_name)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <ControllerTradingActivity
            controllers={sortedControllers}
            currencySymbol={currencySymbol}
            convert={convert}
          />

          {/* Bots collapsible section */}
          {bots.length > 0 && <BotsSection bots={botsInStatusOrder} server={server} onStopInitiated={onStopInitiated} onStopSettled={onStopSettled} />}
        </>
      )}

      {/* Fullscreen controller overlay */}
      {selectedKey && controllers.length > 0 && (
        <ControllerBrowser
          controllers={sortedControllers}
          server={server}
          initialControllerKey={selectedKey}
          onClose={() => setSelectedKey(null)}
          convert={convert}
          currencySymbol={currencySymbol}
        />
      )}

      {/* Deploy dialog */}
      <ImportExternalPositionDialog
        open={showImportPosition}
        onClose={() => onImportPositionClose?.()}
        server={server}
      />
      {runtimeConfigTarget && (
        <RuntimeConfigDialog
          open
          server={server}
          botName={runtimeConfigTarget.botName}
          botDisplayName={runtimeConfigTarget.botDisplayName}
          configId={runtimeConfigTarget.configId}
          onClose={() => setRuntimeConfigTarget(null)}
        />
      )}
      {walletLedgerTarget && (
        <WalletLedgerDialog
          open
          server={server}
          walletAddress={walletLedgerTarget.address}
          ethUsdPrice={walletLedgerTarget.ethUsdPrice}
          botName={walletLedgerTarget.botName}
          botDisplayName={walletLedgerTarget.botDisplayName}
          controllerId={walletLedgerTarget.controllerId}
          onClose={() => setWalletLedgerTarget(null)}
        />
      )}
    </div>
  );
}
