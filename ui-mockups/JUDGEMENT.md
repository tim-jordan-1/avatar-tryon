---
title: Avatar Try-On side panel mockup judgement
type: wiki-article
generated_by: claude
created: 2026-10-27
---

# Avatar Try-On side panel mockup judgement

I read each HTML file and looked at each PNG. Then I rendered every mockup with Playwright at 400x860 and 360x700 and clicked through the main controls: size change, the four view buttons, every motion, tabs, the bottom sheet, the setup steps, the profile drawer, the heatmap toggle and compare. I checked page overflow and element overlap with measured bounding boxes. No mockup logged a console error or scrolled sideways at either size.

## Scores

| Criterion (weight) | A Studio | B Editorial | C Fit-first |
|---|---|---|---|
| Sleekness (25%) | 9 | 7 | 7.5 |
| Modernization (25%) | 8.5 | 7 | 8.5 |
| Ease of use: fast, clear size answer (30%) | 7.5 | 6.5 | 8 |
| Overall visual layout (20%) | 7 | 7 | 7.5 |
| **Weighted total** | **8.03** | **6.85** | **7.90** |

## A Studio

A is the most polished of the three. It uses a dark stage with frosted glass controls, a labelled motion rail, a view pill and a bottom sheet with three snap points. The size answer is visible without scrolling at both sizes: "M fits you best" sits next to the size chips, with a recommendation sentence under them. Its fit rows give the most trustworthy view of the data. Each row has a range track. It puts your measurement ("You 98") on the size range ("M 95-101 cm"). The coloured pins on the avatar change with the size. The weaknesses show at 360x700. The stage gets cramped, the view pill covers the avatar's legs, and the sheet shows only one fit row before you scroll inside it. A is also dark only, while production follows the system theme. In the size fieldset, the `legend` sits inside a div, so the size radio group has no accessible name. Pins on a WebGL avatar are easy to do: project a 3D anchor point to the screen every frame.

## B Editorial

B has the warmest personality and the best copy. The serif "Your size *M*" verdict comes with a plain sentence about the fit. A shopper can trust that kind of answer. It is also the only mockup that designs the first run: three numbered steps (measurements, optional face, read the page), a "How to measure" disclosure and a clear "Skip for now". The fitting room is a long stack of cards, though. The verdict starts 753 px down the page, so it is below the fold at 360x700 and only just shows at 400x860. The region dots snap to four fixed buckets instead of showing where your number falls, so they say less than A's tracks. At 360 px the size chips wrap XXL onto a second row, and the profile summary text wraps awkwardly beside its chevron. B is light only. Its step change calls `focus()` on an `h1` that has no `tabindex`, so keyboard focus does not move.

## C Fit-first

C is the most feature-dense and gets you to a full answer fastest. The verdict ("M · Good fit"), a plain summary, the size scrubber and the per-region pills are all above the fold at 400x860. It adds ideas the others lack. It has labelled callouts beside the avatar, a fit heatmap and a mini fit strip under each size. It has an A/B compare mode that writes the change ("In XL, shoulder and length become loose"). The profile opens in a modal `dialog` drawer. It also supports light and dark themes. The heatmap is on by default. So the navy tee shows as a green and blue shirt, and the shopper cannot see the real product. The view switcher and the stage edge crop the avatar at the knees in every view. The mini strips are 4 px tall and need a sentence of explanation. The recommended dot in the note under the scrubber is squashed to a sliver because it is missing `flex: none`. Measurement entry hides behind a person icon, and a first-time shopper can miss it. The heatmap and callouts can be done in WebGL with per-vertex region colours on the cloth mesh and projected anchors. Two avatars side by side mean two cloth simulations in a small panel, which is costly but possible.

## Winner

**A Studio**, narrowly ahead of C. A looks the most finished, its controls are labelled, and its range tracks make the size answer easy to trust. C has the better feature set, so most fold-ins come from C.

## Fold into A

1. **Plain-language verdict from B.** Show the size large with a sentence that explains the fit. If the shopper picks a different size, show a "We suggest M" flag.
2. **First-run setup from B.** If no measurements are saved, show the three steps and "How to measure". Returning users go straight to the stage.
3. **Callouts and an optional heatmap from C.** Turn A's pins into small labelled chips ("Chest · good"). Add a heatmap toggle that is off by default, so the real garment colour shows first.
4. **Compare as text first, from C.** Add a "Compare" control that shows two pill columns in the fit table and the diff sentence. If a second drape is cheap enough, add side-by-side avatars.
5. **Light theme from C.** Add a `prefers-color-scheme` light palette so A matches production and the browser.

A also needs three fixes. Make `legend` the first child of the size fieldset. Keep the view pill clear of the avatar at 360x700. Show at least two fit rows at the sheet's peek height.
