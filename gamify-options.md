---
title: Gamified try-on avatar, three options
type: wiki-article
generated_by: claude
created: 2026-10-27
---

# Gamified try-on avatar: three options

The goal: when the avatar puts on a new shirt, it acts like a game character. It looks down and around at itself, gets excited, and does a short try-on animation. The panel gets small game touches too.

Two research agents looked at this on 2026-10-27. One searched the web (game and fashion-app patterns, animation methods, licences). The other read this codebase (where the animation plugs in, what the cloth simulation can take).

## What the research found

- The rig has 17 bones: hips, spine, chest, neck, head, and per side the upper arm, forearm, hand, thigh, shin and foot. That is enough to look down, twist, hop and pump a fist. There are no finger or clavicle bones.
- `avatar-poc/anim.js` sets every bone from the clock each frame. A new timed sequence is one more branch, driven by time since it started.
- The cloth is a Jolt soft body with no continuous collision. A hand that moves faster than about 1.5 m/s can push a sleeve vertex through the arm collider. Each vertex can drift 1 to 4 cm from its skinned place, so a hop must stay under about 5 cm.
- Ready Player Me shut down on 31 January 2026 after Netflix bought it. Cloud avatar services also break the offline rule of this extension.
- Mixamo allows use in a product, but not sharing the raw animation files. An extension is easy to unzip, so bundling Mixamo files is a grey area. Quaternius clips are CC0.
- The best reward moments are short (1 to 2 s), can be skipped, and do not repeat for no reason. Sound must not play by itself. People who set reduced motion must get a calm version.

## The options

| | A. Procedural "juice" | B. A plus baked CC0 clips | C. VRM pipeline |
|---|---|---|---|
| What | Try-on sequence written in code (look down, twist, hop, fist pump, settle), a livelier idle, rim light, sparkles and an "Outfit equipped" card | A, plus 2 or 3 Quaternius clips retargeted to this rig offline and shipped as JSON | Convert the body to VRM, use VRMA clips and the MToon toon shader |
| Feel | Snappy, made for this skeleton | The most "game character" energy | Anime look |
| Effort | About 1 day | 3 to 5 days | Large |
| Download size | Under 50 KB | 100 to 400 KB more | Several hundred KB and a new loader |
| Licence risk | None | Low, check each file | Low (MIT) |
| Cloth risk | Low: we set the speeds | Medium: mocap moves fast, and the A-pose rest differs | Medium to high: new rig under the shirt |
| Fit accuracy | Kept | Kept | At risk: the measured body must be converted |

## Choice

Option A. It gives the try-on moment the user asked for. It adds no download and has no licence risk. We set its speeds, so they stay inside what the cloth can take. If A feels flat, add one or two baked CC0 clips (option B) later.
