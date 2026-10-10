

MIN_N_BACKTEST = 30     # sign-present days needed before a Lab Test shows a hit rate or verdict
MIN_N_LIVE = 10         # sign-present looks (on different days) before a Field Test shows a verdict
RAIN_MM = 0.2           # total precipitation in the window that counts as "rain"
WINDOW_H = 12           # outcome window in hours; starts at the next full hour after the look
LOOK_HOUR = 18          # local hour a backtest "looks outside" (dusk)
HISTORY_YEARS = 10      # years of reanalysis used by the Lab Test
MAX_ATTEMPTS = 5        # tries before an unresolved look is marked failed