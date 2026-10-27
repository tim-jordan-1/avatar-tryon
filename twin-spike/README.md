# Twin spike: three face photos to a 3D head

A browser page that takes three photos of a face (front, left side, right side) and does four things:

- Finds 478 face points in each photo with MediaPipe Face Landmarker.
- Fuses the three point sets into one 3D face. Each side photo is aligned to the front photo, and each point is weighted by how directly a photo sees it.
- Marks hair and face skin with the MediaPipe selfie multiclass segmenter, then estimates hair length, hair colour and skin tone.
- Builds a 3D head from the MakeHuman base mesh (CC0), shaped and textured from the photos. Hair is not rendered from the photos: the plan is a preset list the user picks from, pre-selected by the length and colour estimate.

All analysis runs in the browser. The photos are not uploaded. The page downloads the MediaPipe models (about 20 MB) from Google and the MakeHuman mesh (1.7 MB) from jsDelivr the first time.

## How the head is built

1. Matching points. When the page loads, it renders the bare MakeHuman head from the front and runs the face landmarker on that render. Each of the 468 face points gets the front-most head vertex under it. About 400 unique matches remain.
2. Shape. A similarity transform puts the MakeHuman head into the photos' frame. A radial basis function (RBF) warp then moves each matched vertex onto the fused face point and moves every other vertex smoothly. Vertices well behind the ears and at the neck base are fixed anchors. Matches that would move a vertex more than 3 times the median move are dropped as wrong matches.
3. Skin. Each triangle takes its texture from the photo that sees it most directly, but only where the segmenter marks that spot as skin. Other triangles get the measured skin tone. The eyes take the front photo.
4. Hair. Not rendered. A procedural hair-card attempt looked poor and was removed. The hair estimate still shows in the page, to pre-select a hair preset later.

## Run it

1. Start a static server in this folder.

   ```bash
   python3 -m http.server 8767 --bind 127.0.0.1 --directory twin-spike
   ```

2. Open http://localhost:8767 in Chrome or Safari.
3. Choose the three photos, or click a sample button. Then click **Analyse and build head**.

Chrome cannot open HEIC photos from an iPhone. Convert them to JPEG first, for example with `sips -s format jpeg IMG_1489.HEIC --out front.jpg`, or use Safari.

Put your own photos in `.private/`. Git ignores that folder.

## Test it

```bash
node --test twin-spike/
```

The tests check that the alignment recovers a known rotation, scale and shift exactly, and that the fusion recovers a 55° head turn within 1.5° from noisy points. They also check the hair rules on synthetic masks (short dark brown, neck-length black, long blonde, no hair), and that one outlier photo cannot decide the length.

## Head on the measured body

The page shows the twin head on a full MakeHuman body fitted to tape measurements (height, chest, waist, hip, shoulders, inseam; thigh and calf from ANSUR II median ratios of the hip). `mhbody.js` does the fit:

1. Body shape: MakeHuman's default young male or female, from its CC0 shape targets (the three ethnic young targets at 1/3 each, plus the universal one). Neutral uses the bare base mesh.
2. Landmarks: horizontal slices find the crotch, hip, waist, chest, armpit, shoulder line and neck from the cross-sections alone.
3. Heights: feet to crotch maps to the inseam, crotch to neck to the rest of the height; the head keeps its proportions.
4. Girths: each slice's torso (or each leg's) cross-section is scaled about its own centre, so its tape girth becomes the target. Legs are told apart by mesh connectivity, not by the sign of x, because wide thighs cross the mid-line.

The twin head is the same MakeHuman head vertices, warped to the face, so it joins the body with no seam: the vertices it shares with the neck are taken from the body.

Checks:

- Fitting three profiles on the real MakeHuman mesh, an independent tape reads every target within 0.6 cm (height, chest, waist, hip, shoulders, inseam, thigh, calf).
- `mhbody.test.mjs` fits the avatar-poc body to two new profiles and measures it with avatar-poc's tape (`measure.js`, separate code): every value within 1 cm.
- ANSUR II, the same held-out 3,038 people as the avatar-poc check: the fitted MakeHuman body's volume, with a density fitted on the other half (1.056 kg/L, close to real human body density), predicts scale weight with 3.1% mean error (men 2.8%, women 3.8%), 98% within 10%. The avatar-poc mannequin scores 2.6% at its own fitted density of 1.008 kg/L. At 1.00 kg/L the MakeHuman body reads 5.5% low.

## Hair presets

Hair is not built from the photos. The user picks a preset; the default is the one for the detected length class. `hair-presets.js` lists 8 MakeHuman system hair styles (CC0) and fits them with their `.mhclo` files: each hair vertex is a weighted mix of 3 base-mesh vertices plus an offset, evaluated on the warped head, so the hair follows the face fit. The texture is recoloured to the estimated hair colour, keeping its light and dark pattern and its alpha.

The official MakeHuman hair ships only in a zip, so the URLs point at a pinned GitHub mirror of the MakeHuman tree (`MaximovIlya/makehuman@cff2384`), checked byte-identical against a second mirror. jsDelivr refuses files from that repo above its 50 MB package limit (one texture already uses raw.githubusercontent.com). Before shipping, copy the hair assets to a small repo of our own.

## Results

The samples are renders with a known answer. `scan-*` is a scanned head with no hair (Lee Perry-Smith, CC BY 3.0), turned ±57°. `human-*` is the MakeHuman body with short dark-brown hair (`#2b1e17`), turned ±54°. The third row is one real person's iPhone selfies. Those photos are not in the repository.

| Set | Head turn found (truth) | Hair found (truth) |
|---|---|---|
| Human render | 0°, 50°, −56° (0°, 54°, −54°) | Short, dark brown `#3b2d29` (short, `#2b1e17`) |
| Scan render | 0°, 48°, −57° (0°, 57°, −57°) | None or shaved (none) |
| Real selfies | 0°, 44°, −43° (about 45°, not measured) | Medium (neck length), dark brown `#302727` (neck-length, very dark brown) |

The fused face fits each photo within 2.4 to 4.6 mm. The left-side turn reads 4° to 9° low on both renders.

The real photos found one fault, now fixed. The first length rule measured where the hair ends relative to the chin. Neck-length hair behind the ears ends above the chin, so it scored as short. The rule now measures how far the hair hangs below the ear, and takes the median over the three photos. The median matters: on the human render, one side photo has a dark shadow under the ear that the segmenter marks as hair.

## Limits

- Sizes in mm assume 90 mm between the outer eye corners, the adult average. A real product needs a reference, for example a card held in the photo.
- The hair length thresholds come from two renders and one real person. They need a test set of real people with known hair lengths.
- The hair colour is the median of the hair pixels, with no correction for the colour of the light.
- The back of the head and the ears are the MakeHuman shape, scaled to the face. Only the face is measured.
- Without hair, the hairline edge of the face texture is ragged where hair covered the forehead in the photos.
- The face texture switches photo per triangle, so exposure differences between the photos show as seams.
- On the three test sets the largest warp move was 14 to 16 mm and 22 to 24 of about 430 matches were dropped as outliers.
- MediaPipe guesses points that a side photo cannot see. The visibility weights reduce, but do not remove, their effect.
