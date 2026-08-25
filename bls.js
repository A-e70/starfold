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

   self.postMessage({
      kind: "done",
      periods: periods, power: power,
      period: period, depth: depth, q: q,
      duration: q * period, phaseCentre: phaseCentre, sde: sde,
      searched: N,
      mean: mean
   }, [periods.buffer, power.buffer]);
};
