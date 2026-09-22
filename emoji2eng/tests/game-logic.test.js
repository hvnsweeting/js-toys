describe('game-logic', function () {

  describe('createPuzzle', function () {
    it('masks the first letter correctly', function () {
      var puzzle = createPuzzle({ char: '🍑', name: 'peach' }, 0);
      assertEqual(puzzle.maskedName, '_each');
      assertEqual(puzzle.correctLetter, 'p');
      assertEqual(puzzle.blankIndex, 0);
      assertEqual(puzzle.char, '🍑');
      assertEqual(puzzle.name, 'peach');
    });

    it('masks the last letter correctly', function () {
      var puzzle = createPuzzle({ char: '🍑', name: 'peach' }, 4);
      assertEqual(puzzle.maskedName, 'peac_');
      assertEqual(puzzle.correctLetter, 'h');
    });

    it('masks a middle letter correctly', function () {
      var puzzle = createPuzzle({ char: '🍑', name: 'peach' }, 2);
      assertEqual(puzzle.maskedName, 'pe_ch');
      assertEqual(puzzle.correctLetter, 'a');
    });

    it('handles single-character blank in long word', function () {
      var puzzle = createPuzzle({ char: '🦋', name: 'butterfly' }, 3);
      assertEqual(puzzle.maskedName, 'but_erfly');
      assertEqual(puzzle.correctLetter, 't');
    });

    it('preserves the emoji char', function () {
      var puzzle = createPuzzle({ char: '🐶', name: 'dog' }, 1);
      assertEqual(puzzle.char, '🐶');
    });

    it('clamps blankIndex to valid range', function () {
      var puzzle = createPuzzle({ char: '🍑', name: 'peach' }, 99);
      assertEqual(puzzle.blankIndex, 4);
      assertEqual(puzzle.correctLetter, 'h');

      var puzzle2 = createPuzzle({ char: '🍑', name: 'peach' }, -5);
      assertEqual(puzzle2.blankIndex, 0);
      assertEqual(puzzle2.correctLetter, 'p');
    });

    it('handles names with spaces', function () {
      var puzzle = createPuzzle({ char: '🌭', name: 'hot dog' }, 0);
      assertEqual(puzzle.correctLetter, 'h');
      assertEqual(puzzle.maskedName, '_ot dog');
    });
  });

  describe('generateDistractors', function () {
    it('returns exactly 3 letters', function () {
      var candidates = ['a','b','c','d','e','f','g','h','i','j'];
      var result = generateDistractors('z', candidates);
      assertEqual(result.length, 3);
    });

    it('does not include the correct letter', function () {
      var candidates = ['a','b','c','d','e','f','g'];
      var result = generateDistractors('a', candidates);
      for (var i = 0; i < result.length; i++) {
        assertTrue(result[i] !== 'a', 'distractor should not be the correct letter');
      }
    });

    it('returns unique letters', function () {
      var candidates = ['a','b','c','d','e','f','g','h'];
      var result = generateDistractors('z', candidates);
      var unique = result.filter(function(c, i) { return result.indexOf(c) === i; });
      assertEqual(unique.length, 3, 'all distractors should be unique');
    });

    it('filters out correct letter from candidates before picking', function () {
      var candidates = ['x','a','b','c','x','d'];
      var result = generateDistractors('x', candidates);
      assertEqual(result.length, 3);
      for (var i = 0; i < result.length; i++) {
        assertTrue(result[i] !== 'x', 'should not contain correct letter');
      }
    });
  });

  describe('createAnswerOptions', function () {
    it('returns array of 4 letters', function () {
      function identityShuffle(arr) { return arr.slice(); }
      var options = createAnswerOptions('p', ['x', 'y', 'z'], identityShuffle);
      assertEqual(options.length, 4);
    });

    it('contains the correct letter', function () {
      function identityShuffle(arr) { return arr.slice(); }
      var options = createAnswerOptions('p', ['x', 'y', 'z'], identityShuffle);
      assertTrue(options.indexOf('p') !== -1, 'should contain correct letter');
    });

    it('contains all distractors', function () {
      function identityShuffle(arr) { return arr.slice(); }
      var options = createAnswerOptions('p', ['x', 'y', 'z'], identityShuffle);
      assertTrue(options.indexOf('x') !== -1, 'should contain x');
      assertTrue(options.indexOf('y') !== -1, 'should contain y');
      assertTrue(options.indexOf('z') !== -1, 'should contain z');
    });

    it('applies shuffle function', function () {
      function reverseShuffle(arr) { return arr.slice().reverse(); }
      var options = createAnswerOptions('p', ['x', 'y', 'z'], reverseShuffle);
      assertEqual(options[0], 'z');
      assertEqual(options[3], 'p');
    });
  });

  describe('checkAnswer', function () {
    it('returns correct:true when letters match', function () {
      var result = checkAnswer('p', 'p');
      assertEqual(result.correct, true);
    });

    it('returns correct:false when letters differ', function () {
      var result = checkAnswer('x', 'p');
      assertEqual(result.correct, false);
    });

    it('is case-insensitive', function () {
      var result = checkAnswer('P', 'p');
      assertEqual(result.correct, true);
    });
  });

  describe('createRoundState', function () {
    it('initializes with correct defaults', function () {
      var emojis = [{char:'🍑',name:'peach'}, {char:'🐶',name:'dog'}];
      var state = createRoundState(emojis);
      assertEqual(state.currentIndex, 0);
      assertEqual(state.score, 0);
      assertEqual(state.total, 2);
      assertEqual(state.emojis.length, 2);
    });

    it('creates a copy of the emoji list', function () {
      var emojis = [{char:'🍑',name:'peach'}];
      var state = createRoundState(emojis);
      emojis.push({char:'🐶',name:'dog'});
      assertEqual(state.emojis.length, 1, 'should not be affected by mutation');
    });
  });

  describe('advanceRound', function () {
    it('increments score when answer was correct', function () {
      var state = createRoundState([{char:'🍑',name:'peach'}, {char:'🐶',name:'dog'}]);
      var next = advanceRound(state, true);
      assertEqual(next.score, 1);
      assertEqual(next.currentIndex, 1);
    });

    it('does not increment score when answer was wrong', function () {
      var state = createRoundState([{char:'🍑',name:'peach'}, {char:'🐶',name:'dog'}]);
      var next = advanceRound(state, false);
      assertEqual(next.score, 0);
      assertEqual(next.currentIndex, 1);
    });

    it('does not mutate original state', function () {
      var state = createRoundState([{char:'🍑',name:'peach'}, {char:'🐶',name:'dog'}]);
      advanceRound(state, true);
      assertEqual(state.score, 0, 'original score should be unchanged');
      assertEqual(state.currentIndex, 0, 'original index should be unchanged');
    });
  });

  describe('isRoundComplete', function () {
    it('returns false when not all answered', function () {
      var state = createRoundState([{char:'🍑',name:'peach'}, {char:'🐶',name:'dog'}]);
      assertEqual(isRoundComplete(state), false);
    });

    it('returns true when all answered', function () {
      var state = createRoundState([{char:'🍑',name:'peach'}]);
      var next = advanceRound(state, true);
      assertEqual(isRoundComplete(next), true);
    });

    it('returns true for empty emoji list', function () {
      var state = createRoundState([]);
      assertEqual(isRoundComplete(state), true);
    });
  });

  describe('pickBlankIndex', function () {
    it('returns an index within the word length', function () {
      var idx = pickBlankIndex('peach', function() { return 0.5; });
      assertTrue(idx >= 0 && idx < 5, 'index should be in range 0-4');
    });

    it('skips space characters in names with spaces', function () {
      var idx = pickBlankIndex('hot dog', function() { return 0; });
      assertTrue(idx !== 3, 'should not pick the space position');
      assertEqual(idx, 0);
    });

    it('returns different indices for different random values', function () {
      var idx0 = pickBlankIndex('peach', function() { return 0; });
      var idx9 = pickBlankIndex('peach', function() { return 0.99; });
      assertEqual(idx0, 0);
      assertEqual(idx9, 4);
    });
  });
});
