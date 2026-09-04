from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from condor.fetchers.bot_performance import extract_snapshots as _extract_snapshots
from condor.fetchers.bot_performance import fetch_all_bot_performance
from condor.fetchers.controller_performance import enrich_controller_performance
from condor.web.auth import require_server_access
from condor.web.models import (
    BotRunInfo,
    BotRunsResponse,
    ControllerPerformanceHistoryResponse,
    ControllerPerformanceLatestResponse,
    ControllerPerformanceSnapshot,
    WebUser,
)
from condor.web.routes._errors import upstream_error
from config_manager import get_config_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["controller-performance"])


# ── Helpers ──


def _parse_snapshot(raw: dict) -> ControllerPerformanceSnapshot:
    """Normalize a raw performance snapshot dict into our model."""
    perf = raw.get("performance", raw)
    if not isinstance(perf, dict):
        perf = {}
    custom_info = raw.get("custom_info", perf.get("custom_info", {}))
    if not isinstance(custom_info, dict):
        custom_info = {}
    perf, _ = enrich_controller_performance(perf, custom_info)

    return ControllerPerformanceSnapshot(
        timestamp=str(raw.get("timestamp", "")),
        bot_name=raw.get("bot_name", ""),
        controller_id=raw.get("controller_id", ""),
        controller_name=raw.get("controller_name", ""),
        connector=raw.get("connector", raw.get("connector_name", "")),
        trading_pair=raw.get("trading_pair", ""),
        realized_pnl_quote=float(perf.get("realized_pnl_quote", 0) or 0),
        unrealized_pnl_quote=float(perf.get("unrealized_pnl_quote", 0) or 0),
        global_pnl_quote=float(perf.get("global_pnl_quote", 0) or 0),
        global_pnl_pct=float(perf.get("global_pnl_pct", 0) or 0),
        volume_traded=float(perf.get("volume_traded", 0) or 0),
        close_type_counts=perf.get("close_type_counts", {}),
        positions_summary=perf.get("positions_summary", []),
        custom_info=custom_info,
    )


def _parse_bot_run(raw: dict, perf_by_bot: dict[str, dict] | None = None) -> BotRunInfo:
    """Normalize a raw bot run dict into our model."""
    bot_name = raw.get("bot_name", "")
    realized = 0.0
    unrealized = 0.0
    volume = 0.0
    num_controllers = 0

    if perf_by_bot and bot_name in perf_by_bot:
        agg = perf_by_bot[bot_name]
        realized = agg.get("realized_pnl_quote", 0.0)
        unrealized = agg.get("unrealized_pnl_quote", 0.0)
        volume = agg.get("volume_traded", 0.0)
        num_controllers = agg.get("num_controllers", 0)

    return BotRunInfo(
        bot_name=bot_name,
        bot_run_id=raw.get("id"),
        account_name=raw.get("account_name", ""),
        strategy_type=raw.get("strategy_type", ""),
        strategy_name=raw.get("strategy_name", ""),
        run_status=raw.get("run_status", raw.get("status", "")),
        deployment_status=raw.get("deployment_status", ""),
        created_at=str(raw["deployed_at"]) if raw.get("deployed_at") else None,
        stopped_at=str(raw["stopped_at"]) if raw.get("stopped_at") else None,
        realized_pnl_quote=realized,
        unrealized_pnl_quote=unrealized,
        global_pnl_quote=realized + unrealized,
        volume_traded=volume,
        num_controllers=num_controllers,
    )


# ── Bot Runs ──


@router.get(
    "/servers/{name}/bot-runs",
    response_model=BotRunsResponse,
)
async def get_bot_runs(
    name: str,
    bot_name: Optional[str] = Query(None),
    account_name: Optional[str] = Query(None),
    strategy_type: Optional[str] = Query(None),
    strategy_name: Optional[str] = Query(None),
    run_status: Optional[str] = Query(None),
    deployment_status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: WebUser = Depends(require_server_access),
):
    """Get bot runs with optional filtering."""
    import asyncio

    cm = get_config_manager()

    client = await cm.get_client(name)

    async def _fetch_runs():
        return await client.bot_orchestration.get_bot_runs(
            bot_name=bot_name,
            account_name=account_name,
            strategy_type=strategy_type,
            strategy_name=strategy_name,
            run_status=run_status,
            deployment_status=deployment_status,
            limit=limit,
            offset=offset,
        )

    async def _fetch_perf() -> dict[str, dict]:
        """Fetch latest controller performance and aggregate by bot_name."""
        try:
            return await fetch_all_bot_performance(client)
        except Exception:
            logger.debug(
                "Could not fetch controller performance for bot runs enrichment"
            )
            return {}

    try:
        result, perf_by_bot = await asyncio.gather(_fetch_runs(), _fetch_perf())
    except Exception as e:
        logger.exception("Failed to fetch bot runs from '%s'", name)
        raise upstream_error("Failed to fetch bot runs", e)

    runs_list = _extract_runs_list(result)

    return BotRunsResponse(
        runs=[_parse_bot_run(r, perf_by_bot) for r in runs_list],
        total=len(runs_list),
    )


@router.delete(
    "/servers/{name}/bot-runs/{bot_run_id}",
)
async def delete_bot_run(
    name: str,
    bot_run_id: int,
    user: WebUser = Depends(require_server_access),
):
    """Delete an archived bot run by its numeric ID."""
    cm = get_config_manager()

    client = await cm.get_client(name)

    try:
        result = await client.bot_orchestration.delete_bot_run(bot_run_id)
    except Exception as e:
        logger.exception("Failed to delete bot run %d from '%s'", bot_run_id, name)
        raise upstream_error("Failed to delete bot run", e)

    return {"deleted": True, "bot_run_id": bot_run_id, "result": result}


