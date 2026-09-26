# Tiny Living City

A tiny procedural city diorama in Three.js: 44 pedestrians, 8 vehicles, traffic signals,
a full day/night cycle, rain, and 1x / 10x / 100x time-lapse.

## Run
ES modules need http:// (not file://). From this folder:

    npx serve .            # or
    python3 -m http.server 8000

Then open http://localhost:8000 (or the port shown). Three.js r160 is loaded from jsDelivr (internet required).

## Controls
| Action | Mouse / UI | Key |
|---|---|---|
| Orbit / pan / zoom | drag / right-drag / wheel | |
| Pause / play | ⏯ | Space |
| Speed | 1x · 10x · 100x | 1 · 2 · 3 |
| Weather | Clear / Rain | R |
| Cinematic camera | Cinematic | C |
| Reset camera | ⌂ | 0 |
| Hide UI (for recording) | | H |
| FPS counter | | F |
| Time of day | slider under the title | |

## Files
- `sim.js` – simulation only (no rendering): layout, waypoint graph, signals, pedestrians, cars, clock, weather
- `world.js` – static diorama (merged geometry per material + instancing), window glow shader, per-frame world updates
- `actors.js` – instanced pedestrians (walk cycle, sitting, umbrellas) and cars (headlights, brake lights)
- `atmosphere.js` – sky shader, time-of-day palette, sun/moon, stars, clouds, rain + splashes, reflection map
- `main.js` – renderer, bloom, camera / cinematic mode, UI, main loop

## Tips for recording
Press **H** to hide the UI, **C** for cinematic mode, and **3** for 100x (a full day takes about 14 s).
Try toggling rain at sunset.
