"""Tests for PERF-059: ServerDataService in-flight fetch coalescing.

Concurrent ``get_or_fetch`` calls for the same cold key must trigger exactly
one backend fetch (single-flight); the outcome — success or failure — is
shared by all coalesced waiters, and a failed fetch never poisons subsequent
fetches for the key.
"""

import asyncio

from condor.server_data_service import ServerDataService, ServerDataType


def _make_sds(fetch_func):
    """Fresh (non-singleton) SDS with a fake client and a registered fetcher."""
    sds = ServerDataService()

    async def _fake_get_client(server_name):
        return object()

    sds._get_client = _fake_get_client
    sds.register_fetch(ServerDataType.PORTFOLIO, fetch_func)
    return sds


def test_concurrent_get_or_fetch_coalesces_to_single_fetch():
    """Two concurrent get_or_fetch calls on a cold key fetch exactly once."""
    calls = {"count": 0}

    async def counting_fetcher(client, **params):
        calls["count"] += 1
        await asyncio.sleep(0.05)  # keep the fetch in flight while others join
        return {"value": calls["count"]}

    async def _drive():
        sds = _make_sds(counting_fetcher)
        results = await asyncio.gather(
            sds.get_or_fetch("srv", ServerDataType.PORTFOLIO),
            sds.get_or_fetch("srv", ServerDataType.PORTFOLIO),
        )
        return sds, results

    sds, results = asyncio.run(_drive())

    assert calls["count"] == 1, "concurrent cold reads must coalesce to one fetch"
    assert results[0] == results[1] == {"value": 1}
    assert sds._inflight == {}, "in-flight map must be cleared once settled"


def test_fetch_failure_shared_by_waiters_and_does_not_poison_next_fetch():
    """All coalesced waiters see the failure; the next fetch starts clean."""
    calls = {"count": 0}
    fail = {"on": True}

    async def flaky_fetcher(client, **params):
        calls["count"] += 1
        await asyncio.sleep(0.05)
        if fail["on"]:
            raise RuntimeError("backend down")
        return {"ok": True}

    async def _drive():
        sds = _make_sds(flaky_fetcher)

        # Both waiters coalesce onto the single failing fetch (no value cached)
        failed = await asyncio.gather(
            sds.get_or_fetch("srv", ServerDataType.PORTFOLIO),
            sds.get_or_fetch("srv", ServerDataType.PORTFOLIO),
        )
        assert failed == [None, None]
        assert calls["count"] == 1
        assert sds._inflight == {}

        # Failure must not poison the key: a later fetch runs and succeeds
        fail["on"] = False
        recovered = await sds.get_or_fetch("srv", ServerDataType.PORTFOLIO)
        assert recovered == {"ok": True}
        assert calls["count"] == 2
        assert sds._inflight == {}

    asyncio.run(_drive())


def test_refresh_waits_for_old_inflight_then_fetches_post_mutation_value():
    """修改前启动的旧请求不能在刷新后重新写回缓存。"""
    calls = {"count": 0}
    old_started = asyncio.Event()
    release_old = asyncio.Event()

    async def staged_fetcher(client, **params):
        calls["count"] += 1
        if calls["count"] == 1:
            old_started.set()
            await release_old.wait()
            return {"bots": ["old"]}
        return {"bots": ["new"]}

    async def _drive():
        sds = ServerDataService()

        async def _fake_get_client(server_name):
            return object()

        sds._get_client = _fake_get_client
        sds.register_fetch(ServerDataType.BOTS_STATUS, staged_fetcher)

        old_task = asyncio.create_task(
            sds.get_or_fetch("srv", ServerDataType.BOTS_STATUS)
        )
        await old_started.wait()
        refresh_task = asyncio.create_task(
            sds.refresh("srv", ServerDataType.BOTS_STATUS)
        )
        await asyncio.sleep(0)
        release_old.set()

        assert await old_task == {"bots": ["old"]}
        assert await refresh_task == {"bots": ["new"]}
        assert sds.get("srv", ServerDataType.BOTS_STATUS) == {"bots": ["new"]}
        assert calls["count"] == 2

    asyncio.run(_drive())
