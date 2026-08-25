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

## Second pass: vetting

Finding a dip turned out to be the easy half, so the tool now decides whether
the dip is a planet.

**Odd against even transits.** A binary at twice the fitted period alternates
deep and shallow. Measuring each transit separately and comparing the two sets
by the scatter between transits is the part that matters: the obvious version,
pooling every point and using the noise on a single measurement, called
WASP-18 b a thirty sigma failure. It is a planet. Error bars that assume only
white noise are wrong whenever the telescope drifts between one night and the
next.

**An eclipse half an orbit later.** On WASP-18 there is one, at 178 ppm, which
is 1.8 per cent of the transit. Far too shallow for a companion star. That is
the planet's own thermal emission, which WASP-18 b is hot enough to show.

**Sloped sides.** A trapezoid fit recovers the true duration the box search
underestimates: 2.130 hours against 2.14 published for WASP-18, 3.144 against
about 3.0 for HD 209458.

The verdict needs both significance and effect size. Half a per cent at five
sigma is a systematic, not a second star.

## Third pass: a real stellar disc

The depth alone assumes an evenly bright star, which no star is. Fitting a limb
darkened model instead, integrating the blocked light numerically over the
planet and searching radius ratio, impact parameter and orbit size together,
gets Rp/Rstar to about three per cent on both bundled planets: 0.12096 against
0.1209 published for HD 209458 b.

The bug worth writing up: I first let the trapezoid duration fix the orbit size.
A trapezoid has straight sides and a real ingress is curved, so it comes out
about two per cent short, and that two per cent was enough to force WASP-18 b to
a dead central crossing, b of exactly zero against a published 0.36. Letting the
scale float fixed it. A constraint that is nearly right is worse than one you
admit you do not have.

Second one, less interesting but more expensive: an edit that added the limb
darkening coefficients to the regression silently did not apply, so the check
ran one star with solar coefficients while the interactive path used the right
ones. Two runs of the same code disagreed by five per cent and neither was
wrong. Now the check asserts the fitted radius against the published value, so
it cannot drift quietly again.

Also made it fast enough to sit in front of: hoisting each point's orbital angle
out of the trial loop, typed arrays, and a grid no finer than the data supports
took the check from 73 seconds to under 15.
