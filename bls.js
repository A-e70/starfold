// Box Least Squares period search, Kovacs, Zucker and Mazeh 2002.
//
// A transit is a box: the star sits at one level, drops to a lower level for a
// short while, and comes back. This searches every plausible period for the
// box that explains the most variance, which is the only thing that makes a
// transit stand out from noise that has no period at all.
//
// Runs in a worker because it is a few tens of millions of operations and the
// page must stay alive underneath it.

// Averaging the measurements into coarser time bins before searching. A TESS
// point every two minutes is far finer than any transit needs: a transit lasts
// hours, so ten minute bins keep the shape and cut the work by five. The full
// resolution data is still what gets drawn at the end.
function decimate(t, y, dt) {
   const n = t.length;
   const t0 = t[0];
   const nb = Math.max(1, Math.ceil((t[n - 1] - t0) / dt) + 1);
   const sy = new Float64Array(nb), st = new Float64Array(nb);
   const c = new Int32Array(nb);
   for (let i = 0; i < n; i++) {
      const b = Math.min(nb - 1, ((t[i] - t0) / dt) | 0);
      sy[b] += y[i]; st[b] += t[i]; c[b]++;
   }
   let m = 0;
   for (let b = 0; b < nb; b++) { if (c[b] > 0) { m++; } }
   const ot = new Float64Array(m), oy = new Float64Array(m);
   let j = 0;
   for (let b = 0; b < nb; b++) {
      if (c[b] > 0) { ot[j] = st[b] / c[b]; oy[j] = sy[b] / c[b]; j++; }
   }
   return { t: ot, y: oy };
}

function fold(t, y, w, freq, nbins, binSum, binW) {
   binSum.fill(0);
   binW.fill(0);
   for (let i = 0; i < t.length; i++) {
      let ph = t[i] * freq;
      ph -= Math.floor(ph);
      const b = (ph * nbins) | 0;
      binSum[b] += w * y[i];
      binW[b] += w;
   }
}

