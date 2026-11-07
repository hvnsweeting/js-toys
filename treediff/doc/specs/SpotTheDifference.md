# Spec: spot the difference on two trees (click the difference)

Status: approved with "GO!" and implemented, with the defaults below (the questions were not
answered). It replaced an earlier "tick 3 traits" design. Where the build differs
from the first draft, the text below says so ("as built").

Reference the owner pointed to: https://tools.simonwillison.net/tree-appreciator. From its page
text: a pair of trees from one seed with a few small differences such as "a missing branch, a
bird in one and not the other, a bough that turned early"; some are only visible from behind; the
player taps or clicks the difference on either tree; a counter shows "0 of 3 noticed"; taps that
hit no difference count as misses. This spec follows that, without its timer, herbarium and saved
progress (the owner asked for only the game: compare two trees and find 3 differences). A score
was left out at first and added on 2026-10-31 at the owner's request (rule 4).

Where this spec chose a default for something the owner has not answered, it says so. Change any
of them before approving.

## The game

1. Two trees grow side by side from the same seed with the same traits. They are identical except
   for exactly 3 differences. A difference is an object or a change on a branch, never a change of
   a whole-tree trait such as height, lean or leaf count.
2. The 3 differences are of 3 different kinds and sit at random places on the trees, some on the
   side facing away from the starting camera. Each belongs to one tree (a bird on the left tree, a
   missing branch on the right tree, a bough in autumn colours on the left tree while the same
   bough on the right tree stays green), and finding it on either tree counts. The player cannot
   tell which tree is "the original".
3. The camera turns freely all the way around (drag to turn both trees together, wheel or pinch to
   zoom), so every side can be looked at.
4. The player clicks or taps a place on either tree where they see a difference. A press that
   moves (a drag to turn the camera) is not a click.
   - A click on a difference marks it: a ring appears around it on both trees, one of three dots
     at the top fills, the score gains 100 ("+100" pops up large in the middle of the screen and
     fades; for a player who asks for reduced motion it only fades), and a soft chime plays.
   - A click on anything else is a miss: it costs 20 points ("-20" pops up), but the score never
     goes below 0; at 0 the pop-up says "Miss". The number of misses is not shown. (Changed on
     2026-10-31 at the owner's request: "2 of 3" became the dots and a score at the top,
     "Misses 0" was removed, and a miss costs 20.)
5. When all 3 are found the game says so, shows what each difference was ("a bird", "a missing
   branch", "a bough that turned early"), and waits for New pair, which turns green, pulses (a
   steady ring under reduced motion) and shows a "New pair" label under it until it is pressed.
   The score runs across pairs for the visit and starts at 0 when the page is loaded; there is
   no timer and no saved data.
6. Hint: a button that makes a ring pulse faintly near one unfound difference (a rough area, not an
   exact spot). It does not change the score. (Default: the button exists.)
