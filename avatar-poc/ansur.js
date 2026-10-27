// ANSUR II (US Army anthropometric survey, 2012, public domain) to avatar inputs.
// ANSUR lengths are in mm; `weightkg` is in hectograms despite its name.

// avatar input -> ANSUR column (mm). Differences from a home tape measurement:
// waist is taken at the navel, not the narrowest point; arm girths are flexed;
// shoulder is biacromial (bone to bone), narrower than a garment's seam-to-seam width.
export const COLUMNS = {
  height: 'stature', chest: 'chestcircumference', waist: 'waistcircumference', hip: 'buttockcircumference',
  shoulder: 'biacromialbreadth', inseam: 'crotchheight', neck: 'neckcircumference', thigh: 'thighcircumference',
  calf: 'calfcircumference', upperArm: 'bicepscircumferenceflexed', forearm: 'forearmcircumferenceflexed',
  wrist: 'wristcircumference',
};

export function ansurToInputs(row) {
  const m = {};
  for (const [k, col] of Object.entries(COLUMNS)) m[k] = +row[col] / 10;
  m.armLength = (+row.acromionradialelength + +row.radialestylionlength) / 10;
  m.sex = row.gender.toLowerCase();
  return m;
}

export const weightKg = (row) => +row.weightkg / 10;

export function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}
