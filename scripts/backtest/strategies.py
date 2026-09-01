"""
BTC Radar — Estrategias de backtesting com VectorBT.
Cada funcao recebe um DataFrame com colunas OHLCV e retorna
entries (bool Series) e exits (bool Series) para VectorBT.
"""

import pandas as pd
import numpy as np
from typing import Tuple, Dict, Any


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(closes: pd.Series, period: int = 14) -> pd.Series:
    delta = closes.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def macd(closes: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False).mean()


# ═══════════════════════════════════════════
# Estrategia 1: Trend Following (EMA Cross)
# ═══════════════════════════════════════════

def trend_following(df: pd.DataFrame, fast: int = 50, slow: int = 200) -> Tuple[pd.Series, pd.Series]:
    """
    Compra quando EMA rapida cruza acima da lenta.
    Vende quando cruza abaixo.
    """
    close = df["close"]
    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)

    entries = (ema_fast > ema_slow) & (ema_fast.shift(1) <= ema_slow.shift(1))
    exits = (ema_fast < ema_slow) & (ema_fast.shift(1) >= ema_slow.shift(1))

    return entries, exits


# ═══════════════════════════════════════════
# Estrategia 2: RSI Extremos
# ═══════════════════════════════════════════

def rsi_extreme(df: pd.DataFrame, period: int = 14, oversold: int = 30, overbought: int = 70) -> Tuple[pd.Series, pd.Series]:
    """
    Compra quando RSI cruza acima do oversold.
    Vende quando RSI cruza abaixo do overbought.
    """
    close = df["close"]
    rsi_series = rsi(close, period)

    entries = (rsi_series > oversold) & (rsi_series.shift(1) <= oversold)
    exits = (rsi_series < overbought) & (rsi_series.shift(1) >= overbought)

    return entries, exits


# ═══════════════════════════════════════════
# Estrategia 3: MACD Cross
# ═══════════════════════════════════════════

def macd_cross(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[pd.Series, pd.Series]:
    """
    Compra quando MACD cruza acima da linha de sinal.
    Vende quando cruza abaixo.
    """
    close = df["close"]
    macd_line, signal_line, _ = macd(close, fast, slow, signal)

    entries = (macd_line > signal_line) & (macd_line.shift(1) <= signal_line.shift(1))
    exits = (macd_line < signal_line) & (macd_line.shift(1) >= signal_line.shift(1))

    return entries, exits


# ═══════════════════════════════════════════
# Estrategia 4: DCA (Dollar Cost Average)
# ═══════════════════════════════════════════

def dca(df: pd.DataFrame, interval_days: int = 7) -> Tuple[pd.Series, pd.Series]:
    """
    Compra recorrente a cada N dias. Nunca vende (longo prazo).
    Retorna entradas periodicas, sem saidas.
    """
    entries = pd.Series(False, index=df.index)
    entries.iloc[::interval_days] = True
    exits = pd.Series(False, index=df.index)
    return entries, exits


# ═══════════════════════════════════════════
# Estrategia 5: Fear & Greed Contrarian
# ═══════════════════════════════════════════

def fear_greed_contrarian(
    df: pd.DataFrame,
    fear_greed_index: pd.Series,
    buy_threshold: int = 25,
    sell_threshold: int = 75
) -> Tuple[pd.Series, pd.Series]:
    """
    Compra quando Fear & Greed < buy_threshold (medo extremo).
    Vende quando Fear & Greed > sell_threshold (ganancia).
    """
    entries = fear_greed_index < buy_threshold
    exits = fear_greed_index > sell_threshold
    return entries, exits


# ═══════════════════════════════════════════
# Estrategia 6: Bollinger Bands Mean Reversion
# ═══════════════════════════════════════════

def bollinger_mean_reversion(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> Tuple[pd.Series, pd.Series]:
    """
    Compra quando preco toca banda inferior.
    Vende quando preco toca banda superior.
    """
    close = df["close"]
    middle = sma(close, period)
    std = close.rolling(window=period).std()
    upper = middle + std_dev * std
    lower = middle - std_dev * std

    entries = close <= lower
    exits = close >= upper

    return entries, exits


# ═══════════════════════════════════════════
# Mapa de estrategias
# ═══════════════════════════════════════════

STRATEGIES: Dict[str, Dict[str, Any]] = {
    "trend_following": {
        "fn": trend_following,
        "label": "Trend Following (EMA Cross)",
        "params": {"fast": 50, "slow": 200},
    },
    "rsi": {
        "fn": rsi_extreme,
        "label": "RSI Extremos",
        "params": {"period": 14, "oversold": 30, "overbought": 70},
    },
    "macd": {
        "fn": macd_cross,
        "label": "MACD Cross",
        "params": {"fast": 12, "slow": 26, "signal": 9},
    },
    "dca": {
        "fn": dca,
        "label": "DCA (Dollar Cost Average)",
        "params": {"interval_days": 7},
    },
    "bollinger": {
        "fn": bollinger_mean_reversion,
        "label": "Bollinger Bands Mean Reversion",
        "params": {"period": 20, "std_dev": 2.0},
    },
}
