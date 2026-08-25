#!/usr/bin/env python3
"""Export a real TESS light curve to CSV, so starfold ships with real data.

Run with the ai_env python, which has lightkurve:
    ~/AI_Tools/ai_env/bin/python3 tools/fetch.py "WASP-18" data/wasp-18.csv

Nothing here removes the transit or tells the browser where it is. The CSV is
time and normalised flux and nothing else, exactly what a telescope hands you.
"""
import sys, warnings
warnings.filterwarnings("ignore")
import lightkurve as lk

target = sys.argv[1] if len(sys.argv) > 1 else "WASP-18"
out = sys.argv[2] if len(sys.argv) > 2 else "out.csv"

print("searching TESS for", target, flush=True)
s = lk.search_lightcurve(target, mission="TESS", exptime=120)
if len(s) == 0:
    sys.exit("no 2-minute TESS data for " + target)
print(" ", len(s), "observations, taking the first", flush=True)
lc = s[0].download().remove_nans().remove_outliers(sigma_upper=5, sigma_lower=20)
lc = lc.flatten(window_length=901)

t = lc.time.value
f = lc.flux.value
t0 = t.min()
with open(out, "w") as fh:
    fh.write("# " + target + ", TESS 2-minute cadence, " + str(s[0].mission[0]) + "\n")
    fh.write("# time is days from the first measurement, flux is normalised\n")
    fh.write("time,flux\n")
    for i in range(len(t)):
        fh.write("%.6f,%.7f\n" % (t[i] - t0, f[i]))
print("wrote", out, len(t), "points over %.1f days" % (t.max() - t.min()), flush=True)
