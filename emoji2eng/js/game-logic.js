/**
 * Game Logic - Pure functions for emoji2eng puzzle mechanics.
 * No DOM, no I/O. All randomness is injected via parameters.
 */
(function (global) {
  'use strict';

  /**
   * Create a puzzle from an emoji entry by blanking one letter.
   * blankIndex is clamped to valid range.
   * Returns: { char, name, blankIndex, maskedName, correctLetter }
   */
  function createPuzzle(emoji, blankIndex) {
    var name = emoji.name;
    var clamped = Math.max(0, Math.min(blankIndex, name.length - 1));
    var correctLetter = name[clamped];
    var maskedName = name.slice(0, clamped) + '_' + name.slice(clamped + 1);

    return {
      char: emoji.char,
      name: name,
      blankIndex: clamped,
      maskedName: maskedName,
      correctLetter: correctLetter,
    };
  }

  /**
   * Pick a valid blank index for a word (skipping spaces/hyphens).
   * randomFn is injected for deterministic testing.
   */
  function pickBlankIndex(name, randomFn) {
    var rng = typeof randomFn === 'function' ? randomFn : Math.random;

    // Collect indices of alphabetic characters only
    var letterIndices = [];
    for (var i = 0; i < name.length; i++) {
      if (name[i] >= 'a' && name[i] <= 'z') {
        letterIndices.push(i);
      }
    }

    if (letterIndices.length === 0) {
      return 0;
    }

    var pick = Math.floor(rng() * letterIndices.length);
    return letterIndices[pick];
  }

  /**
   * Generate 3 distractor letters from candidates, excluding the correct letter.
   * Picks from the same class: vowels if correct is a vowel, consonants otherwise.
   * shuffleFn randomizes the filtered pool before picking (injected for testability).
   * Returns array of 3 unique wrong letters.
   */
  function generateDistractors(correctLetter, candidateLetters, shuffleFn) {
    var lower = correctLetter.toLowerCase();
    var vowels = 'aeiou';
    var correctIsVowel = vowels.indexOf(lower) !== -1;

    var filtered = [];
    var seen = {};
    for (var i = 0; i < candidateLetters.length; i++) {
      var c = candidateLetters[i].toLowerCase();
      var cIsVowel = vowels.indexOf(c) !== -1;
      var sameClass = correctIsVowel === cIsVowel;
      if (c !== lower && !seen[c] && sameClass) {
        seen[c] = true;
        filtered.push(c);
      }
    }

    if (shuffleFn) {
      filtered = shuffleFn(filtered);
    }

    return filtered.slice(0, 3);
  }

  /**
   * Combine correct letter + distractors and shuffle using provided shuffleFn.
   * Returns array of 4 letters.
   */
  function createAnswerOptions(correctLetter, distractors, shuffleFn) {
    var options = [correctLetter].concat(distractors);
    return shuffleFn(options);
  }

  /**
   * Check if the selected letter matches the correct one (case-insensitive).
   * Returns { correct: boolean }
   */
  function checkAnswer(selected, correctLetter) {
    return {
      correct: selected.toLowerCase() === correctLetter.toLowerCase(),
    };
  }

  /**
   * Create initial round state from an emoji list.
   * Returns immutable-style state object.
   */
  function createRoundState(emojiList) {
    return {
      emojis: emojiList.slice(),
      currentIndex: 0,
      score: 0,
      total: emojiList.length,
    };
  }

  /**
   * Advance round state after an answer. Returns NEW state (no mutation).
   */
  function advanceRound(roundState, wasCorrect) {
    return {
      emojis: roundState.emojis,
      currentIndex: roundState.currentIndex + 1,
      score: roundState.score + (wasCorrect ? 1 : 0),
      total: roundState.total,
    };
  }

  /**
   * Check if all emoji in the round have been answered.
   */
  function isRoundComplete(roundState) {
    return roundState.currentIndex >= roundState.total;
  }

  // Export to global scope
  global.createPuzzle = createPuzzle;
  global.pickBlankIndex = pickBlankIndex;
  global.generateDistractors = generateDistractors;
  global.createAnswerOptions = createAnswerOptions;
  global.checkAnswer = checkAnswer;
  global.createRoundState = createRoundState;
  global.advanceRound = advanceRound;
  global.isRoundComplete = isRoundComplete;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createPuzzle: createPuzzle,
      pickBlankIndex: pickBlankIndex,
      generateDistractors: generateDistractors,
      createAnswerOptions: createAnswerOptions,
      checkAnswer: checkAnswer,
      createRoundState: createRoundState,
      advanceRound: advanceRound,
      isRoundComplete: isRoundComplete,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
