// Validates the avatar against 6,068 measured people (ANSUR II).
// 1. Tape check: build each person's avatar and measure it; report the worst mismatch.
// 2. Weight check: avatar volume x density vs scale weight. Density is fitted on half the people
//    (even subject ids) and scored on the other half, next to two baselines that see the same inputs.
// Run: node ansur-validate.mjs <path to ANSUR II csv>
import { readFileSync } from 'node:fs';
import { parseCsv, ansurToInputs, weightKg } from './ansur.js';
import { buildBody, validate } from './body.js';
import { measureBody, unionVolumeLitres as volumeLitres } from './measure.js';

const rows = parseCsv(readFileSync(process.argv[2], 'utf8'));
const TAPE = ['height', 'chest', 'waist', 'hip', 'shoulder', 'inseam', 'neck', 'thigh', 'calf'];

let rejected = 0, worst = { d: 0 };
const people = [];
for (const r of rows) {
  const m = ansurToInputs(r);
  if (validate(m).length) { rejected++; continue; }
  const body = buildBody(m), got = measureBody(body);
  for (const k of TAPE) {
    const d = Math.abs(got[k] - body.measurements[k]);
    if (d > worst.d) worst = { d, k, id: r.subjectid };
  }
  people.push({ id: +r.subjectid, male: r.gender === 'Male', kg: weightKg(r), m, litres: volumeLitres(body) });
}

const train = people.filter((p) => p.id % 2 === 0), test = people.filter((p) => p.id % 2 === 1);

// Least-squares density through the origin: kg = k * litres.
const k = train.reduce((s, p) => s + p.kg * p.litres, 0) / train.reduce((s, p) => s + p.litres ** 2, 0);

// Baseline A: median BMI of the train set (per sex) x height^2. Uses height only.
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
const bmi = (male) => median(train.filter((p) => p.male === male).map((p) => p.kg / (p.m.height / 100) ** 2));
const bmiM = bmi(true), bmiF = bmi(false);

// Baseline B: linear regression on the five required inputs + sex. The best a simple formula can do.
const feats = (p) => [1, p.male ? 1 : 0, p.m.height, p.m.chest, p.m.waist, p.m.hip, p.m.shoulder];
function ols(set) {
  const n = feats(set[0]).length, A = Array.from({ length: n }, () => Array(n + 1).fill(0));
  for (const p of set) {
    const x = feats(p);
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j]; A[i][n] += x[i] * p.kg; }
  }
  for (let c = 0; c < n; c++) { // Gauss-Jordan with partial pivoting
    const piv = A.reduce((b, row, r) => (r >= c && Math.abs(row[c]) > Math.abs(A[b][c]) ? r : b), c);
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((row, i) => row[n] / row[i]);
}
const beta = ols(train);

const models = {
  'Avatar volume x 1.00 kg/L (no fitting)': (p) => p.litres,
  [`Avatar volume x ${k.toFixed(3)} kg/L (fitted)`]: (p) => p.litres * k,
  'Baseline A: median BMI x height²': (p) => (p.male ? bmiM : bmiF) * (p.m.height / 100) ** 2,
  'Baseline B: linear regression, same 5 inputs + sex': (p) => feats(p).reduce((s, x, i) => s + x * beta[i], 0),
};

function score(f, set) {
  const e = set.map((p) => f(p) - p.kg), ape = set.map((p, i) => Math.abs(e[i]) / p.kg);
  const within = (t) => `${((ape.filter((a) => a <= t).length / set.length) * 100).toFixed(0)}%`;
  return {
    bias: (e.reduce((a, b) => a + b, 0) / set.length).toFixed(1),
    mae: (e.reduce((a, b) => a + Math.abs(b), 0) / set.length).toFixed(1),
    mape: `${((ape.reduce((a, b) => a + b, 0) / set.length) * 100).toFixed(1)}%`,
    w5: within(0.05), w10: within(0.1),
  };
}

const line = (cells) => `| ${cells.join(' | ')} |`;
console.log(`People: ${rows.length}. Rejected by validate(): ${rejected}. Train ${train.length}, test ${test.length}.`);
console.log(`Tape check: worst mismatch ${worst.d.toFixed(2)} cm${worst.k ? ` (${worst.k}, subject ${worst.id})` : ''}.\n`);
for (const [title, set] of [['Test half, everyone', test], ['Test half, men', test.filter((p) => p.male)], ['Test half, women', test.filter((p) => !p.male)]]) {
  console.log(`${title} (n=${set.length})\n`);
  console.log(line(['Model', 'Bias kg', 'MAE kg', 'MAPE', 'Within 5%', 'Within 10%']));
  console.log(line(Array(6).fill('---')));
  for (const [name, f] of Object.entries(models)) { const s = score(f, set); console.log(line([name, s.bias, s.mae, s.mape, s.w5, s.w10])); }
  console.log('');
}

// Where the fitted avatar goes wrong: bias by BMI band.
const fitted = Object.values(models)[1];
console.log('Fitted avatar, test half, by BMI band\n');
console.log(line(['BMI', 'n', 'Bias kg', 'MAPE']));
console.log(line(Array(4).fill('---')));
for (const [lo, hi] of [[0, 22], [22, 25], [25, 30], [30, 99]]) {
  const set = test.filter((p) => { const b = p.kg / (p.m.height / 100) ** 2; return b >= lo && b < hi; });
  const s = score(fitted, set);
  console.log(line([`${lo}–${hi === 99 ? '' : hi}`, set.length, s.bias, s.mape]));
}
