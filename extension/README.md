# Avatar Try-On: Chrome extension proof of concept

A Chrome extension with a side panel. It reads the product page you have open (name, colour, material, fabric weight, size chart). It then shows a 3D avatar built from your tape measurements, wearing the t-shirt in the product's colour. The panel recommends a size, shows the fit per body region (tight, snug, good, loose), and simulates the cloth from the material text while the avatar idles, walks, turns or raises its arms.

Everything runs on your computer. Your measurements stay in Chrome's extension storage.

## Try it

1. Build the extension. This downloads three.js, JoltPhysics.js, MediaPipe (code, wasm and the two face models) and the MakeHuman data (about 43 MB in all, cached in the OS temp folder) into `build/vendor/`, because extension pages may not load scripts from a CDN, and the face analysis must work offline.

   ```bash
   node extension/build.mjs
   ```

2. Serve the example product page.

   ```bash
   python3 -m http.server 8767 --bind 127.0.0.1 --directory .
   ```

3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the folder `extension/build`.
4. Open http://localhost:8767/example-shop/ (Demo Store, "Everyday Crew Tee").
5. Click the extension's toolbar button (pin it from the puzzle-piece menu if you do not see it). The side panel opens with your avatar.
6. Click **Read page** at the top right. You get the product, a recommended size, the fit per body region, and the shirt on the avatar.
7. Things to check:
   - Click the **S** size chip: chest and waist turn "tight", and the shirt gets smaller. A "We suggest M" tag shows that M is still the recommended size.
   - Click **Walk** or **Arms** in the motion bar on the right: the cloth follows the body.
   - Drag in the 3D view to orbit. Scroll to zoom. Use Front, Side, Back and ¾ under the avatar.
   - Open the **Me** tab. Enter your own measurements, pick Male or Female, and click **Save and rebuild avatar**.
   - Open the **Face** tab. Click **Take photos with camera** (see below), or choose three photo files and click **Use these photos**.

## The panel

The avatar fills the top of the panel. A bar at the top shows the product name, its colour, the fabric and the **Read page** button. A small status message shows under the bar while the panel works, and stays there if something fails.

A sheet at the bottom holds the size choice. It shows the selected size in large type and one sentence about how it fits. The recommended size has a green dot. Under the sizes are three tabs:

- **Fit**: one row per body region. Each row shows your measurement as a dot on the range of the selected size, and says tight, snug, good or loose. Under the rows is the fabric that the cloth simulation uses.
- **Me**: your measurements and sex.
- **Face**: the camera button, the three photo slots and the face analysis.

When you press **Read page**, or choose another size, the avatar tries the shirt on. It looks down at the shirt, turns to see its sides, hops and settles. A card shows over the stage for about 2 seconds with the product, the size and the fit: **Perfect fit** if every region is good, **Tight fit** if any region is tight, and **Good fit** otherwise. Click the card or press Escape to close it. Sparkles show behind the avatar and a coloured rim light shows on it while it tries the shirt on. A rebuild of the avatar does not start this.

The **Effects** switch under the motion buttons turns off the try-on animation, the card animation, the sparkles and the rim light. The card still shows. The panel keeps your choice in this browser. If your system is set to reduce motion, Effects is off at first. If you turn it on, the avatar does a calm version and there are no sparkles.

To make the sheet taller, drag its handle up or click the handle. Drag it down or click it again to make it short. The panel follows the light or dark setting of your system.

Before you read a page, the Fit tab says what to do. If the page has no usable size chart, the Fit tab says so and why. If the avatar cannot be built, the stage says so, and the size advice still works.

After you change a source file, run the build again and click the reload icon on the extension's card in `chrome://extensions`.

## Face photos

**Take photos with camera** opens `capture.html` in a new tab (Chrome does not reliably show the camera prompt in a side panel). Click **Start camera** and allow it. The page watches your head turn with MediaPipe and takes each photo by itself when the pose holds for about 0.4 s: first straight at the camera, then a turn to each side (35 to 70 degrees, either side first). A ring fills while you hold the pose, and the shutter flashes at each photo. You can retake any photo. **Use these photos** saves them, stops the camera and closes the tab. The panel then analyses them (hair length and colour, skin tone) and rebuilds the avatar.

Photos are JPEG data URLs in `chrome.storage.local` (key `photos`). Nothing is uploaded. **Remove photos** deletes them.

## Other shops

The panel can read any page, but the try-on needs a body-measurement size chart in an HTML table with a chest row, and it only simulates t-shirts. On `localhost` it reads pages without asking. On other sites, the first time you press **Read page**, Chrome asks to let the extension read and change your data on all websites. Choose **Allow**. Chrome keeps the answer, and you can remove it later in the extension's details in `chrome://extensions`. Without it, Read page works only on a tab where you clicked the toolbar button, until that tab goes to another site. Many real shops show the size chart in a pop-up or load it later, so open the size guide first. On H&M product pages you do not need to open the size guide. H&M loads its chart only when the guide opens, and then shows one size range at a time, so the panel fetches the whole chart from H&M's size guide address instead (`/pxa/v1/<locale>/hm/sizeguide/<article>`). The panel reads the product name, material and description from the page's structured product data. It also accepts a `ProductGroup` (a product with colour and size variants). For a `ProductGroup` the panel takes the colour of the variant whose address is the open page's (on H&M, the colour you picked has its own address). The shirt gets that colour: fashion names such as "Dark grey" or "Navy blue" map to a fabric tone, other names are tried as CSS colour names ("Slate Blue"), and a name that is neither keeps the default blue. After you pick another colour on the shop, press **Read page** again: the shirt changes colour and the avatar is not rebuilt. Once a page was read, the panel also does this by itself when the open tab moves to another address on the same site and has loaded (H&M loads a new page when you click a colour).