// One pass of the whole pipeline over whatever data it is handed. Called once
// per planet: after each detection the transit is cut out and this runs again
// on what is left, which is how a survey finds the second and third planet in a
// system rather than stopping at the loudest one.
function searchOne(d, ft, fy) {
   const dec = d.binMinutes > 0
      ? decimate(ft, fy, d.binMinutes / (24 * 60))
      : { t: ft, y: fy };
   const t = dec.t;
   const yin = dec.y;
   const N = t.length;

   // Centre the flux. BLS wants deviations from the out of transit level.
   let mean = 0;
   for (let i = 0; i < N; i++) { mean += yin[i]; }
   mean /= N;
   const y = new Float64Array(N);
   for (let i = 0; i < N; i++) { y[i] = yin[i] - mean; }

   const w = 1 / N;
   const nbins = d.nbins;
   const binSum = new Float64Array(nbins);
   const binW = new Float64Array(nbins);

   const minW = Math.max(1, Math.floor(d.minDur * nbins));
   const maxW = Math.max(minW + 1, Math.ceil(d.maxDur * nbins));

   const nf = d.nfreq;
   const fmin = 1 / d.pmax;
   const fmax = 1 / d.pmin;
   const df = (fmax - fmin) / (nf - 1);

   const periods = new Float64Array(nf);
   const power = new Float64Array(nf);

   let bestSR = -1, bestI = -1, bestStart = 0, bestWidth = 0, bestS = 0, bestR = 0;
   let bestFreq = 0;
   const step = Math.max(1, Math.floor(nf / 50));

   // Score one trial frequency: fold, then try every box position and width.
   function score(freq) {
      fold(t, y, w, freq, nbins, binSum, binW);
      let localBest = 0, lStart = 0, lWidth = 0, lS = 0, lR = 0;
      for (let i = 0; i < nbins; i++) {
         let s = 0, r = 0;
         for (let n = 0; n < maxW; n++) {
            const j = i + n;
            s += binSum[j >= nbins ? j - nbins : j];
            r += binW[j >= nbins ? j - nbins : j];
            if (n + 1 < minW) { continue; }
            if (r <= 0 || r >= 1) { continue; }
            // Only a dip is a transit. A box that sits above the baseline is a
            // flare or a systematic, and is not what we are looking for.
            if (s >= 0) { continue; }
            const sr = (s * s) / (r * (1 - r));
            if (sr > localBest) {
               localBest = sr; lStart = i; lWidth = n + 1; lS = s; lR = r;
            }
         }
      }
      return { sr: localBest, start: lStart, width: lWidth, s: lS, r: lR };
   }

   for (let k = 0; k < nf; k++) {
      const freq = fmin + k * df;
      periods[k] = 1 / freq;
      const q1 = score(freq);
      power[k] = Math.sqrt(q1.sr);
      if (q1.sr > bestSR) {
         bestSR = q1.sr; bestI = k; bestFreq = freq;
         bestStart = q1.start; bestWidth = q1.width; bestS = q1.s; bestR = q1.r;
      }
      if (k % step === 0) {
         self.postMessage({ kind: "progress", done: k, total: nf });
      }
   }

   // The grid is too coarse to mask on. Over a short baseline a peak found to
   // one part in fifty is a period wrong by two per cent, and after three or
   // four orbits the cut window has slid clear of the transit it was meant to
   // remove. That is how the same planet gets found twice. So the winning
   // frequency is refined on a grid a hundred times finer before anything is
   // done with it. The periodogram above keeps its original resolution: this
   // refinement is about the answer, not the picture.
   if (bestI >= 0) {
      let lo = bestFreq - df, hi = bestFreq + df;
      for (let pass = 0; pass < 2; pass++) {
         const NR = 60, dfr = (hi - lo) / NR;
         let rBest = bestSR, rFreq = bestFreq;
         let rS = bestStart, rW = bestWidth, rSs = bestS, rRr = bestR;
         for (let k = 0; k <= NR; k++) {
            const f = lo + k * dfr;
            if (f <= 0) { continue; }
            const q2 = score(f);
            if (q2.sr > rBest) {
               rBest = q2.sr; rFreq = f;
               rS = q2.start; rW = q2.width; rSs = q2.s; rRr = q2.r;
            }
         }
         bestSR = rBest; bestFreq = rFreq;
         bestStart = rS; bestWidth = rW; bestS = rSs; bestR = rRr;
         lo = bestFreq - dfr; hi = bestFreq + dfr;
      }
   }

   // Depth of the best fitting box, and where its centre falls in phase.
   const depth = -bestS / (bestR * (1 - bestR));
   const period = 1 / bestFreq;
   const q = bestWidth / nbins;
   const phaseCentre = ((bestStart + bestWidth / 2) % nbins) / nbins;

   // How far above the surrounding noise the peak sits. A real detection is
   // tall compared to the scatter of the rest of the periodogram.
   let pm = 0;
   for (let k = 0; k < nf; k++) { pm += power[k]; }
   pm /= nf;
   let pv = 0;
   for (let k = 0; k < nf; k++) { const dd = power[k] - pm; pv += dd * dd; }
   const psd = Math.sqrt(pv / nf);
   const sde = psd > 0 ? (power[bestI] - pm) / psd : 0;

   self.postMessage({ kind: "stage", text: "checking whether it is a planet" });
   const checks = vet(ft, fy, period, phaseCentre, q);
   checks.harmonics = harmonics(periods, power, bestI);
   if (checks.ok && checks.trapT14) {
      self.postMessage({ kind: "stage", text: "fitting a limb darkened star" });
      checks.ld = ldfit(ft, fy, period, phaseCentre,
                        checks.trapT14 / period, checks.trapDepth,
                        d.u1 === undefined ? 0.40 : d.u1,
                        d.u2 === undefined ? 0.25 : d.u2);
   }

   return {
      vet: checks,
      periods: periods, power: power,
      period: period, depth: depth, q: q,
      duration: q * period, phaseCentre: phaseCentre, sde: sde,
      searched: N, remaining: ft.length,
      mean: mean
   };
}