def _extract_runs_list(result) -> list[dict]:
    """Normalize bot runs API response into a list of dicts."""
    if isinstance(result, list):
        return [r for r in result if isinstance(r, dict)]
    if isinstance(result, dict):
        data = result.get("data", result.get("runs", result))
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
        if isinstance(data, dict):
            # Dict keyed by bot_name
            return [
                {"bot_name": k, **v} for k, v in data.items() if isinstance(v, dict)
            ]
    return []


# ── Controller Performance: Latest ──


@router.get(
    "/servers/{name}/controller-performance/latest",
    response_model=ControllerPerformanceLatestResponse,
)
async def get_latest_controller_performance(
    name: str,
    bot_name: Optional[str] = Query(None),
    user: WebUser = Depends(require_server_access),
):
    """Get the most recent performance snapshot for each bot/controller."""
    cm = get_config_manager()

    client = await cm.get_client(name)

    try:
        result = await client.bot_orchestration.get_latest_controller_performance(
            bot_name=bot_name,
        )
    except Exception as e:
        logger.warning(
            "Failed to fetch latest controller performance from '%s': %s", name, e
        )
        return ControllerPerformanceLatestResponse(
            server_online=False,
            error_hint=f"Connection error: {e}",
        )

    snapshots = _extract_snapshots(result)

    return ControllerPerformanceLatestResponse(
        snapshots=[_parse_snapshot(s) for s in snapshots],
    )


# ── Controller Performance: History ──


@router.get(
    "/servers/{name}/controller-performance/history",
    response_model=ControllerPerformanceHistoryResponse,
)
async def get_controller_performance_history(
    name: str,
    bot_name: Optional[str] = Query(None),
    controller_id: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    interval: str = Query("5m"),
    limit: Optional[int] = Query(None, ge=1, le=5000),
    cursor: Optional[str] = Query(None),
    user: WebUser = Depends(require_server_access),
):
    """Get historical controller performance with pagination and interval sampling."""
    cm = get_config_manager()

    client = await cm.get_client(name)

    try:
        result = await client.bot_orchestration.get_controller_performance_history(
            bot_name=bot_name,
            controller_id=controller_id,
            start_time=start_time,
            end_time=end_time,
            interval=interval,
            limit=limit,
            cursor=cursor,
        )
    except Exception as e:
        logger.warning(
            "Failed to fetch controller performance history from '%s': %s", name, e
        )
        return ControllerPerformanceHistoryResponse(
            server_online=False,
            error_hint=f"Connection error: {e}",
        )

    snapshots = _extract_snapshots(result)
    next_cursor = None
    if isinstance(result, dict):
        next_cursor = result.get("next_cursor") or result.get("cursor")

    return ControllerPerformanceHistoryResponse(
        snapshots=[_parse_snapshot(s) for s in snapshots],
        next_cursor=next_cursor,
        interval=interval,
    )


@router.get("/servers/{name}/buy-tracking/history")
async def get_buy_tracking_history(
    name: str,
    bot_name: str = Query(..., min_length=1),
    controller_id: Optional[str] = Query(None),
    range: str = Query("1h", pattern="^(1h|3h|6h|12h|24h)$"),
    user: WebUser = Depends(require_server_access),
):
    """Proxy a sampled Microduck buy-tracking time series."""
    try:
        client = await get_config_manager().get_client(name)
        return await client.bot_orchestration._get(
            "/bot-orchestration/buy-tracking-history",
            params={"bot_name": bot_name, "controller_id": controller_id, "range": range},
        )
    except Exception as e:
        logger.warning("Failed to fetch buy tracking history from '%s': %s", name, e)
        return {"status": "error", "range": range, "points": [], "error_hint": str(e)}


@router.get("/servers/{name}/strategy-trades")
async def get_strategy_trades(
    name: str,
    bot_name: str = Query(..., min_length=1),
    controller_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    user: WebUser = Depends(require_server_access),
):
    """Proxy the confirmed trade records for one Bot/controller."""
    try:
        client = await get_config_manager().get_client(name)
        return await client.bot_orchestration._get(
            "/bot-orchestration/strategy-trades",
            params={"bot_name": bot_name, "controller_id": controller_id, "limit": limit},
        )
    except Exception as e:
        logger.warning("Failed to fetch strategy trades from '%s': %s", name, e)
        return {"status": "error", "trades": [], "error_hint": str(e)}


@router.get("/servers/{name}/wallet-ledger")
async def get_wallet_ledger(
    name: str,
    wallet_address: str = Query(..., min_length=1),
    bot_name: Optional[str] = Query(None, min_length=1),
    controller_id: Optional[str] = Query(None, min_length=1),
    limit: int = Query(500, ge=1, le=1000),
    user: WebUser = Depends(require_server_access),
):
    """Proxy this system's aggregated Bot ledger for one wallet."""
    try:
        client = await get_config_manager().get_client(name)
        params = {"wallet_address": wallet_address, "limit": limit}
        if bot_name:
            params["bot_name"] = bot_name
        if controller_id:
            params["controller_id"] = controller_id
        return await client.bot_orchestration._get(
            "/bot-orchestration/wallet-ledger",
            params=params,
        )
    except Exception as e:
        logger.warning("Failed to fetch wallet ledger from '%s': %s", name, e)
        return {"status": "error", "summary": {}, "records": [], "error_hint": str(e)}
