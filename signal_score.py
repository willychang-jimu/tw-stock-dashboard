"""
規則式進出場訊號評分
不依賴任何AI或外部付費服務，純粹用手算的技術指標（RSI/MACD/布林通道）
搭配既有的量能、法人、營收資料，算出一個分數與白話標籤。
"""
from support_levels import load_price_series, compute_support


def ema_series(values, period):
    """指數移動平均序列，第一個值直接用原始值當初始基準"""
    if not values:
        return []
    k = 2 / (period + 1)
    result = [values[0]]
    for v in values[1:]:
        result.append(v * k + result[-1] * (1 - k))
    return result


def compute_rsi(closes, period=14):
    """標準RSI(Wilder's Smoothing)，資料不足回傳None"""
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def compute_macd(closes, fast=12, slow=26, signal=9):
    """回傳MACD現況與近3日內是否出現黃金/死亡交叉，資料不足回傳None"""
    if len(closes) < slow + signal:
        return None
    ema_fast = ema_series(closes, fast)
    ema_slow = ema_series(closes, slow)
    macd_line = [f - s for f, s in zip(ema_fast, ema_slow)]
    signal_line = ema_series(macd_line, signal)
    hist = [m - s for m, s in zip(macd_line, signal_line)]

    recent_hist = hist[-4:]
    golden_cross = any(
        recent_hist[i - 1] < 0 and recent_hist[i] >= 0
        for i in range(1, len(recent_hist))
    )
    death_cross = any(
        recent_hist[i - 1] > 0 and recent_hist[i] <= 0
        for i in range(1, len(recent_hist))
    )

    return {
        "macd": round(macd_line[-1], 3),
        "signal": round(signal_line[-1], 3),
        "hist": round(hist[-1], 3),
        "golden_cross": golden_cross,
        "death_cross": death_cross,
    }


def compute_signal(code, closes, current_pct=None, volume_ratio=None,
                    net_buy=None, revenue_yoy=None, ma20=None, bb_lower=None):
    """核心評分函式，輸入單一股票的收盤價序列與當日其他指標，回傳分數/標籤/理由"""
    if len(closes) < 20:
        return None  # 資料天數不夠，無法計算布林通道跟MACD

    score = 0
    reasons = []

    rsi = compute_rsi(closes, 14)
    if rsi is not None:
        if rsi < 30:
            score += 2
            reasons.append(f"RSI{rsi:.0f}超賣")
        elif rsi < 40:
            score += 1
            reasons.append(f"RSI{rsi:.0f}偏弱")
        elif rsi > 70:
            score -= 2
            reasons.append(f"RSI{rsi:.0f}超買")
        elif rsi > 60:
            score -= 1
            reasons.append(f"RSI{rsi:.0f}偏強")

    macd_info = compute_macd(closes)
    if macd_info:
        if macd_info["golden_cross"]:
            score += 2
            reasons.append("MACD黃金交叉")
        if macd_info["death_cross"]:
            score -= 2
            reasons.append("MACD死亡交叉")

    if ma20 and bb_lower:
        bb_upper = 2 * ma20 - bb_lower  # 用 ma20/bb_lower 反推布林上軌，不用重算標準差
        current = closes[-1]
        if current <= bb_lower:
            score += 2
            reasons.append("觸及布林下軌(支撐)")
        elif current >= bb_upper:
            score -= 2
            reasons.append("觸及布林上軌(壓力)")

    if volume_ratio is not None and volume_ratio >= 2.0:
        if current_pct is not None and current_pct > 0:
            score += 1
            reasons.append("放量上漲")
        elif current_pct is not None and current_pct < 0:
            score -= 1
            reasons.append("放量下跌(出貨疑慮)")

    if net_buy is not None:
        if net_buy > 0:
            score += 1
            reasons.append("法人買超")
        elif net_buy < 0:
            score -= 1
            reasons.append("法人賣超")

    if revenue_yoy is not None:
        try:
            ry = float(revenue_yoy)
            if ry > 0:
                score += 1
                reasons.append(f"營收年增{ry:.0f}%")
            elif ry < -10:
                score -= 1
                reasons.append(f"營收年減{abs(ry):.0f}%")
        except (TypeError, ValueError):
            pass

    if score >= 4:
        label = "🟢強力買進"
    elif score >= 2:
        label = "🟡偏多觀察"
    elif score <= -4:
        label = "🔴出場訊號"
    elif score <= -2:
        label = "🟠偏空風險"
    else:
        label = "⚪中立"

    return {
        "score": score,
        "label": label,
        "reasons": reasons,
        "rsi": round(rsi, 1) if rsi is not None else None,
        "macd_golden_cross": macd_info["golden_cross"] if macd_info else None,
        "macd_death_cross": macd_info["death_cross"] if macd_info else None,
    }


def compute_all_signals(support_map, current_pct_map, volume_ratio_map,
                         net_buy_map, revenue_yoy_map):
    """掃全市場（只要price_history裡出現過的代號都算），回傳 {代號: 訊號資訊}"""
    series, dates_sorted = load_price_series()
    result = {}
    for code, price_by_date in series.items():
        closes = [price_by_date[d] for d in dates_sorted if d in price_by_date]
        if len(closes) < 20:
            continue
        support = support_map.get(code, {})
        info = compute_signal(
            code, closes,
            current_pct=current_pct_map.get(code),
            volume_ratio=volume_ratio_map.get(code),
            net_buy=net_buy_map.get(code),
            revenue_yoy=revenue_yoy_map.get(code),
            ma20=support.get("ma20"),
            bb_lower=support.get("bb_lower"),
        )
        if info:
            result[code] = info
    return result
