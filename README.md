# F1NA113VE1

[![Made for JS13K](https://img.shields.io/badge/Made%20for-JS13K-E5243B)](https://js13kgames.com/)
[![Made with GitHub Copilot](https://img.shields.io/badge/Made%20with-GitHub%20Copilot-8957E5?logo=githubcopilot&logoColor=white)](https://github.com/features/copilot)
[![Made with GPT-6 Astra](https://img.shields.io/badge/Made%20with-ChatGPT%206%20Astra-10A37F)](https://chatgpt.com/)

F1NA113VE1 is a tiny, rainbow-soaked infinite_-ish_ runner built for the js13kGames challenge.

You play as a green GitHub contribution square racing to avoid downtime, double-jumping over angry GitHub unicorn horns in a procedurally generated world. Each jump leaves a beautiful double rainbow. WHAT DOES IT MEAN!?!?

The game starts absurdly late, at the final level, and only gets faster and more frantic from there. Angry unicorn horns burst from the ground, drop from the ceiling, and occasionally fire across the screen.

Make it to the end (106,496 bits), and you win. LOL.

<p align="center">
  <img src="assets/gameplay.gif" alt="Seamless custom-level loop of the green contribution square jumping over rainbow unicorn horns and pits" width="720">
</p>

## How to play

Read the on-screen briefing, then press or tap to start:

- **Start:** your first press/tap both starts the run and performs the first jump.
- **Jump:** `Space` / `↑` / `W` / click / tap.
- **Jump higher:** hold the press. Release early for a shorter hop.
- **Double jump:** press *again while in the air*. You get two jumps, refreshed on landing.
- **Mute:** press `M`, or tap the speaker button (top-right). The mute button never starts a run or jumps.

Coyote-time and input-buffering give you a little leeway when timing jumps.

### Rainbow bits (combo bonus)

Glowing rainbow **bits** float along some jump arcs. Grabbing them builds a **combo** and adds a small
**bonus** shown in the HUD, tracked separately from distance and progress toward the finish.
Missing a bit resets your combo. Restarting clears your bits, bonus and combo.

### Fair, speed-aware obstacles

Obstacle spacing scales with your speed to leave room between hazards. Tall pillars, ceiling drops, falling horns,
saw blades, step-up horns and gates show a solid warning marker before they appear. Tests simulate the game physics
to check that each pattern can be cleared at minimum, middle and maximum speed.

- **Step-up horns:** tall horns with a short staircase before them. Jump onto the steps, then leap from the top.
  The first step is too high to walk onto, and the horn is too tall to clear with a double jump from flat ground.
- **Flappy gates:** a floor horn and a ceiling horn with a narrow corridor between them, à la Flappy Bird.
  Jump high enough to clear the bottom horn while staying under the top one. A full double jump clips the ceiling.

### Procedural terrain: platforms, steps & pits

Beyond the horn obstacles, the world builds itself from Geometry-Dash-style terrain that unlocks as you get faster:

- **Solid slabs:** fixed blocks with a green top edge. Landing on top refreshes both jumps, and their sides are safe
  to touch.
- **Stair steps:** a short ascending run of solid blocks. Ride up them or double-jump over.
- **Ground pits:** gaps in the floor marked with red edges. Jump across to the runway on the far side.
  Falling through a pit kills you, even if you try to jump or catch a wind tunnel on the way down.

Terrain follows the same spacing, boost and pause rules as the other obstacles.

### Things that are not on your side

Five occasional hazards unlock as you progress. Each gives you a warning before it activates:

- **Bashful platform:** a small rainbow platform with a `^_^` face. Landing on it refreshes both jumps, but as
  you get close it turns `>_<`, retreats and drops away. You can clear every hazard without it.
- **Hostile power-up:** a red spiked star with a pulsing `!`. Collecting it briefly speeds up obstacles while
  your distance and score continue at their usual rate.
- **Reverse boost:** a blue star marked `⇄`. Collecting it briefly scrolls the world backwards.
  Distance keeps climbing at the normal rate.
- **Wind tunnel:** a column marked with a `!` that turns into a purple updraft when active. Entering it flips
  gravity once, sending you from floor to ceiling or back again. You stay on that surface until the next tunnel.
  Hold, release and double-jump controls work in both directions. While inverted, new slabs, stairs and horns
  hang from the ceiling, and ceiling pits send you falling up through the world. Terrain affects runners on
  its own surface.
- **Nearly helpful spring:** a coil that bounces you when you land on it, about half as high as a regular jump.
  Your double jump is still available afterwards.

## Mobile & landscape

The game uses a **16:9** world in landscape, with support for dynamic viewport height (`dvh`) and safe-area insets.
Touch controls support press, hold, release and double-jump.

**Landscape is required.** Rotating to portrait pauses the game and shows a rotate prompt.
Return to landscape and tap to resume from where you left off. The resume tap only unpauses the game;
tap again to jump. Switching tabs or leaving the window also pauses the game.

## Reduced motion

The game follows your system's reduced-motion preference (`prefers-reduced-motion: reduce`), including changes
made during a run. This disables screen shake, flashing, rainbow trails and particles, the player's spin, and
background animation. Gameplay physics and timing stay the same, and hazard warnings use solid markers.

## Build / packaging

The whole game is a single self-contained `index.html`. The files in `assets/` are for the README.
Package the js13k submission archive with Python's standard library:

```sh
python3 scripts/package.py
```

This writes `dist/F1NA113VE1.zip` containing `index.html`, using fixed timestamps and permissions and DEFLATE level 9
for reproducible output. The archive is ignored by Git. Packaging fails if it exceeds **13,000 bytes**.

### About the byte limit

The js13k submission limit is **13,312 bytes zipped**. This project's **13,000-byte** packaging limit leaves a
little room to spare.

## Regression tests

Deterministic tests run the production code through Node's built-in test runner and `vm`:

```sh
node --test scripts/test.mjs
```

Coverage includes controls, jump timing, combos, scoring, mute, touch input, pause and resume, reduced motion,
and the packaging limit.

Obstacle and terrain tests exercise spacing and clearability across speeds, pit widths at random-number
extremes, slab landings, stair climbing, step-up horns and flappy gates. They also cover platform retreats,
boosts, springs, gravity flips, mirrored ceiling terrain, rendering and run resets.

## Theme interpretation

The theme was rainbows and unicorns. This game combines:

- GitHub's angry unicorn from its 500 pages
- A double-rainbow jump (get it? the old double rainbow meme?)
- Horns as obstacles
- A green GitHub contribution square
- A 1,337-bit milestone and 13 KB of everything

## Disclaimers, fun facts

🤓 Every commit in this repo starts with `133713`
📜 More time was spent writing the README than the game.
