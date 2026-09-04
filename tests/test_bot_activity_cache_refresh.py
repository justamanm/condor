import asyncio

import pytest

from condor.web.routes import bots


@pytest.fixture(autouse=True)
def _clear_transition_state():
    bots._stopping_bots.clear()
    bots._stopping_controllers.clear()
    yield
    bots._stopping_bots.clear()
    bots._stopping_controllers.clear()


def test_clear_bot_transition_state_removes_bot_and_its_controllers_only():
    bots.mark_bot_stopping("local", "old_bot")
    bots.mark_bot_stopping("local", "other_bot")
    bots.mark_controllers_stopping("local", "old_bot", ["one", "two"])
    bots.mark_controllers_stopping("local", "other_bot", ["three"])

    bots.clear_bot_transition_state("local", "old_bot")

    assert bots.get_stopping_bots("local") == {"other_bot"}
    assert bots.get_stopping_controllers("local") == {"other_bot:three"}


def test_refresh_bot_activity_cache_refreshes_immediately(monkeypatch):
    calls = []

    class _SDS:
        async def refresh(self, server, data_type):
            calls.append(("refresh", server, data_type))
            return {"bots": []}

        def invalidate(self, server, data_type):
            calls.append(("invalidate", server, data_type))

    monkeypatch.setattr(
        "condor.server_data_service.get_server_data_service", lambda: _SDS()
    )
    bots.mark_bot_stopping("local", "old_bot")

    asyncio.run(bots.refresh_bot_activity_cache("local", "old_bot"))

    assert len(calls) == 1
    assert calls[0][0:2] == ("refresh", "local")
    assert "old_bot" not in bots.get_stopping_bots("local")


def test_stop_refresh_keeps_tombstone_until_upstream_bot_disappears(monkeypatch):
    class _SDS:
        async def refresh(self, server, data_type):
            return {"data": {"old_bot": {"status": "running"}}}

        def invalidate(self, server, data_type):
            raise AssertionError("successful refresh must not invalidate")

    monkeypatch.setattr(
        "condor.server_data_service.get_server_data_service", lambda: _SDS()
    )
    bots.mark_bot_stopping("local", "old_bot")

    asyncio.run(
        bots.refresh_bot_activity_cache(
            "local", "old_bot", clear_transition=False
        )
    )

    assert bots.get_stopping_bots("local") == {"old_bot"}


def test_stopped_bot_is_hidden_across_refreshes_then_tombstone_clears():
    bots.mark_bot_stopping("local", "old_bot")
    bot_rows = [
        {"bot_name": "old_bot", "status": "running"},
        {"bot_name": "new_bot", "status": "running"},
    ]
    controller_rows = [
        {"bot_name": "old_bot", "controller_id": "old_controller"},
        {"bot_name": "new_bot", "controller_id": "new_controller"},
    ]

    bots.overlay_stopping_state("local", controller_rows, bot_rows)

    assert [row["bot_name"] for row in bot_rows] == ["new_bot"]
    assert [row["bot_name"] for row in controller_rows] == ["new_bot"]
    assert bots.get_stopping_bots("local") == {"old_bot"}

    # 上游下一轮确认旧实例已经消失后，才删除屏蔽记录。
    bots.overlay_stopping_state("local", controller_rows, bot_rows)
    assert bots.get_stopping_bots("local") == set()
