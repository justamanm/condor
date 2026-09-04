import pytest

from condor.fetchers.controller_performance import enrich_controller_performance


def test_supplemental_performance_is_added_to_executor_performance():
    performance, trades = enrich_controller_performance(
        {
            "realized_pnl_quote": 1.0,
            "unrealized_pnl_quote": 0.0,
            "volume_traded": 2.0,
            "positions_summary": [],
        },
        {
            "supplemental_performance": {
                "realized_pnl_quote": 0.5,
                "unrealized_pnl_quote": -0.1,
                "volume_traded": 1.2,
                "positions_summary": [{"asset": "MICRODUCK", "amount": 80}],
            },
            "trade_history": [{"side": "BUY", "total_usd": "1.2"}],
        },
    )

    assert performance["realized_pnl_quote"] == 1.5
    assert performance["unrealized_pnl_quote"] == -0.1
    assert performance["global_pnl_quote"] == 1.4
    assert performance["volume_traded"] == 3.2
    assert performance["positions_summary"] == [
        {"asset": "MICRODUCK", "amount": 80}
    ]
    assert trades == [{"side": "BUY", "total_usd": "1.2"}]


def test_legacy_direct_position_is_visible_before_controller_restart():
    performance, trades = enrich_controller_performance(
        {
            "realized_pnl_quote": 0.0,
            "unrealized_pnl_quote": 0.0,
            "volume_traded": 0.0,
            "positions_summary": [],
        },
        {
            "position_base": "80",
            "entry_unit_price_usd": "0.014",
            "unit_sell_price_usd": "0.012",
            "min_sell_usd": "0.96",
        },
    )

    assert performance["volume_traded"] == 1.12
    assert performance["unrealized_pnl_quote"] == pytest.approx(-0.16)
    assert performance["positions_summary"][0]["amount"] == 80
    assert performance["positions_summary"][0]["quote_value"] == 0.96
    assert trades == [
        {
            "timestamp": None,
            "side": "BUY",
            "price_usd": 0.014,
            "amount_base": 80.0,
            "total_usd": pytest.approx(1.12),
            "transaction_hash": None,
            "recovered_from_position": True,
        }
    ]


def test_restarted_legacy_position_keeps_recovered_trade_until_new_history_exists():
    performance, trades = enrich_controller_performance(
        {"volume_traded": 0.0, "positions_summary": []},
        {
            "run_started_at": "2026-09-01T06:30:00+00:00",
            "position_base": "80",
            "entry_unit_price_usd": "0.014",
            "supplemental_performance": {
                "volume_traded": 0.0,
                "positions_summary": [{"asset": "MICRODUCK", "amount": 80}],
            },
            "trade_history": [],
        },
    )

    assert performance["volume_traded"] == pytest.approx(1.12)
    assert trades[0]["side"] == "BUY"
    assert trades[0]["total_usd"] == pytest.approx(1.12)
