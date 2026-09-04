"""The Bot card reads Gateway allowances through Condor's authenticated server client."""

import asyncio

import condor.web.routes.portfolio as portfolio_routes
from condor.web.models import WebUser


class FakeAccounts:
    def __init__(self):
        self.calls = []

    async def _get(self, path, params):
        self.calls.append((path, params))
        return {"spender": "0xrouter", "approvals": {"USDG": "1.000000"}}


class FakeClient:
    def __init__(self):
        self.accounts = FakeAccounts()


class FakeConfigManager:
    def __init__(self, client):
        self.client = client

    async def get_client(self, name):
        assert name == "local"
        return self.client


def test_wallet_allowances_proxy_forwards_read_only_parameters(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(portfolio_routes, "get_config_manager", lambda: FakeConfigManager(client))

    response = asyncio.run(portfolio_routes.get_wallet_allowances(
        name="local",
        chain="ethereum",
        network="robinhoodchain",
        address="0xwallet",
        spender="uniswap/router",
        tokens="USDG",
        user=WebUser(id=1, role="user"),
    ))

    assert response == {"spender": "0xrouter", "approvals": {"USDG": "1.000000"}}
    assert client.accounts.calls == [(
        "/accounts/gateway/wallet-allowances",
        {
            "chain": "ethereum",
            "network": "robinhoodchain",
            "address": "0xwallet",
            "spender": "uniswap/router",
            "tokens": "USDG",
        },
    )]
