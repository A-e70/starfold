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

self.onmessage = function (e) {
   const d = e.data;
   const dec = d.binMinutes > 0
      ? decimate(d.t, d.y, d.binMinutes / (24 * 60))
      : { t: d.t, y: d.y };
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
   const step = Math.max(1, Math.floor(nf / 50));

   for (let k = 0; k < nf; k++) {
      const freq = fmin + k * df;
      periods[k] = 1 / freq;
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
      power[k] = Math.sqrt(localBest);
      if (localBest > bestSR) {
         bestSR = localBest; bestI = k;
         bestStart = lStart; bestWidth = lWidth; bestS = lS; bestR = lR;
      }
      if (k % step === 0) {
         self.postMessage({ kind: "progress", done: k, total: nf });
      }
   }

   // Depth of the best fitting box, and where its centre falls in phase.
   const depth = -bestS / (bestR * (1 - bestR));
   const period = periods[bestI];
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

   const checks = vet(d.t, d.y, period, phaseCentre, q);

   self.postMessage({
      kind: "done",
      vet: checks,
      periods: periods, power: power,
      period: period, depth: depth, q: q,
      duration: q * period, phaseCentre: phaseCentre, sde: sde,
      searched: N,
      mean: mean
   }, [periods.buffer, power.buffer]);
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
