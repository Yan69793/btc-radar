"""Post backtest results from JSON file to Worker API."""
import json, requests, sys
from api_auth import auth_headers

RESULT_FILE = sys.argv[1] if len(sys.argv) > 1 else "results/backtest_20260726_231316.json"
API = "https://btc-radar.prospects-intel.workers.dev/api/backtest"
HEADERS = auth_headers()

with open(RESULT_FILE) as f:
    data = json.load(f)

for r in data["results"]:
    if "error" in r and r.get("n_trades", -1) == -1:
        continue

    payload = {
        "best_trade_pct": r.get("best_trade_pct"),
        "worst_trade_pct": r.get("worst_trade_pct"),
        "profit_factor": r.get("profit_factor"),
        "avg_trade_pct": r.get("avg_trade_pct"),
        "buy_hold_return": r.get("buy_hold_return"),
        "alpha": r.get("alpha"),
    }

    # DCA-specific fields
    if r.get("avg_entry_price"):
        payload["avg_entry_price"] = r["avg_entry_price"]
        payload["btc_accumulated"] = r["btc_accumulated"]

    body = {
        "strategy": r["strategy"],
        "params": r["params"],
        "date_from": "2025-09-30",
        "date_to": "2026-07-26",
        "total_return": r.get("total_return"),
        "sharpe_ratio": r.get("sharpe_ratio"),
        "max_drawdown": r.get("max_drawdown"),
        "win_rate": r.get("win_rate"),
        "n_trades": r.get("n_trades"),
        "payload": payload,
    }

    resp = requests.post(API, json=body, headers=HEADERS)
    result = resp.json()
    status = "OK" if result.get("success") else f"ERR: {result.get('error')}"
    rid = result.get("data", {}).get("id", "?") if isinstance(result.get("data"), dict) else "?"
    print(f'{r["strategy"]}: HTTP {resp.status_code} {status} (id={rid})')