self.onmessage = function (e) {
   const d = e.data;
   const maxP = d.maxPlanets > 0 ? d.maxPlanets : 1;
   const minSde = d.minSde > 0 ? d.minSde : 7;
   let ft = d.t, fy = d.y;
   const accepted = [];

   for (let p = 0; p < maxP; p++) {
      self.postMessage({
         kind: "stage",
         text: p === 0 ? "searching every period"
                       : "searching again with " + p +
                         (p === 1 ? " transit" : " transits") + " cut out"
      });
      const r = searchOne(d, ft, fy);
      if (!r) { break; }
      r.kind = "planet";
      r.index = p + 1;

      // Is this actually a new planet, or the same signal again? When a
      // baseline holds only three transits the period is not pinned down, and
      // cutting one alias out leaves the others standing. A signal at nearly
      // the same period as an earlier one, or at a simple multiple of it, is
      // the same object and is labelled as such rather than counted twice.
      r.alias = null;
      for (let a = 0; a < accepted.length; a++) {
         const ratio = r.period / accepted[a].period;
         const cands = [1, 2, 0.5, 3, 1 / 3, 1.5, 2 / 3];
         for (let ci = 0; ci < cands.length; ci++) {
            if (Math.abs(ratio / cands[ci] - 1) < 0.04) {
               r.alias = { of: accepted[a].index, ratio: cands[ci] };
               break;
            }
         }
         if (r.alias) { break; }
      }
      // A signal that is not convincing on its own does not get to be a
      // planet, even when its period is new.
      r.convincing = r.sde >= minSde;
      if (!r.alias && r.convincing) {
         accepted.push({ index: r.index, period: r.period });
      }
      r.distinct = accepted.length;
      r.last = (p === maxP - 1) || r.sde < minSde;
      self.postMessage(r, [r.periods.buffer, r.power.buffer]);
      // A candidate that is not convincing on its own is reported and then the
      // search stops. Digging past it only produces noise dressed as planets.
      if (r.sde < minSde) { break; }

      // Cut this transit out and look at what is left. The window is a little
      // wider than the transit so the sloped edges go too, since leaving them
      // in gives the next pass a residual dip to lock onto.
      const halfPh = (r.vet && r.vet.ok && r.vet.trapT14
                        ? r.vet.trapT14 / r.period : r.q) * 0.75;
      const kt = new Float64Array(ft.length), ky = new Float64Array(ft.length);
      let m = 0;
      for (let i = 0; i < ft.length; i++) {
         const u = ft[i] / r.period - r.phaseCentre;
         const ph = u - Math.round(u);
         if (Math.abs(ph) > halfPh) { kt[m] = ft[i]; ky[m] = fy[i]; m++; }
      }
      if (m < 500) { break; }
      ft = kt.subarray(0, m); fy = ky.subarray(0, m);
   }
   self.postMessage({ kind: "done", distinct: accepted.length });
};

// ---------------------------------------------------------------------------
// Vetting.
//
// Finding a dip is the easy half. Most dips are not planets. These are the
// three checks a real survey runs before anyone claims a detection, and they
// all work on the full resolution data folded on the period just found.
// ---------------------------------------------------------------------------

function mean(a, n) { let s = 0; for (let i = 0; i < n; i++) { s += a[i]; } return s / n; }

function sd(a, n, m) {
   let v = 0;
   for (let i = 0; i < n; i++) { const d = a[i] - m; v += d * d; }
   return Math.sqrt(v / Math.max(1, n - 1));
}

