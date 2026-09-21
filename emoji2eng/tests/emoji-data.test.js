describe('emoji-data', function () {
  it('CATEGORIES is a non-empty array', function () {
    assertTrue(Array.isArray(CATEGORIES), 'CATEGORIES should be an array');
    assertTrue(CATEGORIES.length > 0, 'CATEGORIES should not be empty');
  });

  it('every category has id, name, icon, and non-empty emojis array', function () {
    for (const cat of CATEGORIES) {
      assertTrue(typeof cat.id === 'string' && cat.id.length > 0, 'category must have string id');
      assertTrue(typeof cat.name === 'string' && cat.name.length > 0, 'category must have string name');
      assertTrue(typeof cat.icon === 'string' && cat.icon.length > 0, 'category must have string icon');
      assertTrue(Array.isArray(cat.emojis) && cat.emojis.length > 0, 'category must have non-empty emojis array');
    }
  });

  it('every emoji entry has char and name fields', function () {
    for (const cat of CATEGORIES) {
      for (const emoji of cat.emojis) {
        assertTrue(typeof emoji.char === 'string' && emoji.char.length > 0,
          'emoji must have non-empty char: ' + JSON.stringify(emoji));
        assertTrue(typeof emoji.name === 'string' && emoji.name.length > 0,
          'emoji must have non-empty name: ' + JSON.stringify(emoji));
      }
    }
  });

  it('emoji names are lowercase alphabetic (may contain spaces or hyphens)', function () {
    const validPattern = /^[a-z][a-z \-]*$/;
    for (const cat of CATEGORIES) {
      for (const emoji of cat.emojis) {
        assertTrue(validPattern.test(emoji.name),
          'emoji name must be lowercase alpha with optional spaces/hyphens: "' + emoji.name + '"');
      }
    }
  });

  it('emoji names have at least 3 characters', function () {
    for (const cat of CATEGORIES) {
      for (const emoji of cat.emojis) {
        assertTrue(emoji.name.length >= 3,
          'emoji name must be at least 3 chars: "' + emoji.name + '"');
      }
    }
  });

  it('getAllCategoryIds returns array of all category ids', function () {
    const ids = getAllCategoryIds();
    assertTrue(Array.isArray(ids), 'should return array');
    assertEqual(ids.length, CATEGORIES.length);
    for (const cat of CATEGORIES) {
      assertTrue(ids.indexOf(cat.id) !== -1, 'should contain id: ' + cat.id);
    }
  });

  it('getEmojisByCategory returns emojis for valid category', function () {
    const firstCat = CATEGORIES[0];
    const emojis = getEmojisByCategory(firstCat.id);
    assertEqual(emojis.length, firstCat.emojis.length);
    assertEqual(emojis[0].char, firstCat.emojis[0].char);
  });

  it('getEmojisByCategory returns empty array for unknown category', function () {
    const emojis = getEmojisByCategory('nonexistent-category-xyz');
    assertTrue(Array.isArray(emojis), 'should return array');
    assertEqual(emojis.length, 0);
  });

  it('getRandomSelection returns requested count', function () {
    // Use a simple deterministic "random" function for testing
    var callCount = 0;
    function fakeMathRandom() {
      callCount++;
      return (callCount * 0.17) % 1;
    }
    var result = getRandomSelection(10, fakeMathRandom);
    assertEqual(result.length, 10);
  });

  it('getRandomSelection returns no duplicate emoji', function () {
    var callCount = 0;
    function fakeMathRandom() {
      callCount++;
      return (callCount * 0.31) % 1;
    }
    var result = getRandomSelection(10, fakeMathRandom);
    var chars = result.map(function(e) { return e.char; });
    var unique = chars.filter(function(c, i) { return chars.indexOf(c) === i; });
    assertEqual(unique.length, result.length, 'all emoji should be unique');
  });

  it('getRandomSelection clamps to available emoji count', function () {
    // Request more than total available - should return all available
    var total = 0;
    for (var i = 0; i < CATEGORIES.length; i++) {
      total += CATEGORIES[i].emojis.length;
    }
    var callCount = 0;
    function fakeMathRandom() {
      callCount++;
      return (callCount * 0.13) % 1;
    }
    var result = getRandomSelection(total + 100, fakeMathRandom);
    assertEqual(result.length, total);
  });
});
