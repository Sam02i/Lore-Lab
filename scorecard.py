import sys
from backtest import wilson , build_days
from weather import geocode, fetch_history

MIN_N_LIVE = 10 # pre-committed sign-present looks for a live verdict

def what_would_count(n,base):
    #*Smallest number of hits out of n whose Wilson lower bound beats chance
    for k in range(n+1):
        if wilson(k,n)[0] > base:
            return k
    return None
    
def tally(hits,look,target):
    #? filled = rain followed, hollow = no rain, dot = look still needed

    return " ".join("●" * hits + "○" * (look - hits) + "·" * max(0, target - look))

def live_card(city, hits, look):
    name, lat, lon = geocode(city)
    days = build_days(fetch_history(lat, lon))
    base = days["rain"].mean()

    print(f"\n  Field notes · {name}")
    print(f"  Chance says rain follows on {base:.0%} of days here.")
    if look < MIN_N_LIVE:
        need = what_would_count(MIN_N_LIVE, base)
        print(f"  On the trail. {look} of {MIN_N_LIVE} looks.")
        print(f"  {tally(hits, look, MIN_N_LIVE)}   ({hits} of {look}: rain followed)")
        print(f"  At {MIN_N_LIVE} looks, rain would need to follow about {need} times to clearly beat chance")
        print(f"  {MIN_N_LIVE - look} more looks to a verdict. Look again at dusk.")
    else:
        lo, hi = wilson(hits, look)
        verdict = ("Promising" if lo > base else
                "Backfires" if hi < base else "Same as chance")
        print(f"  {verdict}: {hits} of {look} ({hits / look:.0%}), "
            f"95% CI {lo:.0%} to {hi:.0%}")
    print("  One place and a short history is a hint, not proof.\n")


if __name__ == "__main__":
    # usage: python scorecard.py <hits> <looks> <city...>
    live_card(" ".join(sys.argv[3:]) or "Pune", int(sys.argv[1]), int(sys.argv[2]))