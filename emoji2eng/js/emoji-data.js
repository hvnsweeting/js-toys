/**
 * Emoji Data - Pure data module with emoji catalog organized by macOS-style categories.
 * No I/O, no DOM, no side effects. Randomness is injected via parameters.
 */
(function (global) {
  'use strict';

  var CATEGORIES = [
    {
      id: 'smileys',
      name: 'Smileys & Emotion',
      icon: '😀',
      emojis: [
        { char: '😀', name: 'grin' },
        { char: '😂', name: 'joy' },
        { char: '😍', name: 'heart eyes' },
        { char: '🥰', name: 'love' },
        { char: '😎', name: 'cool' },
        { char: '🤓', name: 'nerd' },
        { char: '😴', name: 'sleep' },
        { char: '🤯', name: 'mind blown' },
        { char: '😱', name: 'scream' },
        { char: '👻', name: 'ghost' },
        { char: '🤖', name: 'robot' },
        { char: '👽', name: 'alien' },
        { char: '🎃', name: 'pumpkin' },
        { char: '🤡', name: 'clown' },
        { char: '🤮', name: 'vomit' },
        { char: '😈', name: 'devil' },
        { char: '💩', name: 'poop' },
        { char: '😊', name: 'blush' },
        { char: '🤗', name: 'hug' },
        { char: '😇', name: 'angel' },
        { char: '🥳', name: 'party' },
        { char: '😜', name: 'wink' },
        { char: '🤩', name: 'starstruck' },
        { char: '🥺', name: 'pleading' },
        { char: '😏', name: 'smirk' },
        { char: '🤭', name: 'giggle' },
        { char: '😋', name: 'yummy' },
        { char: '🫣', name: 'peeking' },
      ]
    },
    {
      id: 'animals',
      name: 'Animals & Nature',
      icon: '🐶',
      emojis: [
        { char: '🐶', name: 'dog' },
        { char: '🐱', name: 'cat' },
        { char: '🐭', name: 'mouse' },
        { char: '🐰', name: 'rabbit' },
        { char: '🦊', name: 'fox' },
        { char: '🐻', name: 'bear' },
        { char: '🐼', name: 'panda' },
        { char: '🐨', name: 'koala' },
        { char: '🐯', name: 'tiger' },
        { char: '🦁', name: 'lion' },
        { char: '🐮', name: 'cow' },
        { char: '🐷', name: 'pig' },
        { char: '🐸', name: 'frog' },
        { char: '🐵', name: 'monkey' },
        { char: '🐔', name: 'chicken' },
        { char: '🐧', name: 'penguin' },
        { char: '🦅', name: 'eagle' },
        { char: '🦆', name: 'duck' },
        { char: '🦉', name: 'owl' },
        { char: '🐝', name: 'bee' },
        { char: '🦋', name: 'butterfly' },
        { char: '🐛', name: 'bug' },
        { char: '🐌', name: 'snail' },
        { char: '🐞', name: 'ladybug' },
        { char: '🐢', name: 'turtle' },
        { char: '🐍', name: 'snake' },
        { char: '🐙', name: 'octopus' },
        { char: '🦀', name: 'crab' },
        { char: '🐬', name: 'dolphin' },
        { char: '🐳', name: 'whale' },
        { char: '🐊', name: 'crocodile' },
        { char: '🦒', name: 'giraffe' },
        { char: '🦘', name: 'kangaroo' },
        { char: '🦔', name: 'hedgehog' },
        { char: '🦩', name: 'flamingo' },
        { char: '🦜', name: 'parrot' },
        { char: '🐿', name: 'chipmunk' },
        { char: '🦈', name: 'shark' },
        { char: '🐑', name: 'sheep' },
        { char: '🐴', name: 'horse' },
      ]
    },
    {
      id: 'food',
      name: 'Food & Drink',
      icon: '🍎',
      emojis: [
        { char: '🍎', name: 'apple' },
        { char: '🍐', name: 'pear' },
        { char: '🍊', name: 'orange' },
        { char: '🍋', name: 'lemon' },
        { char: '🍌', name: 'banana' },
        { char: '🍉', name: 'watermelon' },
        { char: '🍇', name: 'grapes' },
        { char: '🍓', name: 'strawberry' },
        { char: '🍑', name: 'peach' },
        { char: '🥭', name: 'mango' },
        { char: '🍍', name: 'pineapple' },
        { char: '🥝', name: 'kiwi' },
        { char: '🍅', name: 'tomato' },
        { char: '🥑', name: 'avocado' },
        { char: '🌽', name: 'corn' },
        { char: '🥕', name: 'carrot' },
        { char: '🧄', name: 'garlic' },
        { char: '🍄', name: 'mushroom' },
        { char: '🥜', name: 'peanut' },
        { char: '🌰', name: 'chestnut' },
        { char: '🍕', name: 'pizza' },
        { char: '🌮', name: 'taco' },
        { char: '🍔', name: 'burger' },
        { char: '🍟', name: 'fries' },
        { char: '🍿', name: 'popcorn' },
        { char: '🍪', name: 'cookie' },
        { char: '🍩', name: 'donut' },
        { char: '🍫', name: 'chocolate' },
        { char: '🍬', name: 'candy' },
        { char: '🍭', name: 'lollipop' },
        { char: '🍦', name: 'ice cream' },
        { char: '🥐', name: 'croissant' },
        { char: '🧁', name: 'cupcake' },
        { char: '🥞', name: 'pancakes' },
        { char: '🌯', name: 'burrito' },
        { char: '🍝', name: 'spaghetti' },
        { char: '🍜', name: 'noodles' },
        { char: '🍣', name: 'sushi' },
        { char: '🥤', name: 'cup' },
        { char: '🧃', name: 'juice box' },
      ]
    },
    {
      id: 'activities',
      name: 'Activities',
      icon: '⚽',
      emojis: [
        { char: '⚽', name: 'soccer' },
        { char: '🏀', name: 'basketball' },
        { char: '🏈', name: 'football' },
        { char: '⚾', name: 'baseball' },
        { char: '🎾', name: 'tennis' },
        { char: '🏐', name: 'volleyball' },
        { char: '🏉', name: 'rugby' },
        { char: '🎱', name: 'billiards' },
        { char: '🏓', name: 'ping pong' },
        { char: '🏸', name: 'badminton' },
        { char: '🥊', name: 'boxing' },
        { char: '🎯', name: 'dart' },
        { char: '🎳', name: 'bowling' },
        { char: '🎮', name: 'video game' },
        { char: '🎲', name: 'dice' },
        { char: '🧩', name: 'puzzle' },
        { char: '🎭', name: 'theater' },
        { char: '🎨', name: 'palette' },
        { char: '🎬', name: 'clapper' },
        { char: '🎤', name: 'microphone' },
        { char: '🎧', name: 'headphones' },
        { char: '🎸', name: 'guitar' },
        { char: '🎹', name: 'piano' },
        { char: '🎺', name: 'trumpet' },
        { char: '🎻', name: 'violin' },
        { char: '🥁', name: 'drum' },
        { char: '⛷', name: 'skiing' },
        { char: '🏄', name: 'surfing' },
        { char: '🤸', name: 'cartwheel' },
        { char: '⛳', name: 'golf' },
        { char: '🏆', name: 'trophy' },
        { char: '🥇', name: 'gold medal' },
        { char: '🎪', name: 'circus' },
        { char: '🎵', name: 'music note' },
        { char: '🛹', name: 'skateboard' },
      ]
    },
    {
      id: 'travel',
      name: 'Travel & Places',
      icon: '🚗',
      emojis: [
        { char: '🚗', name: 'car' },
        { char: '🚕', name: 'taxi' },
        { char: '🚌', name: 'bus' },
        { char: '🚎', name: 'trolleybus' },
        { char: '🚓', name: 'police car' },
        { char: '🚑', name: 'ambulance' },
        { char: '🚒', name: 'fire engine' },
        { char: '🚚', name: 'truck' },
        { char: '🚜', name: 'tractor' },
        { char: '🏍', name: 'motorcycle' },
        { char: '🚲', name: 'bicycle' },
        { char: '🚂', name: 'train' },
        { char: '🚀', name: 'rocket' },
        { char: '✈️', name: 'airplane' },
        { char: '🚁', name: 'helicopter' },
        { char: '⛵', name: 'sailboat' },
        { char: '🚢', name: 'ship' },
        { char: '🏠', name: 'house' },
        { char: '🏰', name: 'castle' },
        { char: '🗼', name: 'tower' },
        { char: '⛺', name: 'tent' },
        { char: '🌋', name: 'volcano' },
        { char: '🏔', name: 'mountain' },
        { char: '🏖', name: 'beach' },
        { char: '🏝', name: 'island' },
        { char: '🚂', name: 'locomotive' },
        { char: '⛴', name: 'ferry' },
        { char: '⛲', name: 'fountain' },
        { char: '🎡', name: 'ferris wheel' },
        { char: '🗽', name: 'statue' },
        { char: '🏛', name: 'temple' },
        { char: '🌉', name: 'bridge' },
        { char: '🛶', name: 'canoe' },
      ]
    },
    {
      id: 'objects',
      name: 'Objects',
      icon: '💡',
      emojis: [
        { char: '⌚', name: 'watch' },
        { char: '📱', name: 'phone' },
        { char: '💻', name: 'laptop' },
        { char: '🖥', name: 'desktop' },
        { char: '🖨', name: 'printer' },
        { char: '🔋', name: 'battery' },
        { char: '💡', name: 'light bulb' },
        { char: '🔦', name: 'flashlight' },
        { char: '🔧', name: 'wrench' },
        { char: '🔨', name: 'hammer' },
        { char: '🔩', name: 'bolt' },
        { char: '📎', name: 'paperclip' },
        { char: '🖊', name: 'pen' },
        { char: '✏️', name: 'pencil' },
        { char: '📏', name: 'ruler' },
        { char: '✂️', name: 'scissors' },
        { char: '🔑', name: 'key' },
        { char: '🔒', name: 'lock' },
        { char: '🔔', name: 'bell' },
        { char: '📷', name: 'camera' },
        { char: '🔭', name: 'telescope' },
        { char: '🔬', name: 'microscope' },
        { char: '💎', name: 'gem' },
        { char: '🧲', name: 'magnet' },
        { char: '📚', name: 'books' },
        { char: '🎒', name: 'backpack' },
        { char: '👓', name: 'glasses' },
        { char: '⏰', name: 'alarm clock' },
        { char: '🪄', name: 'wand' },
        { char: '🧸', name: 'teddy bear' },
        { char: '🎁', name: 'gift' },
        { char: '🎈', name: 'balloon' },
        { char: '🔮', name: 'crystal ball' },
      ]
    },
    {
      id: 'nature',
      name: 'Nature & Weather',
      icon: '🌸',
      emojis: [
        { char: '🌸', name: 'cherry blossom' },
        { char: '🌹', name: 'rose' },
        { char: '🌻', name: 'sunflower' },
        { char: '🌺', name: 'hibiscus' },
        { char: '🌷', name: 'tulip' },
        { char: '🌵', name: 'cactus' },
        { char: '🎄', name: 'christmas tree' },
        { char: '🌲', name: 'pine' },
        { char: '🌳', name: 'tree' },
        { char: '🍀', name: 'clover' },
        { char: '🍃', name: 'leaf' },
        { char: '🍂', name: 'fallen leaf' },
        { char: '🍁', name: 'maple leaf' },
        { char: '🌊', name: 'wave' },
        { char: '💧', name: 'droplet' },
        { char: '☀️', name: 'sun' },
        { char: '🌙', name: 'moon' },
        { char: '⭐', name: 'star' },
        { char: '🌈', name: 'rainbow' },
        { char: '🔥', name: 'fire' },
        { char: '❄️', name: 'snowflake' },
        { char: '⛄', name: 'snowman' },
        { char: '🌴', name: 'palm tree' },
        { char: '🌾', name: 'rice' },
        { char: '☂', name: 'umbrella' },
        { char: '🌪', name: 'tornado' },
        { char: '💨', name: 'wind' },
        { char: '🌏', name: 'globe' },
        { char: '🪷', name: 'lotus' },
        { char: '🌼', name: 'daisy' },
      ]
    }
  ];

  function getAllCategoryIds() {
    return CATEGORIES.map(function (cat) { return cat.id; });
  }

  function getEmojisByCategory(categoryId) {
    var found = CATEGORIES.find(function (cat) { return cat.id === categoryId; });
    return found ? found.emojis.slice() : [];
  }

  /**
   * Pick `count` emoji distributed across all categories.
   * randomFn is injected for testability (defaults to Math.random).
   */
  function getRandomSelection(count, randomFn) {
    var rng = typeof randomFn === 'function' ? randomFn : Math.random;

    // Flatten all emoji with category info
    var all = [];
    for (var i = 0; i < CATEGORIES.length; i++) {
      var emojis = CATEGORIES[i].emojis;
      for (var j = 0; j < emojis.length; j++) {
        all.push(emojis[j]);
      }
    }

    var clamped = Math.min(count, all.length);

    // Fisher-Yates shuffle using injected rng
    for (var k = all.length - 1; k > 0; k--) {
      var swapIdx = Math.floor(rng() * (k + 1));
      var temp = all[k];
      all[k] = all[swapIdx];
      all[swapIdx] = temp;
    }

    return all.slice(0, clamped);
  }

  // Export to global scope
  global.CATEGORIES = CATEGORIES;
  global.getAllCategoryIds = getAllCategoryIds;
  global.getEmojisByCategory = getEmojisByCategory;
  global.getRandomSelection = getRandomSelection;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CATEGORIES: CATEGORIES, getAllCategoryIds: getAllCategoryIds, getEmojisByCategory: getEmojisByCategory, getRandomSelection: getRandomSelection };
  }
})(typeof window !== 'undefined' ? window : globalThis);
