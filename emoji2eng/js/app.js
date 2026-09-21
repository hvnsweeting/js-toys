/**
 * App - Imperative shell for emoji2eng.
 * Handles DOM manipulation, event listeners, and state management.
 * Calls pure functions from emoji-data.js and game-logic.js.
 */
(function () {
  'use strict';

  var EMOJIS_PER_ROUND = 10;
  var FEEDBACK_DELAY_MS = 800;
  var ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

  // DOM references
  var screenCategories = document.getElementById('screen-categories');
  var screenPlaying = document.getElementById('screen-playing');
  var screenComplete = document.getElementById('screen-complete');
  var categoryGrid = document.getElementById('category-grid');
  var btnBack = document.getElementById('btn-back');
  var progressEl = document.getElementById('progress');
  var scoreDisplayEl = document.getElementById('score-display');
  var emojiDisplayEl = document.getElementById('emoji-display');
  var maskedWordEl = document.getElementById('masked-word');
  var answerGridEl = document.getElementById('answer-grid');
  var feedbackEl = document.getElementById('feedback');
  var finalScoreEl = document.getElementById('final-score');
  var finalStarsEl = document.getElementById('final-stars');
  var btnPlayAgain = document.getElementById('btn-play-again');

  // Game state (mutable shell state)
  var roundState = null;
  var currentPuzzle = null;
  var isAnswering = false;

  // ---- Screen Management ----

  function showScreen(screen) {
    screenCategories.classList.add('hidden');
    screenPlaying.classList.add('hidden');
    screenComplete.classList.add('hidden');
    screen.classList.remove('hidden');
  }

  // ---- Category Select Screen ----

  function renderCategoryGrid() {
    categoryGrid.innerHTML = '';
    var ids = getAllCategoryIds();

    for (var i = 0; i < CATEGORIES.length; i++) {
      var cat = CATEGORIES[i];
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'cat-card';
      card.dataset.categoryId = cat.id;
      card.setAttribute('aria-label', cat.name);
      card.innerHTML =
        '<div class="cat-card-icon">' + cat.icon + '</div>' +
        '<div class="cat-card-name">' + escapeHtml(cat.name) + '</div>';
      card.addEventListener('click', handleCategoryClick);
      categoryGrid.appendChild(card);
    }

    // Random card (spans full width)
    var randomCard = document.createElement('button');
    randomCard.type = 'button';
    randomCard.className = 'cat-card cat-card--random';
    randomCard.dataset.categoryId = 'random';
    randomCard.setAttribute('aria-label', 'Random mix');
    randomCard.innerHTML =
      '<div class="cat-card-icon">🎲</div>' +
      '<div class="cat-card-name">RANDOM MIX</div>';
    randomCard.addEventListener('click', handleCategoryClick);
    categoryGrid.appendChild(randomCard);
  }

  function handleCategoryClick(event) {
    var card = event.currentTarget;
    var categoryId = card.dataset.categoryId;
    startRound(categoryId);
  }

  // ---- Game Logic Orchestration ----

  function startRound(categoryId) {
    var emojis;
    if (categoryId === 'random') {
      emojis = getRandomSelection(EMOJIS_PER_ROUND);
    } else {
      var pool = getEmojisByCategory(categoryId);
      emojis = shuffleArray(pool).slice(0, EMOJIS_PER_ROUND);
    }

    // Clamp if category has fewer emoji than requested
    if (emojis.length > EMOJIS_PER_ROUND) {
      emojis = emojis.slice(0, EMOJIS_PER_ROUND);
    }

    roundState = createRoundState(emojis);
    showScreen(screenPlaying);
    showCurrentPuzzle();
  }

  function showCurrentPuzzle() {
    if (isRoundComplete(roundState)) {
      showRoundComplete();
      return;
    }

    isAnswering = false;
    var emoji = roundState.emojis[roundState.currentIndex];
    var blankIdx = pickBlankIndex(emoji.name);
    currentPuzzle = createPuzzle(emoji, blankIdx);

    // Update progress and score
    progressEl.textContent = (roundState.currentIndex + 1) + ' / ' + roundState.total;
    scoreDisplayEl.textContent = '★ ' + roundState.score;

    // Display emoji and masked word
    emojiDisplayEl.textContent = currentPuzzle.char;
    maskedWordEl.textContent = currentPuzzle.maskedName;

    // Generate answer options
    var distractors = generateDistractors(currentPuzzle.correctLetter, ALPHABET);
    var options = createAnswerOptions(currentPuzzle.correctLetter, distractors, shuffleArray);

    renderAnswerButtons(options);
    hideFeedback();
  }

  function renderAnswerButtons(options) {
    answerGridEl.innerHTML = '';
    for (var i = 0; i < options.length; i++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'answer-btn';
      btn.textContent = options[i];
      btn.dataset.letter = options[i];
      btn.addEventListener('click', handleAnswerClick);
      answerGridEl.appendChild(btn);
    }
  }

  function handleAnswerClick(event) {
    if (isAnswering) return;
    isAnswering = true;

    var selectedLetter = event.currentTarget.dataset.letter;
    var result = checkAnswer(selectedLetter, currentPuzzle.correctLetter);

    // Highlight correct/wrong buttons
    var buttons = answerGridEl.querySelectorAll('.answer-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = true;
      if (buttons[i].dataset.letter === currentPuzzle.correctLetter) {
        buttons[i].classList.add('correct');
      } else if (buttons[i] === event.currentTarget && !result.correct) {
        buttons[i].classList.add('wrong');
      }
    }

    // Show feedback
    if (result.correct) {
      showFeedback('CORRECT! ✔', true);
    } else {
      showFeedback('WRONG! It was "' + currentPuzzle.correctLetter + '"', false);
    }

    // Advance round state
    roundState = advanceRound(roundState, result.correct);

    // Auto-advance after delay
    setTimeout(function () {
      showCurrentPuzzle();
    }, FEEDBACK_DELAY_MS);
  }

  // ---- Round Complete Screen ----

  function showRoundComplete() {
    showScreen(screenComplete);
    finalScoreEl.textContent = roundState.score + ' / ' + roundState.total;

    // Star rating based on score percentage
    var pct = roundState.total > 0 ? roundState.score / roundState.total : 0;
    var starCount = pct >= 0.9 ? 3 : pct >= 0.6 ? 2 : pct >= 0.3 ? 1 : 0;
    var stars = '';
    for (var i = 0; i < 3; i++) {
      stars += i < starCount ? '⭐' : '☆';
    }
    finalStarsEl.textContent = stars;
  }

  // ---- UI Helpers ----

  function showFeedback(message, isCorrect) {
    feedbackEl.textContent = message;
    feedbackEl.className = 'feedback ' + (isCorrect ? 'correct' : 'wrong');
  }

  function hideFeedback() {
    feedbackEl.textContent = '';
    feedbackEl.className = 'feedback hidden';
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  /** Fisher-Yates shuffle (creates new array) */
  function shuffleArray(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  // ---- Event Wiring ----

  btnBack.addEventListener('click', function () {
    showScreen(screenCategories);
  });

  btnPlayAgain.addEventListener('click', function () {
    showScreen(screenCategories);
  });

  // ---- Init ----
  renderCategoryGrid();

})();