7. A guide under the scoreboard ("Find the 3 differences" and what to do; on a screen 480 pixels
   high or less, such as a phone held sideways, only the title, to leave room for the trees)
   shows while the first pair grows and until the player first presses on the trees, lets go of
   a press on them, or scrolls on them during play (a click, a drag or a zoom; Hint, New pair
   and the keys leave it). Then it fades out and stays away until the page is loaded again; the
   pairs after it are framed with only the scoreboard at the top. (Changed on 2026-10-31 at the
   owner's request: the guide had stayed on screen for every pair.)

## Kinds of difference (default list; each is drawn in code, no image files)

| Kind | On tree A | On tree B |
| --- | --- | --- |
| Bird | a small bird perched on a branch | no object |
| Nest | a nest with eggs in a fork | no object |
| Fruit | a cluster of apples hanging from a bough | no object |
| Lantern | a small hanging lantern on a thread | no object |
| Blossom bough | one bough with leaves turned blossom-pale (as built: its leaves are recoloured, not given extra flowers) | the same bough in leaf |
| Autumn bough | one bough with its leaves already turned gold or red; planned only on a tree with an autumn trait of at most 0.4, so it stands out (as built) | the same bough green |
| Missing branch | a side branch with its leaves | the same place with no branch |

Each pair uses 3 distinct kinds. Which tree has the object, or the unchanged half of a
bough pair, is random.

## Placement rules

- A difference is attached to a point on a branch of the grown tree: above the ground clearance,
  on a branch thick enough to carry it (birds, nests, fruit, lanterns) or on a bough with at least
  a few leaves (blossom, autumn, missing).
- Two differences are at least `clamp(0.5 x crown radius, 0.9, 1.5)` world units apart (as built:
  smaller trees need a smaller gap).
- At least one of the three is on the far side of the trees from the starting camera and at least
  one is on the near side, measured from the middle of the tree's depth; 97 percent of pairs meet
  this and the rest are accepted without it.
- Objects sit on the outer half of the crown (at least half the crown radius from the trunk), so they
  can be seen from outside it. A bough must have at least 90 leaves and not be in the middle of the
  crown. (As built: this replaces "visible from some angle, tested by rays".)
- An object is never on a branch that is left out of the same tree.
- Objects move with the wind in step with their branch (they use the same sway as the branch).
- A click is aimed at the difference with the centre the click's ray passes closest to, as a share of
  its radius, because differences on the screen can overlap when they are in line. A click on any
  leaf of a changed bough also counts (as built): the bough's radius (70 percent of its farthest
  leaf, at most 1.2) leaves its outermost leaves outside. Each leaf counts within its own reach of
  the middle of its blade, `0.75 x length + 0.2 x flex + 0.05`, which covers the blade, its
  flutter and the wind sway the leaf shader gives it. Where that area overlaps another
  difference's on the screen, the better-aimed one is found: about 1 click in 90 on a bough's leaf
  tips finds a nearby object instead (measured over 120 planned pairs, at 6 moments each).
- Clicks through the crown (as built): leaves and branches in front of a difference do not stop
  a click on it, so a difference on the far side can be found from the front. A rule that turned down
  clicks on differences more than about 100 degrees round the trunk from the camera was tried and
  removed, because it turned down clicks on differences the player could see. Measured from the starting view
  at 1280 by 800 on 58 objects in 30 pairs, counting the pixels that change when the object is
  hidden: of the 19 objects that rule turned down, 11 changed 100 pixels or more (a bird 120 degrees
  round changed 483) and 6 changed fewer than 40; of the 39 it allowed, 35 changed 100 or more
  and 2 fewer than 40. The far side of these trees is mostly visible through the crown. The count
  includes each object's shadow, and boughs were not measured.

## Technical notes

- New module `differences.js`: kinds, choosing 3 kinds and 3 attachment points for a pair
  (deterministic from the pair's seed, so it is testable), and the hit test (a ray against a sphere
  per difference; the radius is a little larger than the object so a small bird is clickable, and
  for a missing branch it is the region the branch would have filled). As built: a lantern's
  area also runs up its thread, which reaches 0.63 above its centre, beyond its radius of 0.4; a
  bough also counts each of its leaves. New module `props.js`: the
  object meshes. `skeleton.js` gains an option to leave out one branch and everything on it, and to
  give one bough's leaves a colour override (as built: its blossoms keep their colour).
- `world.js`: the orbit limits are removed so the camera can turn fully; the framing stays.
- The two trees stand as close as their crowns allow, with a 0.4 gap between the crowns' facing
  edges (branches, leaf blades, and any object of a difference, counted out to its click radius,
  which is a little wider than the object is drawn, so the two trees' click areas stay apart too;
  an object on the inside can therefore leave a little more space), so they never interleave
  (`trunkOffset` in `game.js`). Each pair is placed while both trees are shrunk to nothing, and
  leaves still falling from the last pair are cleared then, since they no longer line up.
  (Changed on 2026-10-31 at the owner's request to stand the trees about half as far apart as
  the fixed 4.6 either side of the middle: exactly half would make the crowns overlap in 184 of
  400 random pairs, so the owner chose "as close as the crowns allow"; the median pair now stands
  2.44 from the middle.)
