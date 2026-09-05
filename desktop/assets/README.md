# InkMind desktop icon

The icon uses a terracotta tile and a single ivory fountain pen nib. The simpler silhouette remains legible in the Dock, while the warm palette follows `DESIGN.md`.

- `icon-master.png`: source artwork, generated with the built-in imagegen tool from the previous InkMind icon, then given a transparent background.
- `../icon.png`: the 1024px application asset, generated from the master.
- `../../images/favicon.png`: 320px artwork used by both READMEs at 160px display size.
- `../../frontend/public/favicon.png`: 64px browser favicon. The HTML and README references include a version query to refresh cached artwork.
- `../build/icon.icns`: macOS icon container; generated, not committed.
- `../scripts/build-icons.mjs`: preserves alpha, adds transparent padding, applies the final rounded tile boundary, and exports normal/Retina sizes using Sharp and macOS `iconutil`.

Run `npm run build:icons` from `desktop` after replacing the master. `npm run package:mac` includes this step. Keep the transparent margin: the tile occupies about 82% of the canvas so it sits comfortably beside other Dock icons. Check both small sizes and the transparent boundary before packaging.

## Generation prompts

Tool: built-in imagegen (no CLI/API fallback). Input: the previous `desktop/icon.png`.

### Artwork

> Use case: style-transfer / logo-brand. Edit target: attached existing InkMind application icon. Redesign into one finished premium macOS desktop app icon for a quiet novel-writing tool. Preserve the fountain pen nib concept, but remove the circular badge, face, circuitry branches, pale blue palette, white square background, and excessive whitespace. New design: centered rounded-square/squircle tile with a restrained soft terracotta ceramic surface (brand #cc785c, deeper #a9583e along lower edge), subtle dimensional edge and softly lit upper edge, no heavy glossy effect. A single bold, elegant ivory #faf9f5 fountain pen nib silhouette centered, pointing diagonally toward lower left, simple recognizable central slit and small circular breather hole revealing terracotta, no text. Beautiful balanced geometry, editorial, confident and calm. The nib fills about 60% of the tile width, clearly recognizable at 32px; avoid thin ornament. Frontal orthographic icon, no tilted tile, no perspective. 1024x1024 square canvas. Tile spans about 84% of canvas (86px margin each side), large continuous rounded corners. True alpha transparency outside the rounded tile, never white or checkerboard baked into image. Subtle short shadow only. Return one isolated production icon, not a mockup, no labels, no surrounding scene.

### Transparent master

> Use case: background-extraction. Edit target: the attached terracotta InkMind macOS icon. Keep the terracotta tile and ivory pen nib exactly as drawn. Remove ALL the gray-white checkerboard outside the rounded square. Output a real RGBA PNG with alpha = 0 outside the tile. Do NOT draw or bake a checkerboard to represent transparency; the pixels must actually be transparent. Remove the exterior drop shadow too so the cutout has clean anti-aliased alpha edges. Center the icon in a square canvas with 8% transparent margin each edge. No other visual changes, no text, no replacement backdrop. This file is directly used as a macOS app icon, so a checkerboard or opaque square backdrop is a bug.
