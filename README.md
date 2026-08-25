# starfold

Find a planet in real telescope data, in your browser. No server, no library,
no build step. Load a light curve, search every plausible period, fold the
measurements onto the best one, and the transit appears.

![starfold finding WASP-18 b in real TESS data](docs/starfold.png)

## What it does

1. **Loads a light curve.** WASP-18 as observed by TESS ships with it: 18,299
   brightness measurements over 27.4 days, two minute cadence, real data from
   the mission archive. Or drop in your own CSV of time and flux.
2. **Searches for a box.** Box Least Squares (Kovacs, Zucker and Mazeh 2002).
   For every trial period the measurements are folded and binned, then every
   box position and width is scored on how much variance it explains. A transit
   is the only thing in a light curve that is both periodic and box shaped.
3. **Folds and shows you.** The periodogram, the folded curve, the fitted box,
   and the numbers that come out of it.

On the bundled data it recovers **0.94149 days** against the published
**0.94145** for WASP-18 b, a depth of 0.94 per cent, and a planet radius of
1.19 Jupiters against 1.165 published.

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
- The **radius assumes a central crossing and no limb darkening**. Both make the
  real planet bigger than the depth alone suggests.

## Speed

The search bins the measurements to ten minutes first. A transit lasts hours, so
this changes nothing about the shape and cuts the work by five: 18,299 points
becomes 3,727, and 4,000 trial periods take about three seconds instead of
seventeen. Set the bin to 0 to search every point.

## Layout

| file | what it is |
|---|---|
| `index.html` | the whole interface, the plotting, and the wiring |
| `bls.js` | the period search and the vetting, in a worker |
| `tools/check.js` | headless regression on both bundled planets |
| `tools/fetch.py` | builds a CSV from the TESS archive, the only networked part |
| `data/` | real light curves |
