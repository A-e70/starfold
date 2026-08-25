# starfold

Find a planet in real telescope data, in your browser. No server, no library,
no build step. Load a light curve, search every plausible period, fold the
measurements onto the best one, and the transit appears.

![starfold finding WASP-18 b in real TESS data](docs/starfold.png)

## What it does

1. **Loads a light curve.** Three real TESS light curves ship with it: WASP-18,
   HD 209458 and the multi planet system TOI-270. Two minute cadence, straight
   from the mission archive. Or drop in your own CSV of time and flux.
2. **Searches for a box.** Box Least Squares (Kovacs, Zucker and Mazeh 2002).
   For every trial period the measurements are folded and binned, then every
   box position and width is scored on how much variance it explains. A transit
   is the only thing in a light curve that is both periodic and box shaped.
3. **Folds and shows you.** The periodogram, the folded curve, the fitted box,
   and the numbers that come out of it.

4. **Decides whether to believe it.** Odd transits against even ones, an
   eclipse half an orbit later, and a limb darkened fit for the radius, the
   impact parameter and the orbit size.

On the bundled data it recovers **0.94149 days** against the published
**0.94145** for WASP-18 b, and a planet radius of **1.157 Jupiters** against
1.165 published. On TOI-270 it finds two of the system's planets.

## Checked against published values

Both light curves are a single TESS sector, so this is what one month of one
telescope supports, not what a published analysis of years of data gets.

| quantity | starfold | published |
|---|---|---|
| **WASP-18 b** | | |
| period | 0.94148 d | 0.94145 d |
| duration, first to fourth contact | 2.130 h | 2.14 h |
| Rp / Rstar, fitted | 0.09439 | 0.0972 |
| impact parameter b | 0.398 | 0.36 |
| a / Rstar | 3.40 | 3.48 |
| **HD 209458 b** | | |
| period | 3.52403 d | 3.52475 d |
| duration, first to fourth contact | 3.141 h | 3.0 h |
| Rp / Rstar, fitted | 0.12027 | 0.1209 |
| impact parameter b | 0.529 | 0.507 |
| a / Rstar | 8.50 | 8.76 |

The period lands to about one part in a thousand and the radius ratio to about
three per cent. The impact parameter and a/Rstar are the weak pair, within about
twenty per cent, because they trade against each other: a larger planet crossing
near the edge makes nearly the same dip as a smaller one crossing the middle,
and only the shape of the shoulders tells them apart.

`node tools/check.js` asserts every one of these and fails if it moves.

## Finding a dip is the easy half

Most dips are not planets. starfold runs the three checks a survey runs before
anyone claims a detection, and shows the verdict with its reasoning.

**Odd against even transits.** A planet gives the same depth every time. An
eclipsing binary at twice the fitted period alternates between a deep primary
and a shallow secondary, so the two sets disagree. The depth of each transit is
measured separately and the two sets are compared using the scatter between
transits, not the noise on a single measurement. That distinction matters: the
naive version called WASP-18 b a thirty sigma failure. It is a planet.

**An eclipse half an orbit later.** A companion that gives off its own light
disappears behind the star and the total dims again. If that second dip is
comparable to the transit, the companion is a star. On WASP-18 the check finds a
real one at 178 ppm, which is 1.8 per cent of the transit and far too shallow
for a star. That is the planet's own heat, and WASP-18 b is hot enough to show
it. Published analyses fit a full eclipse model and get a deeper value than this
window does.

**Sloped sides.** The box duration is always too short. Fitting a trapezoid
recovers the real first to fourth contact time and the length of the flat part.
WASP-18 comes out at 2.130 hours against 2.14 published, HD 209458 at 3.144
against about 3.0. A floor that is barely flat means a grazing crossing or two
stars.

The verdict needs both significance and size before it rejects anything. With a
bright star a half per cent difference is many sigma and means nothing physical,
while a real binary alternates by tens of per cent.

## More than one planet

Real systems have several. After a transit is found, its points are cut out and
the search runs again on what is left, up to as many passes as you ask for. On
TOI-270 that recovers **TOI-270 b at 3.3610 days** against 3.3601 published,
alongside its larger sibling. The system's third planet is at 11.38 days and
cannot repeat inside a 20 day baseline, so it is correctly not found.

