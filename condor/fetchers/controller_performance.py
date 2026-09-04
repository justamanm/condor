"""把控制器自行完成的交易转换成 Condor 通用性能字段。"""

from __future__ import annotations

from typing import Any


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value is not None else default)
    except (TypeError, ValueError):
        return default


def enrich_controller_performance(
    performance: dict[str, Any] | None,
    custom_info: dict[str, Any] | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """合并 Executor 性能和控制器主动上报的补充性能。

    ``supplemental_performance`` 是所有直接通过 Gateway、链上合约等方式
    成交的控制器都可以使用的通用字段，不与某一种币或某一个策略绑定。
    旧控制器尚未上报该字段时，也能从现有持仓字段恢复当前持仓显示。
    """
    result = dict(performance or {})
    info = custom_info if isinstance(custom_info, dict) else {}
    supplemental = info.get("supplemental_performance")

    if isinstance(supplemental, dict):
        for key in ("realized_pnl_quote", "unrealized_pnl_quote", "volume_traded"):
            result[key] = _number(result.get(key)) + _number(supplemental.get(key))

        positions = list(result.get("positions_summary") or [])
        extra_positions = supplemental.get("positions_summary") or []
        if isinstance(extra_positions, list):
            positions.extend(p for p in extra_positions if isinstance(p, dict))
        result["positions_summary"] = positions

        total_pnl = _number(result.get("realized_pnl_quote")) + _number(
            result.get("unrealized_pnl_quote")
        )
        result["global_pnl_quote"] = total_pnl
        if _number(result.get("global_pnl_pct")) == 0:
            result["global_pnl_pct"] = _number(supplemental.get("global_pnl_pct"))

        # 已持仓的旧状态首次加载新版策略时还没有 trade_history。
        # 在第一笔新版成交发生前，继续使用持仓成本恢复买入量和成交记录。
        amount = _number(info.get("position_base"))
        entry_price = _number(info.get("entry_unit_price_usd"))
        if amount > 0 and entry_price > 0 and _number(result.get("volume_traded")) == 0:
            result["volume_traded"] = amount * entry_price
    else:
        # 兼容已经在运行、但尚未加载新版代码的直接交易控制器。
        amount = _number(info.get("position_base"))
        entry_price = _number(info.get("entry_unit_price_usd"))
        current_price = _number(info.get("unit_sell_price_usd"))
        current_value = _number(info.get("min_sell_usd"))
        if amount > 0 and entry_price > 0:
            if current_value <= 0 and current_price > 0:
                current_value = amount * current_price
            cost = amount * entry_price
            unrealized = current_value - cost if current_value > 0 else 0.0
            if not result.get("positions_summary"):
                result["positions_summary"] = [
                    {
                        "side": "BUY",
                        "amount": amount,
                        "entry_price": entry_price,
                        "current_price": current_price,
                        "quote_value": current_value,
                        "unrealized_pnl_quote": unrealized,
                    }
                ]
            if _number(result.get("volume_traded")) == 0:
                result["volume_traded"] = cost
            if _number(result.get("unrealized_pnl_quote")) == 0:
                result["unrealized_pnl_quote"] = unrealized
            result["global_pnl_quote"] = _number(
                result.get("realized_pnl_quote")
            ) + _number(result.get("unrealized_pnl_quote"))

    trades = info.get("trade_history") or info.get("trades") or []
    if not isinstance(trades, list):
        trades = []
    if not trades:
        amount = _number(info.get("position_base"))
        entry_price = _number(info.get("entry_unit_price_usd"))
        if amount > 0 and entry_price > 0:
            trades = [
                {
                    "timestamp": info.get("run_started_at"),
                    "side": "BUY",
                    "price_usd": entry_price,
                    "amount_base": amount,
                    "total_usd": amount * entry_price,
                    "transaction_hash": None,
                    "recovered_from_position": True,
                }
            ]
    return result, [trade for trade in trades if isinstance(trade, dict)]
