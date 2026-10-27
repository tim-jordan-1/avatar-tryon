# Avatar Try-On

Avatar Try-On is a Chrome extension. It shows how a t-shirt from the shop page you have open fits a 3D avatar that it builds from your measurements. The avatar is the MakeHuman body, fitted to your tape measurements. The shirt is a JoltPhysics soft body cloth. Optional face photos give the avatar your skin tone and hair. Everything runs in your browser, and nothing is uploaded.

## Folders

| Folder | What it holds |
|---|---|
| `extension/` | The Chrome extension: side panel, page reader, build script and store material. Start here. |
| `cloth-spike/` | The cloth simulation and the try-on scene. |
| `avatar-poc/` | The skeleton, the measurement checks and the animation. |
| `twin-spike/` | The MakeHuman body fit and the face photo head. |
| `fit-map/` | Size chart parsing and the fit result for each size. |
| `example-shop/` | A demo product page for testing. |
| `ui-mockups/` | Design mockups and screenshots. |
| `docs/` | The GitHub Pages site, with the privacy policy. |

Each folder has its own README.

## Build and test

You need Node.js 20 or later and Python 3.

```bash
node extension/build.mjs
```

```bash
node --test cloth-spike/ twin-spike/ avatar-poc/ fit-map/ extension/
```

To load the extension, read `extension/README.md`. To make the Chrome Web Store zip, run `node extension/build.mjs --release`.

## Links

- Privacy policy: https://tim-jordan-1.github.io/avatar-tryon/privacy-policy
- Third-party licences: `extension/NOTICES.md`
- Support: lix5821@gmail.com
