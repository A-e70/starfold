# starfold

Three rules.

0. **The check is the contract.** Three real light curves with published
   answers. Never widen a tolerance to make it pass.
1. **No dependencies and no build step.** One HTML file, one worker, one Python
   helper that is optional. If something needs npm it does not belong here.
2. **Real data or clearly labelled.** Everything in `data/` came from the TESS
   archive through `tools/fetch.py` and is unmodified apart from normalisation.
   Never ship a synthetic curve without saying so on the page.
3. **Every number carries its caveat on the page.** The box duration is short,
   the radius assumes a central crossing, the period may be a harmonic. These
   are written in the interface, not buried in a README, and they stay there.

## Shape

`bls.js` is the search and knows nothing about the DOM. It decimates in time
first (`decimate`), folds into phase bins, then scores every box position and
width by `s^2 / (r(1-r))`, rejecting boxes that sit above the baseline because
those are flares, not transits. It reports the periodogram, the best period, the
depth, the box width as a fraction of the period, the phase of the box centre,
and the peak's height above the periodogram noise in sigma.

`index.html` holds the plotting, which is plain canvas with a shared `axes()`
helper, and the wiring. `PAD` controls plot margins and the y axis label is
drawn rotated at `PAD.l - 65`, so if you widen the tick labels widen `PAD.l`
too or they collide.

## Before claiming it works

`node tools/check.js` runs the whole pipeline headless on all three bundled
light curves and asserts against the published values, not against whatever the
code last printed: period, duration, the fitted radius ratio and a/Rstar, that
neither real planet is rejected by the vetting, and that TOI-270 yields two
distinct planets with TOI-270 b among them. It takes about half a minute.

If a change moves any of those, the change is wrong or the tolerance is a lie.
Widening a tolerance to make the check pass is the one edit never to make here.

The browser matters separately. Console errors do not show up in the node check:

    ./serve.sh 8792 &
    bd inspect "http://127.0.0.1:8792/index.html"
