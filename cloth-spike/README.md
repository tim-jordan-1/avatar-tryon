# Cloth spike: a t-shirt that moves with the avatar

A browser page that puts one t-shirt on the animated avatar and simulates it as a soft body with JoltPhysics.js 1.1.0 (WebAssembly). You can pick the fabric, the size and the motion.

The avatar is the MakeHuman body (CC0), fitted to the tape measurements and rigged by `../twin-spike/mhavatar.js`. It uses MakeHuman's own skin weights, summed onto the bones that `../avatar-poc/anim.js` animates. It wears a fitted base layer: trunks (male), or briefs and a crop top (female). A shader draws the base layer from the rest-pose position (`baseLayerPatch` in `tryon.js`). With face photos (the Chrome extension passes them), the head is the photo twin from `../twin-spike/head.js`, skinned to the same skeleton. The page imports modules from `../avatar-poc/` and `../twin-spike/`, so you must serve the repository root, not this folder. The page downloads the MakeHuman mesh, skeleton and weights (about 3 MB) from a pinned commit.

## Run it

1. Start a static server in the repository root.

   ```bash
   python3 -m http.server 8767 --bind 127.0.0.1 --directory .
   ```

2. Open http://localhost:8767/cloth-spike/ in Chrome or Safari.

The avatar is a default man (178 cm, chest 100 cm) with the arms hanging 14° from vertical, like a mannequin, and the hands down beside the thighs. The page does not read the measurements from the avatar PoC: browser storage is separate for each port.

## Test it

```bash
node --test cloth-spike/ twin-spike/
```

`twin-spike/mhavatar.test.mjs` downloads the MakeHuman files once into the system temp folder. For an average man and an average woman it checks the tape on the rigged body (within 1.5 cm of the inputs), the skeleton and skin weights, the torso rings, and the shirt on that body (chest girth, and no vertex inside the body at rest).

The tests check these things:

- Fabric parameters: denim is stiffer than jersey, elastane lowers the stretch stiffness, gsm scales the mass, and stiffer fabric damps more and drifts less from the body.
- Material labels: the number can come before or after the fibre ("95% cotton" or "Cotton 95%"), an adjective is skipped ("7% recycled elastane"), and a second part such as "Lining: 100% polyester" does not become a fibre.
- The shirt mesh: no bad indices, no edge shared by more than two triangles, the chest girth within 1.5 cm of the garment size, no shirt vertex inside the body at rest, by the exact inside test (see below), and open edges (hem, sleeve ends, neck) that form closed loops.

## How it works

1. `shirt.js` builds the shirt around the body in its rest pose: a torso tube from 5% of height above the crotch to the armpit, front and back panels joined at a shoulder seam, a neck opening, and two short sleeves. The chest girth equals the garment size, for example chest + 8 cm. Below the chest, the shirt keeps that same ease over the body at every height (with 20% of a straight tube mixed in), so it follows the waist and hip instead of hanging as a box. Above the chest, it closes in on the body towards the shoulders. The shoulder seam lies on top of the body, and a crew neckline runs round the neck base: level with the seam at the sides, 3% of height lower at the front and 1.2% lower at the back. Three extra rows let the panel wrap over the trapezius. A last step pulls every torso vertex above the chest down onto the body, along its nearest surface normal, until it is 7 mm off the skin. The least gap anywhere is 5 mm, and the collar sits 3 mm off the neck.
2. Each shirt-body vertex takes the skin weights of the nearest body vertex; each sleeve vertex takes them from the nearest vertex of its own arm. In Jolt, a skinned constraint pulls each vertex towards its skinned position and lets it drift only a little: 1 cm at the shoulder to 4 cm at the hem, times the fabric's drift factor (0.4 for jersey). The neckline is no longer a rigid ring. Its vertices have mass and may drift 2 mm, so the collar follows the neck. The old neckline was fixed 12 mm off the neck.
3. Kinematic colliders follow the bones: convex hulls over the torso rings between landmarks, capsules on the arms and the neck, and a sphere on each deltoid. The MakeHuman body is not built from rings, so `mhavatar.js` slices its torso every 1 cm and casts 48 rays from the body axis into each slice. Above the armpit, the slice is cut at a half-width that grows to half the shoulder width, so the arms stay out of the torso rings. A convex hull fills every hollow, so the top hull (armpit to neck) used to stand 4 to 6 cm in front of the collarbone hollow and 2 cm behind the curve of the nape. The cloth rested on that hull: this was the invisible wall. The top hull now drops its points within 10 cm of the centre line, in front above 7 cm over the armpit and behind above the shoulder line. Thin plates of the front arc (3 hulls) and the back arc (2 hulls) follow the hollows instead. The sides and the shoulders keep the full hull, which also protects the shoulder when the arms rise.
4. `fabric.js` turns a material label into Jolt parameters: mass from gsm, stretch, shear and bend compliance from the construction (jersey, rib, woven, denim), and two numbers that calm the cloth: linear damping (jersey 8, denim 11 per second) and the drift factor (jersey 0.4, denim 0.3). Elastane softens stretch and shear. The values are order-of-magnitude estimates, chosen so the fabrics rank correctly. They are not measured. The bend value does not help here: Jolt's dihedral bend constraint has no effect at the compliance this value gives, and at a compliance low enough to act, the cloth jitters (2 to 6 times the vertex speed) and settles more slowly. So damping and drift do the calming.
5. The physics runs at a fixed step of 1/60 s. Real elapsed time decides how many steps run per frame, so a 120 Hz screen does not run the motion at double speed.
6. The physics mesh is one layer. The page draws it as a thin shell: an outer face, a darker inner face 3 mm behind it, and a rim along the hem, the sleeve ends and the neck, so the cut edges show the fabric thickness. The shell costs no physics time.