## Files

| File | What it does |
|---|---|
| `capture.html`, `capture.js` | The guided camera capture page. |
| `capture-core.js` | The capture logic with no browser APIs: head yaw from the pose matrix, the hold-steady state machine, side labelling by yaw sign. Tested by `capture-core.test.mjs`. |
| `photo-store.js` | Saves and loads the three photos (`chrome.storage.local`, or `localStorage` as a plain page). |
| `manifest.json` | Manifest V3: side panel, `scripting`, `activeTab`, `storage`; `wasm-unsafe-eval` for the physics engine. |
| `background.js` | Opens the side panel when you click the toolbar button. |
| `extract.js` | Runs inside the product page: reads JSON-LD Product data, the material and gsm from the text, and every table as markdown. |
| `panel.html`, `panel.js` | The side panel. Uses `../cloth-spike/tryon.js` (avatar and cloth), `../fit-map/` (size charts) and `../avatar-poc/body.js` (measurement checks). |
| `build.mjs` | Builds `build/`: copies these files and the shared modules, downloads the libraries, and rewrites their imports to the local copies. |
| `icons/` | The toolbar and store icons (16, 32, 48 and 128 px) and their SVG source. |
| `NOTICES.md` | The licences of the bundled libraries, models and MakeHuman data. It goes into the zip. |
| `store/` | The Chrome Web Store material: listing text and permission reasons (`listing.md`), screenshots and the promo tile. The privacy policy is `../docs/privacy-policy.html`, published with GitHub Pages at https://tim-jordan-1.github.io/avatar-tryon/privacy-policy. |

## Release build

To make the zip for the Chrome Web Store, run:

```
node extension/build.mjs --release
```

The release build removes the devtools hooks (`window.__tryon`, `window.__capture`) and the `localhost` host permissions, then writes `dist/avatar-tryon-<version>.zip`. Before each upload, increase `version` in `manifest.json`. After a release build, run the build again without `--release` before you use the test scripts, because they need the devtools hooks.

To test the panel without loading the extension, build it and open http://localhost:8767/extension/build/panel.html. Outside the extension, **Read page** reads the bundled example page instead.

## Checked

Checked as a plain page in a browser, not as a loaded extension:

- The example reads as Everyday Crew Tee, Slate Blue, 95% cotton 5% elastane, 180 gsm, jersey.
- For the default man (178 cm, chest 100 cm), the panel recommends M, with chest, waist and hip all "good". Size S shows chest and waist "tight" and hip "snug".
- The avatar is the MakeHuman body fitted to the measurements, in grey briefs. With size M, the shirt has a garment chest of 112 cm. Over a 10 s walk, 0.09% of the cloth vertices go inside the body, and the physics step takes 2.4 ms.
- With the sample photos stored, the panel builds the photo twin: the head textured from the photos and the body in the measured skin tone, skinned to the same skeleton. Over a 5 s walk, 0.1% of the cloth vertices go inside the body.
- If the avatar cannot be built (for example, a model file fails to load), the panel says why instead of staying empty. The fit table still works.
- Face photos, as a plain page: the three samples in `twin-spike/samples/` give the analysis table (short dark brown hair, skin tone), and the built panel makes no request outside `localhost`. A fake camera (a canvas stream cycling through the samples) takes the front photo and both sides, in either side order, and puts each in the right slot.
- `node --test extension/` tests the yaw, the steady-pose state machine, the hints and the side labelling.

Not checked here: the extension-only code paths (`chrome.scripting.executeScript` on the tab, `chrome.storage`, opening the side panel, `chrome.tabs.create` for the capture tab), the extension's CSP with MediaPipe, and the real camera (permission prompt, the hold timing, the sharpness limit `MAX_JITTER`, the yaw window on a real turning head). Your manual test in Chrome covers them.

## Limits

- One garment shape: a t-shirt. The garment is the size's top chest value plus 8 cm of ease, not the shop's garment measurements.
- The avatar is the MakeHuman body (CC0) fitted to the tape measurements, with MakeHuman's own skin weights. It has no hair yet: the hair presets from `twin-spike` are not in the panel.
- Fabric parameters are estimates from the material text (see `../cloth-spike/fabric.js`).
- With the arms raised, 1 to 2% of the cloth still goes inside the body (see `../cloth-spike/README.md`).
- The photo face has a ragged edge at the forehead, where the photo texture meets the plain skin.
