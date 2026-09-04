import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ReceiptText, X } from "lucide-react";
import { useState } from "react";

import { api, type StrategyTradeRecord } from "@/lib/api";
import { configDisplayInfo } from "@/lib/config-display";

function number(value: number | null | undefined, digits = 6): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "暂未获取";
}

function signed(value: number | null | undefined, token: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "暂未获取";
  return `${value >= 0 ? "+" : ""}${number(value)} ${token}`;
}

function gas(value: number | null | undefined, ethUsdPrice: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "暂未获取 ETH";
  const usd = ethUsdPrice !== null && Number.isFinite(ethUsdPrice)
    ? `（约 $${(value * ethUsdPrice).toFixed(6)}）`
    : "（美元暂未获取）";
  return `${number(value, 8)} ETH ${usd}`;
}

function time(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function typeLabel(record: StrategyTradeRecord): string {
  if (record.record_type === "APPROVAL") return "USDG 授权";
  return record.side === "BUY" ? "买入" : "卖出";
}

function recordSourceLabel(record: StrategyTradeRecord): string {
  if (record.bot_name === "__wallet_authorization__") return "钱包授权";
  return record.bot_display_name?.trim() || record.bot_name;
}

function LedgerRecord({ record, ethUsdPrice }: { record: StrategyTradeRecord; ethUsdPrice: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const approval = record.record_type === "APPROVAL";
  const status = record.status === "PENDING" ? "确认中" : record.status === "CONFIRMED" ? "已确认" : "链上失败";
  return <div className="rounded-md border border-[var(--color-border)] p-3">
    <button type="button" className="grid w-full items-center gap-2 text-left text-sm sm:grid-cols-[145px_90px_1fr_1fr_1fr_auto]" onClick={() => setExpanded(!expanded)}>
      <span className="text-xs text-[var(--color-text-muted)]">{time(record.timestamp)}</span>
      <span className={approval ? "font-semibold text-[var(--color-primary)]" : record.side === "BUY" ? "font-semibold text-[var(--color-green)]" : "font-semibold text-[var(--color-red)]"}>{typeLabel(record)}</span>
      <span>{recordSourceLabel(record)}</span>
      <span>{approval ? `${number(record.approval_amount)} USDG` : `${number(record.amount_base)} ${record.base_token}`}</span>
      <span>Gas {gas(record.gas_fee_native, ethUsdPrice)}</span>
      <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">详情 {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
    </button>
    {expanded && <div className="mt-2 grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs sm:grid-cols-2">
      <div><span className="text-[var(--color-text-muted)]">状态：</span>{status}</div>
      <div><span className="text-[var(--color-text-muted)]">来源：</span>{record.bot_name === "__wallet_authorization__" ? "钱包栏" : configDisplayInfo(record.controller_id).name}</div>
      {approval ? <div><span className="text-[var(--color-text-muted)]">授权额度：</span>{number(record.approval_amount)} USDG</div> : <>
        <div><span className="text-[var(--color-text-muted)]">成交总额：</span>{number(record.total_quote)} {record.quote_token}</div>
        <div><span className="text-[var(--color-text-muted)]">成交单价：</span>${number(record.unit_price_usd)}</div>
      </>}
      <div><span className="text-[var(--color-text-muted)]">Gas：</span>{gas(record.gas_fee_native, ethUsdPrice)}</div>
      <div className="min-w-0 sm:col-span-2"><span className="text-[var(--color-text-muted)]">交易哈希：</span><span className="break-all font-mono">{record.transaction_hash}</span></div>
    </div>}
  </div>;
}

export function WalletLedgerDialog({ open, server, walletAddress, ethUsdPrice, botName, botDisplayName, controllerId, onClose }: {
  open: boolean; server: string; walletAddress: string; ethUsdPrice: number | null; botName?: string; botDisplayName?: string | null; controllerId?: string; onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["wallet-ledger", server, walletAddress, botName, controllerId],
    queryFn: () => api.getWalletLedger(server, walletAddress, botName, controllerId),
    enabled: open && Boolean(server) && Boolean(walletAddress),
    refetchInterval: open ? 10_000 : false,
  });
  if (!open) return null;
  const ledger = query.data;
  const summary = ledger?.summary;
  const records = ledger?.records ?? [];
  const latestApprovalGasEstimate = ledger?.latest_approval_gas_estimate;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
    <section className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
        <div><h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text)]"><ReceiptText className="h-5 w-5" />{botName ? "交易记录" : "钱包账单"}</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">{botName ? `${botDisplayName?.trim() || botName} · 来自钱包 …${walletAddress.slice(-5)} 的账单` : `钱包 …${walletAddress.slice(-5)}，仅统计本系统发起的 Bot 操作和钱包授权`}</p></div>
        <button type="button" className="rounded-md p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)] hover:text-[var(--color-text)]" onClick={onClose} aria-label="关闭钱包账单"><X className="h-5 w-5" /></button>
      </header>
      <div className="max-h-[calc(85vh-85px)] overflow-y-auto p-5">
        {query.isLoading ? <p className="text-sm text-[var(--color-text-muted)]">正在读取钱包账单…</p> : query.isError || ledger?.status === "error" ? <p className="text-sm text-[var(--color-red)]">钱包账单暂时无法获取：{ledger?.error_hint || "请稍后重试"}</p> : <>
          <div className="mb-5 grid gap-3 sm:grid-cols-5">
            <div className="rounded-md border border-[var(--color-border)] p-3"><div className="text-xs text-[var(--color-text-muted)]">USDG 净变化</div><div className="mt-1 font-semibold tabular-nums">{signed(summary?.usdg_net, "USDG")}</div></div>
            <div className="rounded-md border border-[var(--color-border)] p-3"><div className="text-xs text-[var(--color-text-muted)]">MICRODUCK 净变化</div><div className="mt-1 font-semibold tabular-nums">{signed(summary?.microduck_net, "MICRODUCK")}</div></div>
            <div className="rounded-md border border-[var(--color-border)] p-3"><div className="text-xs text-[var(--color-text-muted)]">累计 ETH Gas</div><div className="mt-1 font-semibold tabular-nums">-{gas(summary?.eth_gas, ethUsdPrice)}</div></div>
            <div className="rounded-md border border-[var(--color-border)] p-3"><div className="text-xs text-[var(--color-text-muted)]">已确认记录</div><div className="mt-1 font-semibold tabular-nums">{summary?.confirmed_count ?? 0} 笔</div><div className="mt-1 text-xs text-[var(--color-text-muted)]">{summary?.unknown_gas_count ? `${summary.unknown_gas_count} 笔 Gas 暂未获取` : "Gas 已完整返回"}</div></div>
            <div className="rounded-md border border-[var(--color-border)] p-3"><div className="text-xs text-[var(--color-text-muted)]">最近授权预估</div>{latestApprovalGasEstimate ? <><div className="mt-1 font-semibold tabular-nums">{gas(latestApprovalGasEstimate.estimated_gas_eth, ethUsdPrice)}</div><div className="mt-1 text-xs text-[var(--color-text-muted)]">{time(latestApprovalGasEstimate.timestamp)}，{latestApprovalGasEstimate.action_count} 笔，{number(latestApprovalGasEstimate.approval_amount)} {latestApprovalGasEstimate.token}</div></> : <div className="mt-1 text-sm text-[var(--color-text-muted)]">暂无预估</div>}</div>
          </div>
          {records.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">该钱包暂时没有本系统发起的交易记录。</p> : <div className="space-y-2">{records.map((record) => <LedgerRecord key={`${record.bot_name}:${record.controller_id}:${record.transaction_hash}`} record={record} ethUsdPrice={ethUsdPrice} />)}</div>}
        </>}
      </div>
    </section>
  </div>;
}