## What changed for the cotton tee (2026-10-27)

The user tested the tee and said the fabric moved too fast, looked frail, and the neckline looked fixed, "like an invisible wall" that stopped the cloth from wrapping the body.

- Too much motion: the damping was 0.2 per second, so the cloth rang for seconds after a stop. Walking dragged the hem 2 to 4 cm from its place. Now damping is 8 and the drift is 0.4 times as large. The cloth settles in half a second, and the offset speed (see below) fell by 30 to 55%.
- Frail: the cloth was a single flat sheet. Now it has a visible thickness and a rim (item 6).
- Invisible wall: the top hull sat 4 to 6 cm in front of the collarbone hollow (item 3). The front yoke rows were 50 to 67 mm off the body in the middle of the chest. The collar was also 12 mm off the neck and fixed.

## Inside test: why the first numbers were wrong

The first version counted a cloth vertex as inside the body when it was behind the nearest body vertex along that vertex's normal. That test is blind where body parts overlap or are coarse. The arm tubes have rings about 9 cm apart, and the arm tops sit inside the torso. So the nearest vertex is often a torso vertex whose normal points outward, and a point inside the arm reads as outside. At rest that test reported 0 vertices inside. The exact test reported 152 of 1,164: 144 of them sleeve and side vertices inside the arms.

The exact test (`insideTester` in `shirt.js`) uses ray parity. A ray from the point crosses each closed body part (torso, neck, arms, deltoid caps) an odd number of times when the point is inside it. The tests and the page now use it. The MakeHuman body is one closed mesh with no open edges, so it is one part. A grid of the triangles by their y and z range keeps the test fast on its 27,000 triangles: the ray runs along x, so it only meets the triangles of its own grid cell.

## What fixed the penetration

1. Sleeves: the middle sleeve rings are a straight blend from the armhole to rings around the arm, and that blend cut through the upper arm. After building, every vertex inside a part now moves away from that part's axis (arm bone line, torso centre line, deltoid centre) until it is clear by the clearance offset.
2. Pose: the arms hang at 14° in the rest pose (see Hanging arms). At 12°, a vertex pushed out of the arm landed in the torso and back again.
3. Back stop: the clearance that Jolt's back stop allows is now measured with the exact test (step toward the body until inside). It came from the blind test before, which let sleeves sink back into the arm.
4. Sleeve skin weights: sleeve vertices take their weights from their own arm, not from the nearest body vertex (often torso). The sleeves now turn with the arms.
5. Colliders on the skin: the torso hulls were 0.97x the torso and the arm capsules 0.92x the arm, so cloth could settle a few mm inside. Now 1.0x, and 1.05x for the upper arm, whose tube is 1.1x its girth at the top.

## Measured results

`window.clothTest(seconds, mode)` steps the simulation directly for that many simulated seconds. It samples the exact inside test every 0.1 s and returns the share of cloth vertices inside the body (`meanPct`, `maxInside`), the Jolt step time (`physicsMs`) and a `motion` block. The motion block holds the mean offset of the cloth from its skinned place (`dispMm`), the mean speed of that offset (`speedMmS`, `slowMmS` over 0.1 s) and the speed per 0.5 s (`speedBins`). That offset speed is what you see as cloth moving on the body. `window.__tryon.probe()` returns the cloth, rest and skinned body positions, and `run(seconds, mode)` steps without measuring.

