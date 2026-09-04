import type { ControllerInfo } from "@/lib/api";
import { formatCurrencyVolume, pnlColor } from "@/lib/formatters";

type ConvertFn = (value: number, quoteCurrency: string) => { value: number; converted: boolean };

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactHash(value: unknown): string {
  const hash = String(value || "");
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash || "—";
}

function walletAddress(controller: ControllerInfo): string {
  return String(controller.custom_info?.wallet_address ?? controller.config?.wallet_address ?? "");
}

function compactWallet(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "暂未获取";
}

function botLabel(controller: ControllerInfo): React.ReactNode {
  const displayName = controller.bot_display_name?.trim();
  return displayName || controller.bot_name;
}

export function ControllerTradingActivity({
  controllers,
  currencySymbol,
  convert,
}: {
  controllers: ControllerInfo[];
  currencySymbol: string;
  convert: ConvertFn;
}) {
  const positions = controllers.flatMap((controller) =>
    (controller.positions_summary || []).map((position) => ({ controller, position })),
  );
  const trades = controllers.flatMap((controller) =>
    (controller.trades || []).map((trade) => ({ controller, trade })),
  );

  if (positions.length === 0 && trades.length === 0) return null;

  return (
    <div className="space-y-4">
      {positions.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <h3 className="text-sm font-semibold">当前持仓（{positions.length}）</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-2 text-left">机器人</th>
                  <th className="px-4 py-2 text-left">控制器</th>
                  <th className="px-4 py-2 text-left">钱包</th>
                  <th className="px-4 py-2 text-left">资产</th>
                  <th className="px-4 py-2 text-right">管理数量</th>
                  <th className="px-4 py-2 text-right">买入价格</th>
                  <th className="px-4 py-2 text-right">当前价格</th>
                  <th className="px-4 py-2 text-right">当前价值</th>
                  <th className="px-4 py-2 text-right">未实现利润</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(({ controller, position }, index) => {
                  const quote = controller.trading_pair?.split("-")[1] || "USDT";
                  const amount = number(position.amount || position.net_amount_base);
                  const entry = number(position.entry_price || position.breakeven_price);
                  const current = number(position.current_price);
                  const rawValue = number(position.quote_value || position.current_value_quote) || amount * current;
                  const rawPnl = number(position.unrealized_pnl_quote) || rawValue - amount * entry;
                  const value = convert(rawValue, quote).value;
                  const pnl = convert(rawPnl, quote).value;
                  const wallet = walletAddress(controller);
                  return (
                    <tr key={`${controller.bot_name}-${controller.controller_id}-position-${index}`} className="border-t border-[var(--color-border)]">
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{botLabel(controller)}</td>
                      <td className="px-4 py-2">{controller.controller_name}</td>
                      <td className="px-4 py-2 font-mono whitespace-nowrap" title={wallet}>
                        {compactWallet(wallet)}
                      </td>
                      <td className="px-4 py-2 font-medium">{String(position.asset || controller.trading_pair?.split("-")[0] || "—")}</td>
                      <td className="px-4 py-2 text-right font-mono">{amount.toFixed(6)}</td>
                      <td className="px-4 py-2 text-right font-mono">${entry.toFixed(6)}</td>
                      <td className="px-4 py-2 text-right font-mono">${current.toFixed(6)}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrencyVolume(value, currencySymbol)}</td>
                      <td className="px-4 py-2 text-right font-medium" style={{ color: pnlColor(pnl) }}>
                        {pnl >= 0 ? "+" : ""}{formatCurrencyVolume(pnl, currencySymbol)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {trades.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <h3 className="text-sm font-semibold">Trades ({trades.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Side</th>
                  <th className="px-4 py-2 text-left">Asset</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right">Quantity</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-left">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(({ controller, trade }, index) => {
                  const side = String(trade.side || "—").toUpperCase();
                  const time = trade.timestamp ? new Date(String(trade.timestamp)).toLocaleString() : "—";
                  const hash = trade.transaction_hash;
                  return (
                    <tr key={`${controller.bot_name}-${controller.controller_id}-trade-${index}`} className="border-t border-[var(--color-border)]">
                      <td className="px-4 py-2 whitespace-nowrap">{time}</td>
                      <td className={`px-4 py-2 font-semibold ${side === "BUY" ? "text-[var(--color-green)]" : "text-[var(--color-red)]"}`}>{side}</td>
                      <td className="px-4 py-2">{controller.trading_pair?.split("-")[0] || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">${number(trade.price_usd).toFixed(6)}</td>
                      <td className="px-4 py-2 text-right font-mono">{number(trade.amount_base).toFixed(6)}</td>
                      <td className="px-4 py-2 text-right font-medium">${number(trade.total_usd).toFixed(4)}</td>
                      <td className="px-4 py-2 font-mono" title={String(hash || "")}>{compactHash(hash)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
