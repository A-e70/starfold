// Regression check for the search. Runs bls.js headless against the bundled
// real data and fails if the answer moves.
//
//     node tools/check.js
//
// The expected values are what the published measurements say, not what this
// code happened to print. If a change moves them, the change is wrong or the
// tolerance below is a lie.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let handler = null;
const self = {
   postMessage: function (m) { if (m.kind === "done") { self._done = m; } },
   set onmessage(h) { handler = h; },
   get onmessage() { return handler; }
};
eval(fs.readFileSync(path.join(root, "bls.js"), "utf8"));

function load(f) {
   const t = [], y = [];
   for (const L of fs.readFileSync(f, "utf8").split("\n")) {
      if (!L || L[0] === "#") { continue; }
      const p = L.split(",");
      const a = parseFloat(p[0]), b = parseFloat(p[1]);
      if (isFinite(a) && isFinite(b)) { t.push(a); y.push(b); }
   }
   return { t: Float64Array.from(t), y: Float64Array.from(y) };
}

const CASES = [
   {
      file: "data/wasp-18.csv", name: "WASP-18 b",
      search: { pmin: 0.4, pmax: 13, nfreq: 4000, nbins: 280,
                minDur: 0.005, maxDur: 0.12, binMinutes: 10 },
      // published: P = 0.94145 d, depth ~0.90 %
      // published: T14 = 2.14 h
      expect: { period: [0.9410, 0.9420], depth: [0.0085, 0.0100], sde: [7, 99],
                trapT14h: [2.0, 2.3] }
   },
   {
      file: "data/hd-209458.csv", name: "HD 209458 b",
      search: { pmin: 0.4, pmax: 13, nfreq: 4000, nbins: 280,
                minDur: 0.005, maxDur: 0.12, binMinutes: 10 },
      // published: P = 3.52475 d, depth ~1.5 %
      // published: T14 = 3.0 h
      expect: { period: [3.515, 3.535], depth: [0.013, 0.017], sde: [7, 99],
                trapT14h: [2.8, 3.4] }
   }
];

let bad = 0;
for (const c of CASES) {
   const f = path.join(root, c.file);
   if (!fs.existsSync(f)) { console.log("SKIP " + c.name + ", no " + c.file); continue; }
   const d = load(f);
   const opts = Object.assign({ t: d.t, y: d.y }, c.search);
   const t0 = Date.now === undefined ? 0 : process.hrtime.bigint();
   handler({ data: opts });
   const ms = Number(process.hrtime.bigint() - t0) / 1e6;
   const r = self._done;
   const v = r.vet;
   const got = { period: r.period, depth: r.depth, sde: r.sde,
                 trapT14h: v && v.trapT14 ? v.trapT14 * 24 : NaN };
   let ok = true;
   for (const k of Object.keys(c.expect)) {
      const [lo, hi] = c.expect[k];
      if (!(got[k] >= lo && got[k] <= hi)) {
         console.log("FAIL " + c.name + " " + k + " = " + got[k] +
                     ", expected between " + lo + " and " + hi);
         ok = false; bad++;
      }
   }
   // Both of these are real planets. If the vetting calls either one a binary
   // the vetting is broken, not the planet.
   if (v && v.ok) {
      if (v.oddEvenSigma > 3 && v.oddEvenFrac > 0.1) {
         console.log("FAIL " + c.name + " rejected by the odd against even test: " +
                     v.oddEvenSigma.toFixed(1) + " sigma, " +
                     (v.oddEvenFrac * 100).toFixed(1) + " % apart");
         ok = false; bad++;
      }
      if (v.secondarySigma > 3 && v.secRatio > 0.3) {
         console.log("FAIL " + c.name + " rejected by the secondary eclipse test");
         ok = false; bad++;
      }
   }
   console.log((ok ? "ok   " : "FAIL ") + c.name +
               "  P=" + r.period.toFixed(5) + " d" +
               "  depth=" + (r.depth * 100).toFixed(4) + " %" +
               "  " + r.sde.toFixed(1) + " sigma" +
               "  T14=" + (v && v.trapT14 ? (v.trapT14 * 24).toFixed(2) + " h" : "-") +
               "  odd/even=" + (v && v.oddEvenFrac !== null
                  ? (v.oddEvenFrac * 100).toFixed(1) + " %" : "-") +
               "  (" + ms.toFixed(0) + " ms)");
}
process.exit(bad === 0 ? 0 : 1);
