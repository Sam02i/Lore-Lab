"""Season-adjusted check for Lab Test results.

Question: is a sign's hit rate higher than chance *for the time of year it occurs in*?

The plain Lab Test compares a sign's hit rate with the overall base rate. If the sign
mostly shows up in the monsoon (when it rains more anyway), that comparison is unfair.
Here every sign day is compared with the base rate of ITS OWN calendar month.

Plain code, no model in the loop. Same rules as the Lab Test:
  Promising  only if the whole 95% Wilson interval sits above the month-matched expectation
  Backfires  only if it sits below
  Same as chance otherwise
"""
import numpy as np
import pandas as pd

from backtest import build_days, sign_mask, wilson
from config import MIN_N_BACKTEST, WINDOW_H


def season_check(df, variable, feature, threshold, window_h=WINDOW_H, n_perm=5000, seed=0):
    days = build_days(df, window_h)
    mask = sign_mask(days, variable, feature, threshold)
    month = days.index.month

    # Month-matched base rate: how often it rains after ANY evening in that month.
    month_rate = days.groupby(month)["rain"].mean()
    expected_each = pd.Series(month_rate.reindex(month).to_numpy(), index=days.index)

    sign = days[mask]
    n = len(sign)
    k = int(sign["rain"].sum())
    overall_base = float(days["rain"].mean())
    if n < MIN_N_BACKTEST:
        return {"verdict": "On the trail", "n": n, "hits": k}

    expected_rate = float(expected_each[mask].mean())   # what chance predicts for these very days
    lo, hi = wilson(k, n)
    hit = k / n

    verdict = ("Promising" if lo > expected_rate else
               "Backfires" if hi < expected_rate else "Same as chance")

    # Permutation test: shuffle the sign labels WITHIN each month and see how often
    # chance alone gives at least as many hits.
    rng = np.random.default_rng(seed)
    rain = days["rain"].to_numpy()
    mask_arr = mask.to_numpy()
    groups = [np.where(month == m)[0] for m in np.unique(month)]
    counts = [int(mask_arr[g].sum()) for g in groups]
    hits_null = np.empty(n_perm)
    for i in range(n_perm):
        h = 0
        for g, c in zip(groups, counts):
            if c:
                h += rain[rng.choice(g, size=c, replace=False)].sum()
        hits_null[i] = h
    p_value = float((np.sum(hits_null >= k) + 1) / (n_perm + 1))

    # Per-month detail (sign days vs the rest of that month)
    rows = []
    for m in sorted(set(month[mask_arr])):
        in_m = month == m
        s = in_m & mask_arr
        r = in_m & ~mask_arr
        rows.append({"month": int(m), "sign_days": int(s.sum()),
                     "rain_with_sign": float(rain[s].mean()),
                     "rain_without_sign": float(rain[r].mean()) if r.any() else float("nan"),
                     "n_without": int(r.sum())})
    return {
        "verdict": verdict, "n": n, "hits": k, "hit_rate": hit, "ci": (lo, hi),
        "overall_base": overall_base, "month_matched_expected": expected_rate,
        "lift_vs_overall": hit / overall_base, "lift_vs_month_matched": hit / expected_rate,
        "p_value": p_value, "by_month": pd.DataFrame(rows),
        "sign_share_by_month": (sign.groupby(sign.index.month).size() / n).round(3).to_dict(),
    }


if __name__ == "__main__":
    import sys
    df = pd.read_csv(sys.argv[1], parse_dates=["time"], index_col="time")
    cases = [
        ("South wind (wind within 45° of S)", "wind_direction_10m", "none", 180.0),
        ("Mackerel sky (high cloud >= 80%)", "cloud_cover_high", "none", 80.0),
    ]
    for name, var, feat, thr in cases:
        r = season_check(df, var, feat, thr)
        print("=" * 70); print(name)
        for k, v in r.items():
            if k == "by_month":
                print(v.round(3).to_string(index=False))
            else:
                print(f"  {k}: {v}")