function vet(t, y, period, phaseCentre, q) {
   const n = t.length;
   const half = q / 2;
   const core = half * 0.6;                       // avoid ingress and egress
   const outLo = half * 1.6;
   const outHi = Math.min(0.45, Math.max(half * 4, half * 1.6 + 0.02));

   // Odd and even transits separately. A planet gives the same depth every
   // time. An eclipsing binary at twice this period alternates between the
   // deep primary and the shallow secondary, so the two disagree.
   //
   // The depth of each transit is measured on its own first, and the two sets
   // are then compared using the scatter between transits. Doing it the other
   // way, pooling every point and using the noise on a single measurement,
   // gives error bars that are far too small: it assumes the only thing that
   // varies is white noise, when in practice the telescope drifts between one
   // transit and the next. That version called WASP-18 b a thirty sigma
   // failure, which it is not.
   const ep = {};
   const out = [];
   const secIn = [];
   for (let i = 0; i < n; i++) {
      const u = t[i] / period - phaseCentre;
      const e = Math.round(u);
      const ph = u - e;
      const ap = Math.abs(ph);
      if (ap < core || (ap > outLo && ap < outHi)) {
         if (!ep[e]) { ep[e] = { iS: 0, iN: 0, oS: 0, oN: 0 }; }
         if (ap < core) { ep[e].iS += y[i]; ep[e].iN++; }
         else { ep[e].oS += y[i]; ep[e].oN++; out.push(y[i]); }
      }
      let ps = ph + 0.5;
      if (ps > 0.5) { ps -= 1; }
      if (Math.abs(ps) < core) { secIn.push(y[i]); }
   }

   const nOut = out.length;
   if (nOut < 30) { return { ok: false, why: "not enough out of transit data" }; }
   const mOut = mean(out, nOut);
   const sOut = sd(out, nOut, mOut);           // the noise on a single point
   const eOut = sOut / Math.sqrt(nOut);

   const perT = [[], []];                      // depth of each transit, by parity
   const keys = Object.keys(ep);
   for (let i = 0; i < keys.length; i++) {
      const e = parseInt(keys[i], 10), b = ep[keys[i]];
      if (b.iN < 5 || b.oN < 10) { continue; }
      perT[((e % 2) + 2) % 2].push(b.oS / b.oN - b.iS / b.iN);
   }

   function group(a) {
      if (a.length < 1) { return null; }
      const m = mean(a, a.length);
      // With one or two transits there is no scatter to measure, so fall back
      // to the white noise estimate and say so through nTransits.
      const e = a.length >= 3
         ? sd(a, a.length, m) / Math.sqrt(a.length)
         : sOut / Math.sqrt(20);
      return { depth: m, err: e, n: a.length };
   }
   const dEven = group(perT[0]);
   const dOdd = group(perT[1]);
   const oddEven = (dEven && dOdd && (dEven.n + dOdd.n) >= 4)
      ? Math.abs(dEven.depth - dOdd.depth) /
        Math.sqrt(dEven.err * dEven.err + dOdd.err * dOdd.err)
      : null;

   function depthOf(arr) {
      if (arr.length < 5) { return null; }
      const m = mean(arr, arr.length);
      const e = Math.sqrt(sOut * sOut / arr.length + eOut * eOut);
      return { depth: mOut - m, err: e, n: arr.length };
   }

   const sec = depthOf(secIn);
   const secSigma = sec ? sec.depth / sec.err : null;

   // Trapezoid fit. The box search always returns a duration that is too short,
   // because a box has vertical sides. Fitting sloped sides recovers the real
   // first to fourth contact time, and the ratio of the flat part to the whole
   // says whether the crossing was central or grazing.
   const win = Math.min(0.45, half * 4);
   const px = [], py = [];
   for (let i = 0; i < n; i++) {
      const u = t[i] / period - phaseCentre;
      let ph = u - Math.round(u);
      if (Math.abs(ph) < win) { px.push(ph); py.push(y[i]); }
   }
   const m2 = px.length;
   let best = null;
   for (let a = 0; a < 26; a++) {
      const w14 = q * (0.5 + a * 0.1);           // total width, in phase
      const A = w14 / 2;
      if (A >= win) { break; }
      for (let b = 0; b < 20; b++) {
         const ratio = 0.03 + b * 0.05;          // flat part over total
         const B = A * ratio;
         // least squares for base and depth against the trapezoid shape
         let sff = 0, sf = 0, sfy = 0, sy = 0, sn = 0;
         for (let i = 0; i < m2; i++) {
            const p = Math.abs(px[i]);
            let f;
            if (p <= B) { f = 1; }
            else if (p >= A) { f = 0; }
            else { f = (A - p) / (A - B); }
            sff += f * f; sf += f; sfy += f * py[i]; sy += py[i]; sn++;
         }
         const det = sn * sff - sf * sf;
         if (Math.abs(det) < 1e-12) { continue; }
         const depth = (sf * sy - sn * sfy) / det;
         const base = (sy + depth * sf) / sn;
         if (depth <= 0) { continue; }
         let chi = 0;
         for (let i = 0; i < m2; i++) {
            const p = Math.abs(px[i]);
            let f;
            if (p <= B) { f = 1; }
            else if (p >= A) { f = 0; }
            else { f = (A - p) / (A - B); }
            const r = py[i] - (base - depth * f);
            chi += r * r;
         }
         if (best === null || chi < best.chi) {
            best = { chi: chi, w14: w14, ratio: ratio, depth: depth, base: base };
         }
      }
   }

   // Significance alone is not enough. With a bright star and a deep transit,
   // a difference of half a per cent is many sigma and means nothing physical.
   // A real eclipsing binary alternates by tens of per cent. Both the
   // significance and the size of the difference have to be large before the
   // test has found anything.
   const dm = (dEven && dOdd) ? (dEven.depth + dOdd.depth) / 2 : null;
   const oddEvenFrac = (dm && dm > 0)
      ? Math.abs(dEven.depth - dOdd.depth) / dm : null;

   const primary = best ? best.depth : null;
   const secRatio = (sec && primary && primary > 0) ? sec.depth / primary : null;

   return {
      ok: true,
      noise: sOut,
      oddEvenFrac: oddEvenFrac,
      secRatio: secRatio,
      depthEven: dEven ? dEven.depth : null,
      depthOdd: dOdd ? dOdd.depth : null,
      nEven: dEven ? dEven.n : 0,
      nOdd: dOdd ? dOdd.n : 0,
      oddEvenSigma: oddEven,
      secondaryDepth: sec ? sec.depth : null,
      secondarySigma: secSigma,
      trapT14: best ? best.w14 * period : null,
      trapRatio: best ? best.ratio : null,
      trapDepth: best ? best.depth : null,
      trapBase: best ? best.base : null
   };
}

