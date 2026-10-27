# Avatar PoC: measurement-driven 3D body

A browser page that builds a rigged 3D body from tape measurements. A virtual tape on the mesh gives back the numbers you typed, within 0.5 cm. You can orbit, zoom, change the skin colour, put a face photo on the head, and play simple animations.

The page has no build step and no dependencies to install. Three.js r170 loads from the jsDelivr CDN.

## Run it

1. Start a static server in this folder. ES modules do not load from `file://`.

   ```bash
   python3 -m http.server 8765 --bind 127.0.0.1 --directory avatar-poc
   ```

2. Open http://localhost:8765.
3. Type your measurements in centimetres and click **Build avatar**.

## Test it

The tests need Node 20 or later. They use the built-in `node:test` runner.

```bash
node --test avatar-poc/
```

The tests build four body profiles and check three things:

- A virtual tape on the mesh matches every input (height, shoulder, chest, waist, hip, inseam, neck, thigh, calf) within 0.5 cm.
- Each vertex has skin weights that add up to 1, and each index points at a real vertex and bone.
- The body volume, at 1 kg per litre, gives a BMI between 15 and 45. This catches limbs or a head at the wrong scale.
- The volume is the union of all parts, so overlapping parts count once, and it matches the exact volume of a single part within 1%.

## Validate against real people (ANSUR II)

ANSUR II is the 2012 US Army body survey: 6,068 adults (4,082 men, 1,986 women) with 93 tape and caliper measurements and a scale weight. It is US Government work, in the public domain. The full CSV is not in this repository. The official hosts (ph.health.mil and tools.openlab.psu.edu) refuse scripted downloads, so you use the calmcode.io mirror, which has the same 6,068 rows and 108 columns.

1. Download the CSV to a folder outside the repository.

   ```bash
   curl -sSL -o ~/Downloads/ansur2.csv https://calmcode.io/static/data/ergonomics.csv
   ```

2. Run the validation. It takes about 6 minutes, because it builds and slices 6,068 avatars.

   ```bash
   node avatar-poc/ansur-validate.mjs ~/Downloads/ansur2.csv
   ```

3. Optional: refresh the 200-person sample that the page uses for its "Real people" buttons.

   ```bash
   node avatar-poc/ansur-sample.mjs ~/Downloads/ansur2.csv
   ```

The script fits one number, the density in kg per litre, on half of the people (even subject ids). It then scores the avatar on the other half against two baselines that get the same inputs. The results and what they mean are in `../feasibility.md`.

## Files

| File | What it does |
|---|---|
| `body.js` | Builds the mesh, the skeleton, and the skin weights from measurements. Pure JS, runs in the browser and in Node. |
| `measure.js` | The virtual tape. It cuts the triangle mesh with a horizontal plane and wraps a convex hull around the cut. It does not use the ring data from `body.js`. |
| `main.js` | Three.js viewer: orbit controls, camera presets, skin, face photo, animations. |
| `verify.test.mjs` | The tests. |
| `ansur.js` | Maps ANSUR II columns to avatar inputs. |
| `ansur-validate.mjs` | Builds an avatar for each ANSUR II person and compares the weight that its volume implies with the scale weight. |
| `ansur-sample.mjs`, `ansur-sample.json` | Makes and holds 100 men and 100 women from ANSUR II for the page's "Real people" buttons. |

## How the body is built

The body is a set of lofted tubes (torso, neck, legs, arms) plus ellipsoids (head, hands, feet, shoulder caps). Each tube passes through cross-section rings. A ring at a landmark height (for example the waist) is a superellipse scaled so that its perimeter equals the measurement. Heights of landmarks are fixed fractions of the total height, except the crotch, which equals the inseam.

You give five measurements: height, shoulder width, chest, waist, and hip. The page estimates the others from the nearest measured value, with ANSUR II median ratios. For example, the thigh default is 0.61 times the hip. An optional body shape (female, male or neutral) sets the breadth and depth of the chest, waist and hip cross-sections from ANSUR II medians.

The skeleton has 17 bones. Animations are procedural bone rotations, not motion-capture clips.

## Limits

- The body looks like a shop mannequin, not like a person. Only the measured girths and lengths are accurate. Shapes between the landmarks are interpolated.
- The measurements are correct in the standing pose only. Animation moves the mesh with simple linear blend skinning, so joints pinch or gap in extreme poses (for example the shoulders with arms up).
- The face photo is a flat projection onto the front of the head. Side views stretch it, and the lighting of the photo stays in the texture.
- There is no clothing yet. See `../feasibility.md` for the clothing plan.
- The torso cross-sections use ANSUR II median shapes for men, women, or the average of both. The shape of one person's cross-sections is not measured.
- ANSUR II people are soldiers: younger and fitter than the general population. Results on other people can be worse.
