import pytest

from condor.web.routes import bots


class _Controllers:
    def __init__(self, yaml_content: str):
        self.yaml_content = yaml_content
        self.saved = None

    async def get_controller_config(self, config_id: str):
        return {
            "id": config_id,
            "controller_name": "microduck_profit_trailing",
            "controller_type": "generic",
            "live_trading": True,
        }

    async def _get(self, path: str):
        assert path.endswith("/raw")
        return {"yaml_content": self.yaml_content}

    async def _put(self, path: str, *, json: dict):
        assert path.endswith("/raw")
        self.saved = json["yaml_content"]
        return {"message": "saved"}


class _ConfigManager:
    def __init__(self, controllers: _Controllers):
        self.client = type("Client", (), {"controllers": controllers})()

    async def get_client(self, name: str):
        return self.client


@pytest.mark.asyncio
async def test_condor_reads_and_saves_yaml_without_regenerating(monkeypatch):
    yaml_content = (
        "# 安全与运行模式, 测试模式-false，正常-true\n"
        "\n"
        "live_trading: true\n"
        "manual_kill_switch: true\n"
    )
    controllers = _Controllers(yaml_content)
    manager = _ConfigManager(controllers)
    monkeypatch.setattr(bots, "get_config_manager", lambda: manager)

    detail = await bots.get_controller_config("local", "microduck", user=None)
    assert detail.yaml_content == yaml_content

    result = await bots.update_controller_config(
        "local",
        "microduck",
        {"yaml_content": yaml_content},
        user=None,
    )

    assert result["updated"] is True
    assert controllers.saved == yaml_content