- The sound pauses while the page is in a background tab and resumes when it is shown again.
- `main.js` is rewritten again: no trait panel, no phases of ticking. As built (changed on
  2026-10-31 at the owner's request), a top row holds New pair as a plus icon at the left, the
  scoreboard (three dots for this pair's finds, and the score) in the middle, and the sound
  button at the right; the guide sits under the scoreboard while shown, and lets presses through.
  The sound button shows its state by its icon: a speaker with waves, or with a cross when muted.
  At the bottom there is only Hint, with the result line above it once a round is done; then the
  trees are fitted again above it. The guide, the scoreboard and the result line are only as wide
  as their text. Buttons are 44 pixels on touch screens and narrow or short windows, where key
  labels are hidden; desktops get slimmer ones. Points are in `game.js` (`scoreAfter`).
- The traits in `traits.js` stay as the way each pair gets a varied tree (both trees share the
  same random traits); their names are no longer shown.
- Hit testing happens on the click, with a click defined as a press that moves less than 6 pixels
  and lasts less than 500 ms. As built: the press must also start during play on the same pair,
  so one held from the growing does not score. Screen readers hear finds, misses, the score and
  "Press New pair for another" from one hidden live line.
- Tests (as built): kind and placement rules over 400 pairs (distinct kinds, distances, above the
  ground, far side and near side present, objects on the outer half of the crown on branches thick
  and level enough for their kind, boughs with at least 90 leaves away from the middle of the crown);
  the hit test (inside the radius, just outside, behind the ray's origin, and every planned
  difference found by a click aimed at it from outside its tree); the skeleton option (a
  left-out branch removes its leaves, leaves the rest unchanged). There is no test that rays from
  outside the tree reach an object between the leaves; the outer-half rule stands in for it. The
  browser check turns the camera to each difference before clicking it, checks that each
  difference is drawn on the trees (from the meshes, not from the plan), and covers some wrong
  clicks, a difference on the far side found after real drags, a full turn, the hint, new pair,
  the guide going away, the sound button's icon, and the layout at phone and iPad sizes (a tap on
  each of a phone and an iPad finds a difference).

## Out of scope

- Timer, streaks, ranks, herbarium, saved progress (including a saved best score), a "which tree
  is taller" round.
- Animals that move (the bird is still), sound for each kind, more than 3 differences.
- Panning the camera.

## Questions for the owner (defaults above)

1. Is the list of 7 kinds right? Add or drop any (a squirrel, a hanging swing, a woodpecker hole, a
   ribbon, a bee hive).
2. Hint button: keep (default) or remove?
3. Misses: answered on 2026-10-31, a miss costs 20 points.
4. After the third find, wait for "New pair" (default) or move on by itself after a few seconds?
5. Both trees always show a difference on one side only (default). Do you want some differences to
   be a change on both trees (for example the same bough green on one and gold on the other)? The
   blossom and autumn kinds already are; say if you want more of that.
6. Difficulty: objects are small (a bird about a tenth of the tree's height). Keep that, or make
   them larger?

## As built, beyond the first draft

- Objects are drawn only while the trees are fully grown (they sit on branch points of the grown
  tree); a left-out branch and recoloured boughs show at every stage of growth.
- A pair with a tree that has no room for three differences (about 1 in 200 trees) is replaced by a new
  seed before the player sees it.
- Keys: H hint, N or Space new pair, M mute. Space and Enter on a button reached with Tab press that
  button; after a mouse click they belong to the game.
- The game cannot be played with the keyboard alone: finding a difference needs a pointer.
- Falling leaves are the same on both trees: a copy of the same leaf falls from each at the same
  moment and the same way, so a falling leaf is never a difference the player cannot click. The
  leaf itself stays on its branch: taking leaves off during play would change both trees while
  the player compares them, and an uneven change would look like another difference.
- On a narrow screen the camera stands far back (up to 80 units) to fit both trees, out among the
  hills. Each frame it is lifted, at the same distance, until it and its line of sight to the trees
  are 0.8 units above the ground wherever the ground is sampled (every half unit along the line,
  `src/ground.js`), so turning round never puts it inside a hill or behind one.

## Order of work (done)

1. `skeleton.js` option and `props.js` meshes with tests; a page that shows each kind on a tree.
2. `differences.js` (choice, placement, hit test) with tests.
3. `main.js`, `index.html`, `style.css`: the click game; free orbit.
4. Browser check scenarios, README, old spec marked as replaced.
5. Independent review before handing back.