// ---------------------------------------------------------------------------
// A real stellar disc.
//
// Everything above treats the star as evenly bright, which it is not. A star is
// brighter at the centre than at the edge, so a planet crossing the middle
// blocks more than its share of the light and the depth overstates its size.
// Fitting a limb darkened model instead gives the radius ratio and the impact
// parameter properly, and the two are not independent: a large planet crossing
// the edge makes almost the same dip as a small one crossing the centre. Only
// the shape of the shoulders tells them apart, which is why this is a fit and
// not a formula.
// ---------------------------------------------------------------------------

// Fraction of the star's light hidden by a disc of radius k whose centre sits
// d stellar radii from the centre of the star. Quadratic limb darkening,
// integrated numerically over the planet, which is slower than the analytic
// solution and very much easier to check.
function occultTable(k, u1, u2, nd) {
   // The integrand is symmetric about the line joining the two centres, so
   // only half the angles are computed and the result doubled.
   const NR = 32, NH = 32;
   const Fstar = Math.PI * (1 - u1 / 3 - u2 / 6);
   const tab = new Float64Array(nd + 1);
   const dmax = 1 + k;
   const dr = k / NR;
   const dt = Math.PI / NH;
   const cos = new Float64Array(NH);
   for (let b = 0; b < NH; b++) { cos[b] = Math.cos(dt * (b + 0.5)); }
   for (let i = 0; i <= nd; i++) {
      const d = dmax * i / nd;
      let acc = 0;
      for (let a = 0; a < NR; a++) {
         const rho = k * (a + 0.5) / NR;
         const c1 = d * d + rho * rho, c2 = 2 * d * rho;
         let inner = 0;
         for (let b = 0; b < NH; b++) {
            const r2 = c1 + c2 * cos[b];
            if (r2 >= 1) { continue; }
            const mu = Math.sqrt(1 - r2);
            const om = 1 - mu;
            inner += 1 - u1 * om - u2 * om * om;
         }
         acc += inner * rho * dr * dt;
      }
      tab[i] = 2 * acc / Fstar;
   }
   return { tab: tab, dmax: dmax, nd: nd };
}