The hard part is not the masking, it is knowing when you have found the same
thing twice. Over a short baseline a period is only good to a per cent or two,
so cutting one version out leaves its neighbours standing and the same planet
turns up again at a slightly different period. Two things address that:

- The winning frequency is **refined on a grid a hundred times finer** than the
  periodogram before anything is cut. This alone moved HD 209458 b from 3.52681
  to 3.52403 days against 3.52475 published, and its impact parameter from 0.60
  to 0.53 against 0.507.
- A period within four per cent of an earlier one, or at a **simple multiple**
  of it, is labelled the same object rather than counted as a new planet.

A candidate below the detection threshold is reported and then the search stops.
Digging past it only produces noise dressed as planets.

## Running it

```
./serve.sh          # then open http://127.0.0.1:8080
```

It needs http rather than a file:// URL, because the search runs in a Web
Worker and the demo data is fetched. Nothing leaves your machine.

## Your own data

A CSV with two columns, time in days and normalised flux. Comment lines
starting with `#` and a header row are both skipped.

```
time,flux
0.000000,1.0001240
0.001389,0.9998733
```

`tools/fetch.py` will build one from any TESS target, using lightkurve:

```
~/AI_Tools/ai_env/bin/python3 tools/fetch.py "HD 209458" data/hd-209458.csv
```

That script is the only part that touches the network, and it is not needed to
use the tool.

## What it is honest about

The tool says all of this on its own face, because a number without its caveat
is worse than no number.

- A box search lands on **twice or half** the true period as often as not.
- **Detection strength** below about 7 sigma is not a detection.
- The fitted **duration comes out short**, because a real transit has sloped
  sides and a box does not.
- **b and a/Rstar trade against each other.** The fit separates them only by the
  shape of the shoulders, so those two are the least trustworthy numbers it
  gives you.
- **Limb darkening is yours to set.** u1 and u2 depend on the star and the
  wavelength. Wrong coefficients bias the radius.

## A real stellar disc

A star is brighter at the centre than at the edge, so a planet crossing the
middle blocks more than its share of the light and the depth alone overstates
its size. starfold fits a limb darkened model instead, integrating the hidden
light numerically over the planet and searching the radius ratio, the impact
parameter and the orbit size together.

Three things that cost real time to get right, all still visible in the code:

**The duration cannot be inherited.** The trapezoid width seeds the orbit size
but is not allowed to fix it. A trapezoid has straight sides and a real ingress
is curved, so its width comes out about two per cent short. Treating that two
per cent as exact was enough to force WASP-18 b to a dead central crossing, an
impact parameter of exactly zero against a published 0.36.

**Limb darkening is an input, not a constant.** u1 and u2 depend on the star and
on the wavelength observed. WASP-18 is an F6 star and much less limb darkened
than the Sun, and using solar coefficients on it biases the radius.

**The coefficients have to reach the search.** An edit adding them to the
regression silently failed, so the check ran WASP-18 with solar coefficients
while the interactive path used the right ones, and the two disagreed by five
per cent with neither being wrong. The check now asserts the fitted radius
against the published value, so it cannot drift quietly again.

## Speed

The search bins the measurements to ten minutes first. A transit lasts hours, so
this changes nothing about the shape and cuts the work by five: 18,299 points
becomes 3,727, and 4,000 trial periods take about three seconds instead of
seventeen. Set the bin to 0 to search every point.

The limb darkened fit is the slower half. Precomputing each point's orbital
angle once instead of recomputing it inside every trial, moving the fit onto
typed arrays and coarsening the grid to what the data actually supports took the
whole regression from 73 seconds to under 15, with identical results.

## Layout

| file | what it is |
|---|---|
| `index.html` | the whole interface, the plotting, and the wiring |
| `bls.js` | the period search and the vetting, in a worker |
| `tools/check.js` | headless regression on both planets, fit included |
| `tools/fetch.py` | builds a CSV from the TESS archive, the only networked part |
| `data/` | real light curves |
