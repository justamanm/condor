import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ReceiptText, X } from "lucide-react";
import { useState } from "react";

import { api, type StrategyTradeRecord } from "@/lib/api";
import { configDisplayInfo } from "@/lib/config-display";

function number(value: number | null, digits = 6): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "暂未获取";
}

function time(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function TradeDetail({ trade }: { trade: StrategyTradeRecord }) {
  const isApproval = trade.record_type === "APPROVAL";
  return (
    <div className="mt-2 grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs sm:grid-cols-2">
      <div><span className="text-[var(--color-text-muted)]">确认时间：</span>{time(trade.timestamp)}</div>
      <div><span className="text-[var(--color-text-muted)]">类型：</span>{isApproval ? "USDG 授权" : trade.side === "BUY" ? "买入" : "卖出"}</div>
      <div><span className="text-[var(--color-text-muted)]">状态：</span>{trade.status === "PENDING" ? "确认中" : trade.status === "CONFIRMED" ? "已确认" : "链上失败"}</div>
      {isApproval ? <div><span className="text-[var(--color-text-muted)]">授权额度：</span>{number(trade.approval_amount)} USDG</div> : <>
        <div><span className="text-[var(--color-text-muted)]">成交数量：</span>{number(trade.amount_base)} {trade.base_token}</div>
        <div><span className="text-[var(--color-text-muted)]">实际单价：</span>${number(trade.unit_price_usd)}</div>
        <div><span className="text-[var(--color-text-muted)]">成交总额：</span>{number(trade.total_quote)} {trade.quote_token}</div>
      </>}
      <div><span className="text-[var(--color-text-muted)]">Gas：</span>{number(trade.gas_fee_native)} {trade.gas_token}</div>
      <div className="min-w-0 sm:col-span-2"><span className="text-[var(--color-text-muted)]">交易哈希：</span><span className="break-all font-mono">{trade.transaction_hash}</span></div>
    </div>
  );
}

export function StrategyTradeHistoryDialog({ open, server, botName, controllerId, onClose }: {
  open: boolean; server: string; botName: string; controllerId: string; onClose: () => void;
}) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["strategy-trades", server, botName, controllerId],
    queryFn: () => api.getStrategyTrades(server, botName, controllerId),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });
  if (!open) return null;
  const trades = query.data?.trades ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <section className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text)]"><ReceiptText className="h-5 w-5" />交易记录</h2>
            <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]" title={botName}>{botName} · {configDisplayInfo(controllerId).name}</p>
          </div>
          <button type="button" className="rounded-md p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)] hover:text-[var(--color-text)]" onClick={onClose} aria-label="关闭交易记录"><X className="h-5 w-5" /></button>
        </header>
        <div className="max-h-[calc(85vh-85px)] overflow-y-auto p-5">
          {query.isLoading ? <p className="text-sm text-[var(--color-text-muted)]">正在读取交易记录…</p> : query.isError || query.data?.status === "error" ? (
            <p className="text-sm text-[var(--color-red)]">交易记录暂时无法获取：{query.data?.error_hint || "请稍后重试"}</p>
          ) : trades.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">暂无已确认成交记录。</p> : (
            <div className="space-y-2">
              {trades.map((trade) => {
                const expanded = expandedHash === trade.transaction_hash;
                const isApproval = trade.record_type === "APPROVAL";
                return <div key={trade.transaction_hash} className="rounded-md border border-[var(--color-border)] p-3">
                  <button type="button" className="grid w-full items-center gap-2 text-left text-sm sm:grid-cols-[145px_56px_1fr_1fr_1fr_auto]" onClick={() => setExpandedHash(expanded ? null : trade.transaction_hash)}>
                    <span className="text-xs text-[var(--color-text-muted)]">{time(trade.timestamp)}</span>
                    <span className={isApproval ? "font-semibold text-[var(--color-primary)]" : trade.side === "BUY" ? "font-semibold text-[var(--color-green)]" : "font-semibold text-[var(--color-red)]"}>{isApproval ? "授权" : trade.side === "BUY" ? "买入" : "卖出"}</span>
                    <span>{isApproval ? `${number(trade.approval_amount)} USDG` : `${number(trade.amount_base)} ${trade.base_token}`}</span>
                    <span>{isApproval ? (trade.status === "PENDING" ? "确认中" : trade.status === "CONFIRMED" ? "已确认" : "链上失败") : `$${number(trade.unit_price_usd)}`}</span>
                    <span>{isApproval ? `Gas ${number(trade.gas_fee_native)} ${trade.gas_token}` : `${number(trade.total_quote)} ${trade.quote_token}`}</span>
                    <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">详情 {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                  </button>
                  {expanded && <TradeDetail trade={trade} />}
                </div>;
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
