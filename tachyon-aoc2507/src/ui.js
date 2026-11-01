import {levels, sectors} from './levels.js';

const byId = id => document.getElementById(id);
const screens = ['title', 'select', 'help', 'result'];
let toastTimer;

export function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2900);
}

export function clearToast() {
  clearTimeout(toastTimer);
  const toast = byId('toast');
  toast.textContent = '';
  toast.classList.remove('visible');
}

export function showScreen(name) {
  for (const screen of screens)
    byId(`${screen}-screen`).classList.toggle('hidden', screen !== name);
  // The result card has its own buttons, so the button bar hides; the text strip keeps the Rush
  // timer and score in view.
  byId('hud-info').classList.toggle('hidden', name !== 'game' && name !== 'result');
  byId('hud').classList.toggle('hidden', name !== 'game');
  byId('app').dataset.screen = name;
}

export function renderSelection(profile, onChoose) {
  const container = byId('level-grid');
  container.replaceChildren();
  for (const sector of sectors) {
    const previous = sector.id === 'A' ? null : sector.id === 'B' ? 'A' : 'B';
    const previousWins = previous ?
        levels.filter(level => level.sector === previous && (profile.stars[level.id] ?? 0) > 0)
            .length :
        5;
    const unlocked = previousWins >= 4;
    const section = document.createElement('section');
    section.className = 'sector-row';
    const title = document.createElement('h3');
    title.textContent = `SECTOR ${sector.id} · ${sector.name}`;
    const subtitle = document.createElement('p');
    subtitle.textContent =
        unlocked ? sector.description : `Solve four Sector ${previous} levels to unlock.`;
    const buttons = document.createElement('div');
    buttons.className = 'level-buttons';
    for (const level of levels.filter(item => item.sector === sector.id)) {
      const button = document.createElement('button');
      const title = document.createElement('strong');
      title.textContent = `${level.id.toUpperCase()} ${level.name}`;
      const stars = document.createElement('small');
      stars.textContent = unlocked ? '★'.repeat(profile.stars[level.id] ?? 0) +
              '☆'.repeat(3 - (profile.stars[level.id] ?? 0)) :
                                     'LOCKED';
      button.append(title, stars);
      button.disabled = !unlocked;
      button.addEventListener('click', () => onChoose(level.id));
      buttons.append(button);
    }
    section.append(title, subtitle, buttons);
    container.append(section);
  }
}

export function renderHud(state, profile) {
  const level = state.level;
  if (!level) return;
  byId('sector-name').textContent =
      state.mode === 'rush' ? 'CASCADE RUSH' : `SECTOR ${level.sector} · ${level.id.toUpperCase()}`;
  byId('level-name').textContent = level.name;
  byId('level-hint').textContent = level.hint;
  const used = kind => state.placements.filter(piece => piece.kind === kind).length;
  byId('splitter-count').textContent = level.inventory.splitter - used('splitter');
  byId('block-count').textContent = level.inventory.block - used('block');
  for (const button of document.querySelectorAll('[data-piece]')) {
    button.classList.toggle('selected', button.dataset.piece === state.selected);
    button.disabled = level.inventory[button.dataset.piece] === 0;
  }
  byId('fire-button').innerHTML =
      state.phase === 'running' ? 'Skip <kbd>Space</kbd>' : 'Fire <kbd>Space</kbd>';
  const shown = state.result && state.revealRow >= 0;
  const partial = shown ?
      state.result.beamRows[Math.min(state.revealRow, level.grid.length - 1)].reduce(
          (sum, n) => sum + n, 0) :
      0;
  const splits =
      shown ? state.result.splitEvents.filter(event => event.row <= state.revealRow).length : 0;
  const splitWord = splits === 1 ? 'split' : 'splits';
  const timelineWord = partial === 1 ? 'timeline' : 'timelines';
  byId('board-stats').textContent = `${splits} ${splitWord} · ${partial} ${timelineWord}`;
  const verb = state.pointerType === 'touch' ? 'Tap' : 'Click';
  // The hint must match what input does in this phase; after a win the board takes no input.
  const pointerHints = {
    editing: `${verb} a cell to place or remove a piece`,
    running: `${verb} Fire again to finish the beam at once`,
  };
  byId('pointer-hint').textContent = pointerHints[state.phase] ?? '';
  byId('rush-meta').classList.toggle('hidden', state.mode !== 'rush');
  if (state.mode === 'rush') {
    const seconds = Math.max(0, Math.ceil(state.rushTime));
    byId('rush-timer').textContent =
        `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    byId('rush-score').textContent = `${state.rushScore} points · best ${profile.rushBest}`;
  }
  byId('top-status').textContent = state.mode === 'rush' ? 'ENDLESS SIGNAL' :
      state.screen === 'title'                           ? 'AOC 2025 · DAY 7' :
                                                           level.name;
}

export function renderResult(level, result, placements, stars, mode, saveError = false) {
  byId('result-title').textContent = mode === 'rush' ? 'Cascade secured' : `${level.name} complete`;
  const labels = [
    'Every target lit; every void dark',
    `Use ${level.par} piece${level.par === 1 ? '' : 's'} or fewer (${placements.length} used)`,
    level.bonus == null ? 'Finish the level' :
                          `Reach ${level.bonus} total timelines (${result.totalTimelines} reached)`,
  ];
  const list = byId('star-list');
  list.replaceChildren();
  labels.forEach((label, index) => {
    const row = document.createElement('div');
    row.className = stars[index] ? 'earned' : '';
    row.textContent = `${stars[index] ? '★' : '☆'} ${label}`;
    list.append(row);
  });
  const pieceWord = placements.length === 1 ? 'piece' : 'pieces';
  const splitWord = result.splitCount === 1 ? 'crystal split' : 'crystal splits';
  const timelineWord = result.totalTimelines === 1 ? 'timeline' : 'timelines';
  byId('result-summary').textContent = `${result.splitCount} ${splitWord} · ${
      result.totalTimelines} ${timelineWord} · ${placements.length} ${pieceWord} placed`;
  byId('result-save-status').textContent = saveError ?
      'Progress could not be saved. Storage may be full or disabled.' : '';
  document.querySelector('[data-action="next"]').textContent =
      mode === 'rush' ? 'Next cascade' : 'Next level';
  // A solved Rush board already paid its score and time; replaying it would pay again.
  document.querySelector('#result-screen [data-action="retry"]').classList.toggle('hidden', mode === 'rush');
}
