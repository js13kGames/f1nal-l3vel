[![js13kGames](https://img.shields.io/badge/js13kGames-2026-E5243B?style=flat-square)](https://js13kgames.com/)
[![GitHub Copilot](https://img.shields.io/badge/Made_with-GitHub_Copilot-8957E5?style=flat-square&logo=githubcopilot&logoColor=white)](https://github.com/features/copilot)
![GPT-6 Astra](https://img.shields.io/badge/Powered_by-GPT--6_Astra-10A37F?style=flat-square)

Created for [js13kGames](https://js13kgames.com/) competition.
**Theme:** Rainbows and Unicorns. **Constraint:** web only, <= 13KB.

# F1NA113VE1

<p align="center">
  <a href="https://htmlpreview.github.io/?https://github.com/leereilly/rainbow-runner/blob/HEAD/index.html">
    <img src="assets/gameplay.gif" alt="F1NA113VE1 cover art" width="540">
  </a>
</p>

Race a green GitHub contribution square through the final level, double-jumping over angry unicorn horns and leaving double rainbows as you chase 106,496 bits of survival.

### [🌈 Play now →](https://htmlpreview.github.io/?https://github.com/leereilly/rainbow-runner/blob/HEAD/index.html)

**Controls:** <kbd>Space</kbd> / <kbd>↑</kbd> / <kbd>W</kbd> / click / tap to jump · hold to jump higher · press again in midair to double-jump · <kbd>M</kbd> or the speaker button to mute

Your first press starts the run and jumps. Movement is automatic. On mobile, play in landscape;
rotating to portrait or leaving the window pauses the game. Tap to resume, then tap again to jump.

## Features

- Speed-aware procedural obstacles, platforms, stairs and pits, with warning markers and forgiving jump timing.
- Double-rainbow trails, angry GitHub unicorn horns and a green contribution-square hero, with reduced-motion support.
- Collectible rainbow bits build combos and bonus points as the run gets faster; survive to 106,496 bits to win.
- Gravity-flipping wind tunnels, reverse boosts, retreating platforms and nearly helpful springs keep you on your toes.

## Development

Requires a modern web browser and Python 3.7+ for local serving and packaging.
Regression tests additionally require Node.js 18+.

The game is a single self-contained `index.html`; no dependencies need installing.
The files in `assets/` are for this README and are not included in the submission.

```sh
# Run locally, then open http://localhost:8000
python3 -m http.server 8000 --bind 127.0.0.1

# Build the submission
python3 scripts/package.py

# Run regression tests
node --test scripts/test.mjs
```

Build output: `dist/F1NA113VE1.zip`.

The reproducible archive contains only `index.html`. Packaging fails above **13,000 bytes**,
leaving a little room below the competition's **13,312-byte zipped** limit.
Regression tests cover controls, scoring, pause and resume, reduced motion, obstacle clearability,
terrain, gravity flips and the packaging limit.

## Contributing

Contributions welcome! This was a short-lived competition project, so ongoing
maintenance isn't guaranteed. Feel free to fork it and make it your own.

## License

[MIT](LICENSE).

## Fun fact

🤓 The commit-SHA challenge: make every commit hash start with `133713`.