function occult(T, d) {
   if (d >= T.dmax) { return 0; }
   const x = d / T.dmax * T.nd;
   const i = x | 0;
   if (i >= T.nd) { return T.tab[T.nd]; }
   const f = x - i;
   return T.tab[i] * (1 - f) + T.tab[i + 1] * f;
}


// Symmetric 3 by 3 solve, by hand because there is no linear algebra library
// here and there never will be.
function solve3(a00, a01, a02, a11, a12, a22, b0, b1, b2) {
   const det = a00 * (a11 * a22 - a12 * a12)
             - a01 * (a01 * a22 - a12 * a02)
             + a02 * (a01 * a12 - a11 * a02);
   if (!isFinite(det) || Math.abs(det) < 1e-18) { return null; }
   const i00 = (a11 * a22 - a12 * a12) / det;
   const i01 = (a02 * a12 - a01 * a22) / det;
   const i02 = (a01 * a12 - a02 * a11) / det;
   const i11 = (a00 * a22 - a02 * a02) / det;
   const i12 = (a02 * a01 - a00 * a12) / det;
   const i22 = (a00 * a11 - a01 * a01) / det;
   return [i00 * b0 + i01 * b1 + i02 * b2,
           i01 * b0 + i11 * b1 + i12 * b2,
           i02 * b0 + i12 * b1 + i22 * b2];
}