### Cotton tee, 2026-10-27

User profile (175 cm man, chest 98, waist 84, hip 98, shoulder 45), cotton jersey 180 gsm, shirt chest 108 cm (the page default, chest + 10 cm), 10 s per run, headless Chrome with SwiftShader, `?height=175&chest=98&waist=84&hip=98&shoulder=45&sex=male`.

| Measure | Before | After |
|---|---|---|
| Offset speed, idle | 8.9 mm/s | 3.8 mm/s |
| Offset speed, turn | 16.0 mm/s | 6.1 mm/s |
| Offset speed, walk | 61.2 mm/s | 43.7 mm/s |
| Offset speed, try-on sequence | 36 to 38 mm/s | 19 to 22 mm/s |
| Settle after a walk stops (speed per 0.5 s) | 106, 22, 10, 5.8, 3.7 mm/s | 76, 3, 1.3, 1.0, 1.0 mm/s |
| Mean offset from the skinned place, walk | 16.5 mm | 8.5 mm |
| Inside the body, idle / turn / walk | 0% / 0% / 0% | 0% / 0% / 0% |
| Inside the body, arms up (3 runs) | 0.46 to 0.48% (max 36 to 40) | 0.56 to 0.58% (max 41 to 46) |
| Inside the body, try-on sequence (3 runs) | 0 to 0.01% (max 2) | 0.04 to 0.05% (max 5) |
| Inside the body, calm try-on | 0% | 0% |
| Physics step, quiet machine | 2.6 to 2.7 ms | about 3.3 to 3.5 ms |

The settle time is the time for the cloth to stop after 4 s of walking and a stop in the A-pose. The residual 1 mm/s is the noise floor of the measure. The physics step grew by about 30% because of 5 more collider hulls. The machine was busy for the last runs (load 8 to 20), so I measured both versions alternately: after took 1.25 to 1.35 times as long as before, with the same method.

Gap between cloth and body surface, mean in mm (nearest body vertex, so it reads about 2 mm high). "Rest" is the cloth on its skinned place in the A-pose, "after 3 s" is the same pose after 3 s of simulation, as the user sees it.

| Region | Before, rest | Before, after 3 s | After, rest | After, after 3 s |
|---|---|---|---|---|
| Neckline | 13.4 | 13.4 | 5.9 | 8.5 |
| Shoulder (seam and yoke top) | 20.4 | 28.9 | 14.2 | 14.7 |
| Upper chest, front | 17.5 | 19.1 | 14.9 | 12.0 |
| Upper back | 22.3 | 16.7 | 15.4 | 16.5 |
| Upper side | 20.3 | 18.7 | 18.0 | 17.2 |
| Mid torso, front / back | 17.5 / 16.9 | 14.7 / 22.9 | 17.8 / 17.1 | 16.3 / 20.4 |
| Waist, front / back | 18.8 / 19.2 | 20.2 / 30.6 | 18.9 / 19.2 | 18.8 / 29.3 |
| Hem, front / back | 19.0 / 18.4 | 25.0 / 17.2 | 19.2 / 17.4 | 21.2 / 18.3 |

Mid torso, waist and hem keep their ease on purpose: the size sets it, and the lower back stays open over the curve of the spine, as on a real tee. The big change is in the middle of the front yoke, at the neck base. The cloth stood 50 to 67 mm off the body there before, and now it is 5 to 10 mm (the invisible wall).

Screenshots of both versions are in the scratchpad of the session that made them: `shots-before/` and `shots-after/` (front, side, three-quarter, neck, shoulder, back, hem, sleeve and mid-walk views).

### Earlier results

Before this change (2026-10-27, MakeHuman body, jersey, garment chest 110 cm): idle 0%, turn 0%, walk 0%, arms up 0.51 to 0.62%, try-on sequence at most 2 vertices, physics step 2.7 ms. On the mannequin body before the first fixes: idle 2.6%, walk 3.0%, arms up 8.3%.

The try-on sequence (`tryon.celebrate()`, 4 s, in `../avatar-poc/anim.js`) looks down at the shirt, twists to see each side, hops 3.5 cm and pumps a fist, then goes back to idle. Jolt has no continuous collision for soft bodies, so the arm moves are kept under 2.5 m/s at the hand, and `anim.test.mjs` checks that limit and the hop height.

