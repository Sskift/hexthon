# Reroll button templates

`reroll-unused.png` and `reroll-spent.png` are copied from the MIT-licensed
[Sygnano/aram-mayhem-tracker](https://github.com/Sygnano/aram-mayhem-tracker)
at commit `ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1`:

- [`crates/mayhem-vision/assets/reroll/unused.png`](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/assets/reroll/unused.png)
- [`crates/mayhem-vision/assets/reroll/spent.png`](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/assets/reroll/spent.png)

The upstream MIT notice is preserved in `LICENSE-Sygnano.txt`. The associated
layout measurements, reroll NCC detector and striped title fingerprint were
adapted into `src/core/scene-gate.cjs`, with attribution in that file.

These small templates identify possible visible augment cards. They do not
establish remaining reroll counts, selected augment history, or a particular
game mode. Game artwork and trademarks remain the property of their respective
owners; the project's source-code license does not transfer those rights.

Fixtures are used only for offline verification. No screenshot, captured player
text, or full upstream game screenshot is bundled here.