function ldfit(t, y, period, phaseCentre, w14, depth, u1, u2) {
   // Only the points near the transit carry any information about its shape.
   const win = Math.min(0.45, Math.max(w14 * 1.6, w14 / 2 + 0.01));
   const n0 = t.length;
   const pxa = new Float64Array(n0), pya = new Float64Array(n0);
   let m = 0;
   for (let i = 0; i < n0; i++) {
      const u = t[i] / period - phaseCentre;
      const ph = u - Math.round(u);
      if (Math.abs(ph) < win) { pxa[m] = ph; pya[m] = y[i]; m++; }
   }
   // Typed arrays, not plain ones. These two are read a few million times
   // inside the grid search and the difference is not small.
   const px = pxa.subarray(0, m), py = pya.subarray(0, m);

   // The orbital angle of each point never changes as the fit walks its grid,
   // so its sine and cosine are computed once here rather than a few million
   // times inside the loop. Same for the quadratic basis of the baseline.
   const sa = new Float64Array(m), ca = new Float64Array(m), p2 = new Float64Array(m);
   for (let i = 0; i < m; i++) {
      const ang = 2 * Math.PI * px[i];
      sa[i] = Math.sin(ang); ca[i] = Math.cos(ang); p2[i] = px[i] * px[i];
   }
   if (m < 200 || !(w14 > 0) || !(depth > 0)) { return null; }

   const sinT = Math.sin(Math.PI * w14);        // w14 is already a phase fraction
   if (!(sinT > 0)) { return null; }

   const k0 = Math.sqrt(depth);

   // The trapezoid duration seeds the orbit size but does not fix it. The
   // trapezoid has straight sides and a real ingress is curved, so its width
   // comes out a couple of per cent short. Treating that as exact was enough
   // to force WASP-18 b to a dead central crossing, so the scale is a fitted
   // parameter with the trapezoid only setting where to start looking.
   const mod = new Float64Array(m);

   function scan(kLo, kHi, nk, bLo, bHi, nb, sLo, sHi, ns) {
      let win2 = null;
      for (let ki = 0; ki <= nk; ki++) {
         const k = kLo + (kHi - kLo) * ki / nk;
         if (k <= 0.001 || k >= 0.5) { continue; }
         const T = occultTable(k, u1, u2, 100);
         for (let bi = 0; bi <= nb; bi++) {
            const b = bLo + (bHi - bLo) * bi / nb;
            if (b < 0) { continue; }
            const num = (1 + k) * (1 + k) - b * b;
            if (num <= 0) { continue; }
            const aRs0 = Math.sqrt(b * b + num / (sinT * sinT));
            if (aRs0 <= 1) { continue; }
            for (let si = 0; si <= ns; si++) {
            const aRs = aRs0 * (sLo + (sHi - sLo) * (ns ? si / ns : 0));
            if (aRs <= 1 || aRs <= b) { continue; }
            // The baseline either side of the transit is not always flat. A
            // planet this close raises tides on its star, and the star's
            // changing shape modulates the light over the orbit. Forcing a
            // flat baseline pushes that curvature into the transit and drags
            // the fit to a central crossing. So the baseline is a quadratic in
            // phase, solved exactly alongside the depth at every trial.
            let A00 = 0, A01 = 0, A02 = 0, A11 = 0, A12 = 0, A22 = 0;
            let B0 = 0, B1 = 0, B2 = 0;
            for (let i = 0; i < m; i++) {
               const dx = aRs * sa[i];
               const dy = b * ca[i];
               const f = 1 - occult(T, Math.sqrt(dx * dx + dy * dy));
               mod[i] = f;
               const g0 = f, g1 = f * px[i], g2 = g1 * px[i];
               A00 += g0 * g0; A01 += g0 * g1; A02 += g0 * g2;
               A11 += g1 * g1; A12 += g1 * g2; A22 += g2 * g2;
               B0 += g0 * py[i]; B1 += g1 * py[i]; B2 += g2 * py[i];
            }
            const c = solve3(A00, A01, A02, A11, A12, A22, B0, B1, B2);
            if (!c) { continue; }
            let chi = 0;
            const c0 = c[0], c1 = c[1], c2 = c[2];
            for (let i = 0; i < m; i++) {
               const r = py[i] - mod[i] * (c0 + c1 * px[i] + c2 * p2[i]);
               chi += r * r;
            }
            if (win2 === null || chi < win2.chi) {
               win2 = { chi: chi, k: k, b: b, aRs: aRs, base: c[0],
                        slope: c[1], curve: c[2], scale: aRs / aRs0 };
            }
            }
         }
      }
      return win2;
   }

   const coarse = scan(k0 * 0.75, k0 * 1.25, 12, 0, 1 + k0 * 1.25, 12,
                       0.90, 1.10, 6);
   if (!coarse) { return null; }
   const dk = k0 * 0.50 / 12, db = (1 + k0 * 1.25) / 12, ds = 0.20 / 6;
   const best = scan(coarse.k - dk, coarse.k + dk, 8,
                     Math.max(0, coarse.b - db), coarse.b + db, 8,
                     coarse.scale - ds, coarse.scale + ds, 4) || coarse;

   if (!best) { return null; }
   best.inc = Math.acos(best.b / best.aRs) * 180 / Math.PI;
   best.rms = Math.sqrt(best.chi / m);
   best.n = m;
   return best;
}

// Which multiple of the period is the real one. A box search is just as happy
// with half or twice the truth, and the periodogram says so if you look.
function harmonics(periods, power, bestI) {
   function at(p) {
      // the grid runs from the longest period down to the shortest
      if (p > periods[0] || p < periods[periods.length - 1]) { return null; }
      // the grid is uniform in frequency, not in period
      let lo = 0, hi = periods.length - 1;
      while (hi - lo > 1) {
         const mid = (lo + hi) >> 1;
         if (periods[mid] > p) { lo = mid; } else { hi = mid; }
      }
      return Math.max(power[lo], power[hi]);
   }
   const peak = power[bestI], P = periods[bestI];
   const h = at(P / 2), d = at(P * 2);
   return {
      peak: peak,
      half: h, halfRatio: h === null ? null : h / peak,
      double: d, doubleRatio: d === null ? null : d / peak
   };
}