The percentage is the mean share of cloth vertices inside the body; the number in brackets is the most at any one sample. Arms up varies between runs because the test starts at a different point of the motion. `tryon.insideNow()` lists the cloth vertices inside the body, and the page exposes the viewer as `window.__tryon`.

## Hanging arms

MakeHuman's default pose holds the arms 43° out, with the forearms bent forward and the hands in front. That reads as reaching. `buildMHBody(..., { armPose: ARM_POSE })` in `../twin-spike/mhavatar.js` now hangs the arms in the rest pose. `ARM_POSE` is `{ upper: 14, fore: 11, fwd: 0.08 }`. The upper arm turns about the shoulder, and the forearm and hand turn about the elbow. The vertices move by linear blend skinning with MakeHuman's own weights. The code builds the torso rings before the arms move, so the arm skin does not merge into the torso slices. The shirt, the colliders and the tape measure all read the posed body.

The idle animation adds no arm angle, so idle matches the rest pose. An earlier try rested the arms at 20° and added 0.1 rad inward in idle. The shirt was then built for a different arm than the one on screen, and the underarm cloth sank into the body (0.7% in idle). The try-on keys in `../avatar-poc/anim.js` hold the same absolute angles as before, shifted to the new rest pose. The chest twist is 60% of what it was, so the arms do not swing into the torso.

Two other changes come with it. The photo twin takes its body vertices from the posed body, so its arms match the skeleton. The grey briefs skip every vertex that is mostly skinned to an arm bone, because the hands now hang in the briefs band. The back stop no longer subtracts 4 mm from the measured gap. The cut left the underarm cloth pinched between arm and torso.

### Results with hanging arms

Same setup as above (jersey, chest + 10 cm, 10 s runs, `window.clothTest`). The percentage is the mean share of cloth vertices inside the body. The number in brackets is the most at one sample.

| Run | Man, 175 cm | Average woman, 163 cm | Target |
|---|---|---|---|
| Idle | 0.28% (6) | 0.16% (2) | 0.3% |
| Turn | 0.22% (5) | not run | 0.3% |
| Walk | 0.27% (6) | 0.25% (6) | 0.3% |
| Arms up (3 runs) | 0.46 to 0.62% (32 to 38) | not run | 0.7% |
| Try-on (3 runs) | 0.33 to 0.43% (10 to 12) | 0.25% (6) | max about 10 |
| Calm try-on | 0.38% (11) | not run | none |
| Physics step | 3.2 to 3.4 ms | 2.9 to 3.0 ms | 4 ms |

With the arms at their old 43° pose the same code gave 0% in idle, turn and walk. The small share now sits in the armpit, where arm and torso nearly touch. The man's try-on peak (10 to 12 vertices) is a little over the target of about 10. The runs vary by a vertex or two. The hands hang beside the thighs with the fingers pointing down. The shirt still wraps the neck and shoulders.

## Limits

- With the arms raised, about 0.6% of the cloth still goes inside the body (mean 8 vertices, mostly the trapezius and the sleeve caps). MakeHuman's shoulder bones count as the chest bone here, so the shoulder does not rise with the arm while the sleeve does. A larger clearance at the shoulder cap hides this at rest, but it makes the shirt stand off the shoulder, so the shoulder gap is still about 14 mm.
- The cloth is tied to the body. Walking moves it 8 mm from its place on average. That is calm, and it suits a fit check, but it is not a free-flowing fabric.
- The collar rides on the neck with 2 mm of play. Each extra collision hull costs about 0.2 ms, so the neck base has 5 thin plates and no more.
- The arms hang at 14° and cannot go lower. Below about 14°, MakeHuman's arm skin overlaps the torso at the armpit, and the shirt has no room there.
- With the arms hanging, the cloth under the arm is squeezed between arm and torso. A few vertices there (up to 12 of 1,400 in the try-on) sit up to 12 mm inside the skin for a moment. The armpit hides them.
- One garment shape. `shirt.js` still works on avatar-poc's mannequin body (its tests use it).
- The fabric values are estimates, not measured. The bend value has no effect in Jolt at this range (see How it works).
- There is no self-collision, so the cloth can pass through itself.
- The thickness is drawn, not simulated: 3 mm is more than a real jersey (about 0.6 mm), so the edges read at a glance.
