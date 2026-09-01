"""
BTC Radar — Backtest Runner
Busca dados OHLCV da API, executa estrategias com motor proprio,
salva resultados localmente e envia para o Worker D1.

Uso: python run.py [--strategy all|trend_following|rsi|macd|dca|bollinger]
                   [--days 365] [--api-url https://btc-radar.prospects-intel.workers.dev]
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Dict, Any, Optional

import numpy as np
import pandas as pd
import requests

from engine import simulate_portfolio, simulate_dca
from strategies import STRATEGIES


def fetch_ohlcv(api_url: str, days: int = 365) -> Optional[pd.DataFrame]:
    """Busca dados OHLCV diarios da API do OKX."""
    bar_url = f"{api_url}/api/price/history?interval=1d&limit={days}"
    try:
        resp = requests.get(bar_url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success") or not data.get("data"):
            print(f"  API retornou erro ou sem dados: {data.get('error', 'unknown')}")
            return None

        candles = data["data"]
        candles.sort(key=lambda c: c["timestamp"])

        df = pd.DataFrame(candles)
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.set_index("timestamp")
        df = df.rename(columns={
            "open": "open", "high": "high", "low": "low",
            "close": "close", "volume": "volume"
        })
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        df = df.dropna(subset=["open", "high", "low", "close"])
        print(f"  {len(df)} candles carregados ({df.index[0].date()} a {df.index[-1].date()})")
        return df
    except Exception as e:
        print(f"  Erro ao buscar OHLCV: {e}")
        return None


def run_strategy(
    df: pd.DataFrame,
    strategy_key: str,
    strategy_info: Dict[str, Any],
) -> Dict[str, Any]:
    """Executa uma estrategia com motor proprio e retorna metricas."""
    label = strategy_info["label"]
    params = strategy_info["params"].copy()
    fn = strategy_info["fn"]

    print(f"\n[{label}]")
    print(f"  Parametros: {params}")

    try:
        entries, exits = fn(df, **params)
    except Exception as e:
        print(f"  ERRO ao gerar sinais: {e}")
        return {"error": str(e), "strategy": strategy_key, "label": label, "params": params}

    n_entries = int(entries.sum())
    n_exits = int(exits.sum())
    print(f"  Entradas: {n_entries}, Saidas: {n_exits}")

    if n_entries == 0:
        return {
            "strategy": strategy_key,
            "label": label,
            "params": params,
            "n_trades": 0,
            "error": "Nenhum sinal de entrada gerado",
        }

    try:
        close = df["close"]

        # DCA usa motor proprio (acumulacao sem saidas)
        if strategy_key == "dca":
            result = simulate_dca(
                close=close,
                entries=entries,
                init_cash=10_000.0,
                fees=0.001,
            )
        else:
            result = simulate_portfolio(
                close=close,
                entries=entries,
                exits=exits,
                init_cash=10_000.0,
                fees=0.001,
            )

        # Buy & Hold benchmark
        bh_return = float(((close.iloc[-1] / close.iloc[0]) - 1) * 100)

        print(f"  Return: {result['total_return']:.2f}% (B&H: {bh_return:.2f}%)")
        print(f"  Sharpe: {result['sharpe_ratio']}, MaxDD: {result['max_drawdown']}%")
        print(f"  Win Rate: {result.get('win_rate')}, Trades: {result['n_trades']}, PF: {result.get('profit_factor')}")
        if result.get("best_trade_pct") is not None:
            print(f"  Best: {result['best_trade_pct']}%, Worst: {result['worst_trade_pct']}%, Avg Hold: {result.get('avg_bars_held', 'N/A')}d")
        if result.get("avg_entry_price"):
            print(f"  Preco Medio: {result['avg_entry_price']}, BTC Acumulado: {result.get('btc_accumulated')}")

        output = {
            "strategy": strategy_key,
            "label": label,
            "params": params,
            "total_return": result["total_return"],
            "sharpe_ratio": result["sharpe_ratio"],
            "max_drawdown": result["max_drawdown"],
            "win_rate": result.get("win_rate"),
            "n_trades": result["n_trades"],
            "profit_factor": result.get("profit_factor"),
            "avg_trade_pct": result.get("avg_trade_pct"),
            "best_trade_pct": result.get("best_trade_pct"),
            "worst_trade_pct": result.get("worst_trade_pct"),
            "buy_hold_return": round(bh_return, 2),
            "alpha": round(result["total_return"] - bh_return, 2),
        }
        # Campos especificos DCA
        if result.get("avg_entry_price"):
            output["avg_entry_price"] = result["avg_entry_price"]
            output["btc_accumulated"] = result["btc_accumulated"]
        return output

    except Exception as e:
        print(f"  ERRO no backtest: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e), "strategy": strategy_key, "label": label, "params": params}


def save_results(results: list, output_dir: str) -> str:
    """Salva resultados em JSON."""
    os.makedirs(output_dir, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = os.path.join(output_dir, f"backtest_{ts}.json")
    payload = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "results": results,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResultados salvos em: {path}")
    return path


def main():
    parser = argparse.ArgumentParser(description="BTC Radar Backtest Runner")
    parser.add_argument("--strategy", default="all",
                        choices=["all", "trend_following", "rsi", "macd", "dca", "bollinger"])
    parser.add_argument("--days", type=int, default=365, help="Dias de historico (default: 365)")
    parser.add_argument("--api-url", default="https://btc-radar.prospects-intel.workers.dev",
                        help="URL da API worker")
    parser.add_argument("--output", default="./results", help="Diretorio de saida")
    args = parser.parse_args()

    print("=" * 60)
    print("BTC Radar — Backtest Runner")
    print(f"API: {args.api_url}")
    print(f"Periodo: {args.days} dias")
    print(f"Estrategia: {args.strategy}")
    print("=" * 60)

    # Buscar dados
    print("\n[OHLCV] Buscando dados...")
    df = fetch_ohlcv(args.api_url, args.days)
    if df is None or len(df) < 20:
        print("ERRO: Dados insuficientes para backtesting (min 20 candles)")
        sys.exit(1)

    # Executar estrategias
    if args.strategy == "all":
        strategies_to_run = list(STRATEGIES.items())
    else:
        strategies_to_run = [(args.strategy, STRATEGIES[args.strategy])]

    results = []
    for key, info in strategies_to_run:
        result = run_strategy(df, key, info)
        results.append(result)

    # Salvar
    path = save_results(results, args.output)

    # Resumo
    print("\n" + "=" * 60)
    print("RESUMO")
    print("=" * 60)
    for r in results:
        if "error" in r and r.get("n_trades", -1) == -1:
            print(f"  {r['label']}: ERRO — {r['error']}")
        elif r.get("n_trades", 0) == 0:
            print(f"  {r['label']}: SEM SINAIS")
        else:
            alpha_str = f"{r.get('alpha', 0):+.2f}%" if r.get('alpha') is not None else "---"
            pf_str = f"PF {r['profit_factor']}" if r.get('profit_factor') is not None else "PF ---"
            sr_str = f"Sharpe {r['sharpe_ratio']}" if r.get('sharpe_ratio') is not None else "Sharpe ---"
            print(f"  {r['label']}: {r['total_return']:.2f}% | {sr_str} | "
                  f"MaxDD {r['max_drawdown']}% | WR {r['win_rate']}% | "
                  f"Trades {r['n_trades']} | {pf_str} | "
                  f"Alpha {alpha_str}")


if __name__ == "__main__":
    main()
