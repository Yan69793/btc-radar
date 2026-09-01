"""
BTC Radar — Motor de backtest puro (pandas/numpy).
Substitui VectorBT com simulacao de portfolio sem dependencias complexas.
"""

import numpy as np
import pandas as pd
from typing import Dict, Optional, Tuple


def simulate_portfolio(
    close: pd.Series,
    entries: pd.Series,
    exits: pd.Series,
    init_cash: float = 10_000.0,
    fees: float = 0.001,
) -> Dict:
    """
    Simula um portfolio com entradas e saidas nos precos de fechamento.

    Regras:
    - Entrada no close da barra de sinal se nao ha posicao ativa
    - Saida no close da barra de sinal se ha posicao ativa
    - Taxa de 0.1% na entrada E saida
    - Apenas 1 posicao por vez (sem piramide)
    """

    n = len(close)
    equity = np.full(n, np.nan)
    equity[0] = init_cash

    in_position = False
    cash = init_cash
    btc_qty = 0.0
    entry_price = 0.0
    entry_idx = -1

    trades = []
    equity_peak = init_cash
    peak_idx = 0
    max_drawdown_pct = 0.0
    max_drawdown_duration = 0
    current_drawdown_start = -1

    for i in range(n):
        price = close.iloc[i]

        # Marcar entrada
        if entries.iloc[i] and not in_position and price > 0:
            entry_cost = cash * (1 - fees)
            btc_qty = entry_cost / price
            entry_price = price
            cash = 0.0
            in_position = True
            entry_idx = i

        # Marcar saida
        elif exits.iloc[i] and in_position and price > 0:
            exit_value = btc_qty * price * (1 - fees)
            pnl = exit_value - (btc_qty * entry_price)
            pnl_pct = (pnl / (btc_qty * entry_price)) * 100 if btc_qty * entry_price > 0 else 0

            trades.append({
                "entry_idx": entry_idx,
                "exit_idx": i,
                "entry_price": entry_price,
                "exit_price": price,
                "qty": btc_qty,
                "pnl_usd": pnl,
                "pnl_pct": pnl_pct,
                "bars_held": i - entry_idx,
                "win": pnl > 0,
            })

            cash = exit_value
            btc_qty = 0.0
            in_position = False

        # Equity atual
        if in_position:
            current_equity = btc_qty * price * (1 - fees)
        else:
            current_equity = cash

        equity[i] = current_equity

        # Drawdown tracking
        if current_equity > equity_peak:
            equity_peak = current_equity
            peak_idx = i
            current_drawdown_start = -1
        else:
            dd_pct = (1 - current_equity / equity_peak) * 100 if equity_peak > 0 else 0
            if dd_pct > max_drawdown_pct:
                max_drawdown_pct = dd_pct
            if current_drawdown_start < 0:
                current_drawdown_start = i
            if current_drawdown_start >= 0:
                duration = i - current_drawdown_start
                if duration > max_drawdown_duration:
                    max_drawdown_duration = duration

    # Fechar posicao no ultimo preco se ainda esta aberta
    if in_position:
        final_price = close.iloc[-1]
        exit_value = btc_qty * final_price * (1 - fees)
        pnl = exit_value - (btc_qty * entry_price)
        pnl_pct = (pnl / (btc_qty * entry_price)) * 100 if btc_qty * entry_price > 0 else 0
        trades.append({
            "entry_idx": entry_idx,
            "exit_idx": n - 1,
            "entry_price": entry_price,
            "exit_price": final_price,
            "qty": btc_qty,
            "pnl_usd": pnl,
            "pnl_pct": pnl_pct,
            "bars_held": n - 1 - entry_idx,
            "win": pnl > 0,
        })
        equity[-1] = exit_value

    # Metricas
    final_equity = equity[-1]
    total_return = ((final_equity / init_cash) - 1) * 100

    # Sharpe ratio (anualizado, base diaria)
    equity_series = pd.Series(equity, index=close.index).dropna()
    if len(equity_series) > 1:
        returns = equity_series.pct_change().dropna()
        ann_factor = np.sqrt(365)
        if returns.std() > 0:
            sharpe = (returns.mean() / returns.std()) * ann_factor
        else:
            sharpe = 0.0 if returns.mean() <= 0 else float("inf")
    else:
        sharpe = 0.0

    # Trade stats
    n_trades = len(trades)
    wins = [t for t in trades if t["win"]]
    losses = [t for t in trades if not t["win"]]
    win_rate = (len(wins) / n_trades * 100) if n_trades > 0 else 0

    gross_profit = sum(t["pnl_usd"] for t in wins) if wins else 0
    gross_loss = abs(sum(t["pnl_usd"] for t in losses)) if losses else 0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0)

    avg_trade_pct = np.mean([t["pnl_pct"] for t in trades]) if trades else 0
    best_trade = max(trades, key=lambda t: t["pnl_pct"]) if trades else None
    worst_trade = min(trades, key=lambda t: t["pnl_pct"]) if trades else None
    avg_bars_held = np.mean([t["bars_held"] for t in trades]) if trades else 0

    return {
        "total_return": round(total_return, 2),
        "sharpe_ratio": round(sharpe, 3) if np.isfinite(sharpe) else None,
        "max_drawdown": round(max_drawdown_pct, 2),
        "max_drawdown_duration": max_drawdown_duration,
        "win_rate": round(win_rate, 1),
        "n_trades": n_trades,
        "profit_factor": round(profit_factor, 2) if np.isfinite(profit_factor) else None,
        "avg_trade_pct": round(avg_trade_pct, 2),
        "best_trade_pct": round(best_trade["pnl_pct"], 2) if best_trade else None,
        "worst_trade_pct": round(worst_trade["pnl_pct"], 2) if worst_trade else None,
        "avg_bars_held": round(avg_bars_held, 1),
        "equity_curve": [round(float(e), 2) for e in equity],
        "trades": trades,
    }


