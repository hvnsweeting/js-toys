# Tachyon Cascade

A three-dimensional puzzle about guiding a falling beam through a crystal board. Place splitters to branch the beam and blocks to absorb it. Light every gold target, keep red voids dark, and meet the exact timeline count where a detector shows one.

The rules come from [Advent of Code 2025, day 7](https://adventofcode.com/2025/day/7) ([solution in Elixir](https://github.com/hvnsweeting/adventofcode/blob/master/aoc2025/lib/day07.ex)). The title screen animates the puzzle's example: 21 splits and 40 timelines.

## Run

Online: https://hvnsweeting.github.io/js-toys/tachyon-aoc2507/

```sh
make serve      # whole arcade at http://127.0.0.1:8000/tachyon-aoc2507/
./run.sh        # this game on 0.0.0.0:8099 for phones and iPad on the local network; ./run.sh stop
```

`HOST` and `PORT` override both defaults. Add `?quality=low` to the address on a slow device.

## Play

- Pick Splitter or Block, then click or tap a cell to place it; click or tap it again (or right click) to remove it.
- Fire sends the beam; Fire again finishes the animation at once. Undo and Reset are next to it.
- Keys: `1` splitter, `2` block, `Space` or `F` fire, `Z` undo, `R` reset, `M` mute, `Esc` menu. While a button has keyboard focus, `Space` presses that button instead. The title in the top bar also opens the menu.
- Campaign: 15 levels in three sectors; solving four levels in a sector unlocks the next. Stars: win, par pieces or fewer, timeline bonus.
- Cascade Rush: three minutes of generated boards. A solved board adds 20 seconds and score; there is no skip.
- Part 2: Timelines: six levels on the same board, with the same controls and music. Place crystals, fire the beam, and reach the exact number of exit timelines. The levels build toward the original example's 40 timelines. Progress shares the campaign save; completed rounds from the old Timeline Lab unlock the corresponding levels. The old `timeline-lab.html` address opens this mode.

## Development

See [AGENTS.md](AGENTS.md).

## Credits

Code, artwork in `assets/` and the music in `src/audio/music.js` were made with Codex.
