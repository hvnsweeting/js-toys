/**
 * App - Imperative shell for emoji2eng.
 * Handles DOM manipulation, event listeners, and state management.
 * Calls pure functions from emoji-data.js and game-logic.js.
 */
(function () {
  'use strict';

  var EMOJIS_PER_ROUND = 18;
  var FEEDBACK_DELAY_MS = 1000;
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
  var btnPlayAgain = document.getElementById('btn-play-again');
  var darkModeToggle = document.getElementById('dark-mode-toggle');
  var darkModeBtn = document.getElementById('dark-mode-btn');
  var soundBtn = document.getElementById('sound-toggle-btn');

  // Game state (mutable shell state)
  var roundState = null;
  var currentPuzzle = null;
  var isAnswering = false;
  var soundEnabled = true;

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
      '<div class="cat-card-name">Random Mix</div>';
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

    // Display emoji
    emojiDisplayEl.textContent = currentPuzzle.char;

    // Render masked word with red underscore
    renderMaskedWord(currentPuzzle);

    // Generate answer options
    var distractors = generateDistractors(currentPuzzle.correctLetter, ALPHABET, shuffleArray);
    var options = createAnswerOptions(currentPuzzle.correctLetter, distractors, shuffleArray);

    renderAnswerButtons(options);
    hideFeedback();
  }

  /** Render the word with a red underscore at the blank position */
  function renderMaskedWord(puzzle) {
    maskedWordEl.innerHTML = '';
    var name = puzzle.name;
    for (var i = 0; i < name.length; i++) {
      if (i === puzzle.blankIndex) {
        var blankSpan = document.createElement('span');
        blankSpan.className = 'blank';
        blankSpan.textContent = '_';
        blankSpan.dataset.index = String(i);
        maskedWordEl.appendChild(blankSpan);
      } else {
        maskedWordEl.appendChild(document.createTextNode(name[i]));
      }
    }
  }

  /** Reveal the correct letter in green at the blank position */
  function revealCorrectLetter(puzzle) {
    var blankSpan = maskedWordEl.querySelector('.blank');
    if (blankSpan) {
      blankSpan.className = 'revealed';
      blankSpan.textContent = puzzle.correctLetter;
    }
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

    // Reveal the full word with the missing letter in green
    revealCorrectLetter(currentPuzzle);

    // Read the word aloud
    speakWord(currentPuzzle.name);

    // Show feedback
    if (result.correct) {
      showFeedback('Correct! ✔', true);
    } else {
      showFeedback('Wrong! It was "' + currentPuzzle.correctLetter + '"', false);
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

  // ---- Dark Mode ----

  function applyTheme() {
    var isDark = darkModeToggle.checked;
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    if (darkModeBtn) {
      darkModeBtn.textContent = isDark ? '☀️' : '🌙';
      darkModeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  // ---- Text-to-Speech ----

  /** Speak a word using Web Speech API (side effect, shell only) */
  function speakWord(word) {
    if (!soundEnabled) return;
    var synth = window.speechSynthesis;
    if (!synth || typeof synth.speak !== 'function') return;
    var utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    if (synth.cancel) synth.cancel();
    synth.resume();
    synth.speak(utterance);
  }

  // ---- Event Wiring ----

  btnBack.addEventListener('click', function () {
    showScreen(screenCategories);
  });

  btnPlayAgain.addEventListener('click', function () {
    showScreen(screenCategories);
  });

  if (darkModeToggle) {
    darkModeToggle.addEventListener('change', applyTheme);
    applyTheme();
  }

  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      soundEnabled = !soundEnabled;
      soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
      soundBtn.setAttribute('aria-label', soundEnabled ? 'Sound on' : 'Sound off');
      soundBtn.setAttribute('aria-pressed', String(soundEnabled));
    });
  }

  // ---- Init ----
  renderCategoryGrid();

})();
