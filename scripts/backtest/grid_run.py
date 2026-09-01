"""Run backtest grid — multiple parameter combinations for richer score distribution."""
import subprocess, sys, json, requests
from api_auth import auth_headers

API = "https://btc-radar.prospects-intel.workers.dev"
URL = f"{API}/api/backtest"
HEADERS = auth_headers()
BASE = "https://btc-radar.prospects-intel.workers.dev"

# Fetch data once
import pandas as pd
import requests as req

resp = req.get(f"{BASE}/api/price/history?interval=1d&limit=365", timeout=30)
print(f"HTTP {resp.status_code} from {BASE}/api/price/history...")
data = resp.json()
if not data.get("success"):
    print(f"API error: {data.get('error', 'unknown')}")
    print(f"Full response: {resp.text[:500]}")
    sys.exit(1)

candles = data["data"]
candles.sort(key=lambda c: c["timestamp"])
df = pd.DataFrame(candles)
df["timestamp"] = pd.to_datetime(df["timestamp"])
df = df.set_index("timestamp")
for col in ["open", "high", "low", "close", "volume"]:
    df[col] = pd.to_numeric(df[col], errors="coerce")
df = df.dropna()

# Import strategies engine
sys.path.insert(0, ".")
from engine import simulate_portfolio, simulate_dca
from strategies import trend_following, rsi_extreme, macd_cross, bollinger_mean_reversion, dca

# Grid of parameters
grid = [
    # trend_following — vary fast/slow
    ("trend_following", trend_following, "Trend Following", [
        {"fast": 20, "slow": 50},
        {"fast": 50, "slow": 200},
        {"fast": 20, "slow": 100},
        {"fast": 10, "slow": 50},
        {"fast": 30, "slow": 150},
    ]),
    # rsi — vary period and thresholds
    ("rsi", rsi_extreme, "RSI Extremos", [
        {"period": 14, "oversold": 30, "overbought": 70},
        {"period": 7, "oversold": 20, "overbought": 80},
        {"period": 21, "oversold": 30, "overbought": 70},
        {"period": 14, "oversold": 25, "overbought": 75},
        {"period": 10, "oversold": 30, "overbought": 70},
    ]),
    # macd — vary fast/slow/signal
    ("macd", macd_cross, "MACD Cross", [
        {"fast": 12, "slow": 26, "signal": 9},
        {"fast": 8, "slow": 17, "signal": 9},
        {"fast": 5, "slow": 35, "signal": 5},
        {"fast": 21, "slow": 55, "signal": 8},
        {"fast": 3, "slow": 10, "signal": 5},
    ]),
    # bollinger — vary period and std
    ("bollinger", bollinger_mean_reversion, "Bollinger Mean Reversion", [
        {"period": 20, "std_dev": 2.0},
        {"period": 10, "std_dev": 2.0},
        {"period": 20, "std_dev": 1.5},
        {"period": 30, "std_dev": 2.0},
        {"period": 20, "std_dev": 2.5},
    ]),
    # dca — vary interval
    ("dca", dca, "DCA", [
        {"interval_days": 7},
        {"interval_days": 1},
        {"interval_days": 14},
        {"interval_days": 30},
        {"interval_days": 3},
    ]),
]

posted = 0
for strat_key, strat_fn, label, param_list in grid:
    for params in param_list:
        try:
            entries, exits = strat_fn(df, **params)
            n_entries = int(entries.sum())
            if n_entries == 0:
                print(f"SKIP {label} {params}: 0 entradas")
                continue

            close = df["close"]
            if strat_key == "dca":
                result = simulate_dca(close=close, entries=entries, init_cash=10000.0, fees=0.001)
            else:
                result = simulate_portfolio(close=close, entries=entries, exits=exits, init_cash=10000.0, fees=0.001)

            bh_return = float(((close.iloc[-1] / close.iloc[0]) - 1) * 100)

            payload = {
                "best_trade_pct": result.get("best_trade_pct"),
                "worst_trade_pct": result.get("worst_trade_pct"),
                "profit_factor": result.get("profit_factor"),
                "avg_trade_pct": result.get("avg_trade_pct"),
                "buy_hold_return": round(bh_return, 2),
                "alpha": round(result["total_return"] - bh_return, 2),
            }
            if result.get("avg_entry_price"):
                payload["avg_entry_price"] = result["avg_entry_price"]
                payload["btc_accumulated"] = result["btc_accumulated"]

            body = {
                "strategy": strat_key,
                "params": params,
                "date_from": "2025-09-30",
                "date_to": "2026-07-26",
                "total_return": result["total_return"],
                "sharpe_ratio": result["sharpe_ratio"],
                "max_drawdown": result["max_drawdown"],
                "win_rate": result.get("win_rate"),
                "n_trades": result["n_trades"],
                "payload": payload,
            }

            resp = req.post(URL, json=body, headers=HEADERS)
            if resp.status_code == 201:
                n = result["n_trades"]
                r = result["total_return"]
                print(f"OK  {label} {params}: {n} trades, ret={r:.1f}%")
                posted += 1
            else:
                print(f"ERR {label} {params}: HTTP {resp.status_code} {resp.json().get('error','?')}")
        except Exception as e:
            print(f"ERR {label} {params}: {e}")

print(f"\nPosted {posted} backtests")