def simulate_dca(
    close: pd.Series,
    entries: pd.Series,
    init_cash: float = 10_000.0,
    fees: float = 0.001,
) -> Dict:
    """
    Simula Dollar Cost Averaging: compra periodica de valor fixo, nunca vende.

    Cada sinal de entrada aloca uma fracao igual do capital total
    (init_cash / numero de entradas) na compra de BTC.
    """

    n = len(close)
    entry_indices = [i for i in range(n) if entries.iloc[i]]
    if not entry_indices:
        return {
            "total_return": 0.0,
            "sharpe_ratio": None,
            "max_drawdown": 0.0,
            "n_trades": 0,
            "error": "Nenhum sinal de entrada para DCA",
        }

    # Cada compra usa uma fracao igual do capital
    amount_per_buy = init_cash / len(entry_indices)
    btc_qty = 0.0
    total_invested = 0.0
    purchases = []

    equity = np.full(n, np.nan)
    equity[0] = init_cash
    cash = init_cash
    equity_peak = init_cash
    max_drawdown_pct = 0.0

    for i in range(n):
        price = close.iloc[i]

        # Compra periodica no sinal
        if i in entry_indices and price > 0 and cash >= amount_per_buy:
            buy_amount = min(amount_per_buy, cash) * (1 - fees)
            qty = buy_amount / price
            btc_qty += qty
            cash -= amount_per_buy
            total_invested += amount_per_buy
            purchases.append({
                "idx": i,
                "price": price,
                "qty": qty,
                "amount": amount_per_buy,
            })

        # Equity = cash + valor atual do BTC
        current_equity = cash + btc_qty * price
        equity[i] = current_equity

        # Drawdown
        if current_equity > equity_peak:
            equity_peak = current_equity
        else:
            dd_pct = (1 - current_equity / equity_peak) * 100 if equity_peak > 0 else 0
            if dd_pct > max_drawdown_pct:
                max_drawdown_pct = dd_pct

    # Estatisticas finais
    final_price = close.iloc[-1]
    final_equity = cash + btc_qty * final_price
    total_return = ((final_equity / init_cash) - 1) * 100

    # Preco medio de entrada
    avg_entry = sum(p["amount"] for p in purchases) / sum(p["qty"] for p in purchases) if purchases else 0

    # Sharpe (base diaria, anualizado)
    equity_series = pd.Series(equity, index=close.index).dropna()
    if len(equity_series) > 1:
        returns = equity_series.pct_change().dropna()
        ann_factor = np.sqrt(365)
        sharpe = (returns.mean() / returns.std()) * ann_factor if returns.std() > 0 else 0.0
    else:
        sharpe = 0.0

    return {
        "total_return": round(total_return, 2),
        "sharpe_ratio": round(sharpe, 3) if np.isfinite(sharpe) else None,
        "max_drawdown": round(max_drawdown_pct, 2),
        "win_rate": None,  # DCA nao tem trades fechados
        "n_trades": len(purchases),
        "n_purchases": len(purchases),
        "profit_factor": None,
        "avg_entry_price": round(avg_entry, 2),
        "final_price": round(final_price, 2),
        "total_invested": round(total_invested, 2),
        "btc_accumulated": round(float(btc_qty), 8),
        "equity_curve": [round(float(e), 2) for e in equity],
        "purchases": purchases,
    }
