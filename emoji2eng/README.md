# Emoji2Eng 🔤

A vocabulary game where you guess the missing letter from emoji names!

## How to Play

1. **Pick a category** — choose from Smileys, Animals, Food, Activities, Travel, Objects, Nature, or Random Mix
2. **See the emoji** — a big emoji is displayed with its English name below, but one letter is missing
3. **Guess the letter** — pick from 4 choices, only one is correct
4. **Track your score** — complete 10 rounds and see your star rating

## Example

```
🍑
[_]each

[p] [t] [m] [r]
```

The answer is **p** → "peach"

## Development

```bash
# Start local server
make serve

# Run tests (requires Firefox with Marionette)
make test
```

## Architecture

- **Functional Core**: `js/emoji-data.js` and `js/game-logic.js` — pure functions, no DOM, injected randomness
- **Imperative Shell**: `js/app.js` — DOM manipulation and event handling
- **Tests**: In-browser test suite using the shared `test-framework.js`

## Tech Stack

- Vanilla JavaScript (no npm, no build tools)
- IIFE module pattern
- CSS with retro arcade theme (Press Start 2P font)
