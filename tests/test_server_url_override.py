from config_manager import ConfigManager


def test_server_url_override_does_not_change_saved_config(monkeypatch, tmp_path):
    config_path = tmp_path / "config.yml"
    config_path.write_text(
        "version: 1\nservers:\n  local:\n    host: 127.0.0.1\n    port: 24872\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CONDOR_SERVER_URL_LOCAL", "http://hummingbot-api:8000/")

    manager = ConfigManager(str(config_path))

    assert manager._server_base_url("local") == "http://hummingbot-api:8000"
    assert manager._data["servers"]["local"]["host"] == "127.0.0.1"


def test_invalid_server_url_override_is_rejected(monkeypatch, tmp_path):
    config_path = tmp_path / "config.yml"
    config_path.write_text(
        "version: 1\nservers:\n  local:\n    host: 127.0.0.1\n    port: 24872\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CONDOR_SERVER_URL_LOCAL", "hummingbot-api:8000")
    manager = ConfigManager(str(config_path))

    try:
        manager._server_base_url("local")
    except ValueError as exc:
        assert "valid HTTP URL" in str(exc)
    else:
        raise AssertionError("invalid override was accepted")
