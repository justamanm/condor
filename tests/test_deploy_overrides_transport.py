from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from mcp_servers.hummingbot_api.tools.controllers import deploy_bot


@pytest.mark.asyncio
async def test_deploy_preserves_overrides_with_old_client():
    post = AsyncMock(return_value={"status": "success"})
    client = SimpleNamespace(bot_orchestration=SimpleNamespace(_post=post))
    overrides = {"template": {
        "buy_size_mode": "quantity", "buy_amount_base": 10,
        "buy_trailing_rebound_adjustment_factor": 0.5,
        "buy_trailing_rebound_max_percent": 12,
        "buy_price_min_usd": "0.027", "buy_trailing_rebound_percent": "7",
        "sell_profit_multiple": "1.3", "sell_price_max_usd": "0.030",
        "sell_trailing_drop_percent": "8",
    }}
    result = await deploy_bot(client, "test-only", ["template"], overrides)
    post.assert_awaited_once_with("/bot-orchestration/deploy-v2-controllers", json={
        "instance_name": "test-only", "controllers_config": ["template"],
        "controller_overrides": overrides, "credentials_profile": "master_account",
        "image": "microduck/hummingbot:local",
    })
    assert result["controller_overrides"] == overrides


@pytest.mark.asyncio
async def test_deploy_preserves_zero_drawdown_and_empty_overrides():
    post = AsyncMock(return_value={})
    client = SimpleNamespace(bot_orchestration=SimpleNamespace(_post=post))
    await deploy_bot(client, "test-only", ["template"], max_global_drawdown_quote=0,
                     max_controller_drawdown_quote=2)
    payload = post.call_args.kwargs["json"]
    assert payload["controller_overrides"] == {}
    assert payload["max_global_drawdown_quote"] == 0
    assert payload["max_controller_drawdown_quote"] == 2


@pytest.mark.asyncio
async def test_deploy_error_does_not_retry_without_overrides():
    post = AsyncMock(side_effect=RuntimeError("timeout"))
    client = SimpleNamespace(bot_orchestration=SimpleNamespace(_post=post))
    with pytest.raises(RuntimeError, match="timeout"):
        await deploy_bot(client, "test-only", ["template"], {"template": {"buy_amount_base": 10}})
    assert post.await_count == 1
