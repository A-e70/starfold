# Stardance ship notes

**starfold** finds a planet in real telescope data, in a browser, with no server
and no library.

Give it a light curve and it runs a Box Least Squares search over every
plausible period, folds the measurements onto the best one and shows you the
transit. It ships with two real TESS light curves so there is nothing to
download and nothing invented.

On WASP-18 it returns a period of 0.94149 days against the published 0.94145,
and on HD 209458 it returns 3.52681 against 3.52475. The planet radii come out
at 1.19 and 1.36 Jupiters against 1.165 and 1.38 published.

Three things I would point at:

**The search is the project.** Box Least Squares in a Web Worker, about 120
lines. For every trial period the measurements are folded into phase bins and
every box position and width is scored on how much variance it explains. Boxes
that sit above the baseline are rejected, because a bump is a flare and only a
dip is a transit.

**Speed came from physics, not from micro-optimising.** A transit lasts hours,
so measurements every two minutes are far finer than the search needs. Binning
to ten minutes first turns 18,299 points into 3,727 and 4,000 trial periods drop
from seventeen seconds to three, with the answer unchanged to five decimal
places.

**Every number carries its caveat on the page.** The fitted duration comes out
short because a box has vertical sides and a real transit does not. The radius
assumes a central crossing and no limb darkening. A box search lands on twice or
half the true period as often as not. Those are written into the interface, not
hidden in a README.

Open source, no build step, one HTML file plus one worker.

## Checklist before submitting

- [ ] Hackatime running, so the hours exist. `~/scripts/setup-hackatime.sh KEY`
- [ ] Repo pushed public to github.com/A-e70/starfold
- [ ] Devlogs posted as you go, not written at the end
- [ ] README screenshot current
- [ ] `node tools/check.js` passes
