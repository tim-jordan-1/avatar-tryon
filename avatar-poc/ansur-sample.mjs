// Writes ansur-sample.json: 100 men and 100 women from ANSUR II, for the "real people" picker.
// Run: node ansur-sample.mjs <path to ANSUR II csv>   (see README for the download)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, ansurToInputs, weightKg } from './ansur.js';

const rows = parseCsv(readFileSync(process.argv[2], 'utf8'));
const pick = (g) => {
  const of = rows.filter((r) => r.gender === g).sort((a, b) => a.subjectid - b.subjectid);
  return Array.from({ length: 100 }, (_, i) => of[Math.floor((i * of.length) / 100)]); // evenly spaced, deterministic
};
const out = [...pick('Male'), ...pick('Female')].map((r) => ({ id: +r.subjectid, gender: r.gender, kg: weightKg(r), m: ansurToInputs(r) }));
writeFileSync(new URL('./ansur-sample.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${out.length} subjects`);
