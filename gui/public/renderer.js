const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const resetButton = document.getElementById('reset-button');

const pokemonFilterName = document.getElementById('pokemon-filter-name');
const pokemonFilterType = document.getElementById('pokemon-filter-type');
const clearFiltersButton = document.getElementById('clear-filters');
const pokemonList = document.getElementById('pokemon-list');
const dexStatus = document.getElementById('dex-status');
const dexCount = document.getElementById('dex-count');

const pokemonModal = document.getElementById('pokemon-modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalClose = document.getElementById('modal-close');
const modalName = document.getElementById('modal-name');
const modalNumber = document.getElementById('modal-number');
const modalSprite = document.getElementById('modal-sprite');
const modalSpriteToggle = document.getElementById('modal-sprite-toggle');
const modalHeight = document.getElementById('modal-height');
const modalWeight = document.getElementById('modal-weight');
const modalTypes = document.getElementById('modal-types');
const modalAbilities = document.getElementById('modal-abilities');
const modalAbilitySelect = document.getElementById('modal-ability-select');
const modalAbilityDescription = document.getElementById('modal-ability-description');
const modalStats = document.getElementById('modal-stats');
const modalDescription = document.getElementById('modal-description');
const modalLore = document.getElementById('modal-lore');
const modalWeaknesses = document.getElementById('modal-weaknesses');
const modalResistances = document.getElementById('modal-resistances');
const modalImmunities = document.getElementById('modal-immunities');
const modalEvolutionStages = document.getElementById('modal-evolution-stages');
const modalEvolutionTransitions = document.getElementById('modal-evolution-transitions');
const modalMovesSummary = document.getElementById('modal-moves-summary');
const modalMovesSource = document.getElementById('modal-moves-source');
const modalMoves = document.getElementById('modal-moves');
const modalChatButton = document.getElementById('modal-chat-button');
const movePopover = document.getElementById('move-popover');

let allPokemon = [];
let filteredPokemon = [];
let spriteMap = new Map();
const detailCache = new Map();
let selectedPokemonIdentifier = null;
const STAT_BAR_SCALE_MAX = 175;
let activeMoveChip = null;
let pokemonLinkRegex = null;
const pokemonAliasToIdentifier = new Map();
let currentModalAbilityOptions = [];
let currentModalBaseTypeRelations = { weaknesses: [], resistances: [], immunities: [] };
let currentModalSpriteSet = { normal: null, shiny: null, active: 'normal' };
let currentModalSpriteLabel = 'Pokémon';

const TYPE_THEME = {
  normal: { bg: '#f4f4df', border: '#9f9f7c', text: '#55553b' },
  fire: { bg: '#ffe3d2', border: '#cf6a34', text: '#7a2e12' },
  water: { bg: '#dcecff', border: '#4c85cf', text: '#1c4678' },
  electric: { bg: '#fff6c7', border: '#d5a415', text: '#6b5600' },
  grass: { bg: '#dcf4d8', border: '#4a9a53', text: '#1f5e2a' },
  ice: { bg: '#dff7fb', border: '#63abc1', text: '#1e5563' },
  fighting: { bg: '#ffdcd6', border: '#cb5b4e', text: '#74231a' },
  poison: { bg: '#f2ddff', border: '#9c60c8', text: '#5a2a79' },
  ground: { bg: '#f3e4c8', border: '#b18649', text: '#63461d' },
  flying: { bg: '#e6ebff', border: '#7a8ccd', text: '#304178' },
  psychic: { bg: '#ffddea', border: '#ce6798', text: '#7a244f' },
  bug: { bg: '#edf6d5', border: '#8dad49', text: '#4a6119' },
  rock: { bg: '#eee4d2', border: '#9e835b', text: '#534024' },
  ghost: { bg: '#e7e1f4', border: '#7a67a8', text: '#3e2f67' },
  dragon: { bg: '#e2dcff', border: '#6e63cc', text: '#2f277a' },
  dark: { bg: '#e3ddd8', border: '#6f6257', text: '#352c25' },
  steel: { bg: '#e2eaee', border: '#7d919e', text: '#334851' },
  fairy: { bg: '#ffe4f4', border: '#c774a5', text: '#6c2a50' },
};

const placeholderSprite =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="#f6e6bf"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#805f2f">No Sprite</text></svg>'
  );

function normalizeAliasText(text) {
  return normalizeText(text)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWordChar(char) {
  return !!char && /[\p{L}\p{N}_]/u.test(char);
}

function hasWordBoundaries(text, start, end) {
  const left = start > 0 ? text[start - 1] : '';
  const right = end < text.length ? text[end] : '';
  return !isWordChar(left) && !isWordChar(right);
}

function typeThemeFor(type) {
  const key = normalizeText(type).replace(/\s+/g, '_');
  return TYPE_THEME[key] || null;
}

function applyTypeTheme(element, type) {
  const theme = typeThemeFor(type);
  if (!theme) {
    return;
  }

  element.style.backgroundColor = theme.bg;
  element.style.borderColor = theme.border;
  element.style.color = theme.text;
}

function buildPokemonLinkIndex(entries) {
  pokemonAliasToIdentifier.clear();
  const aliasTexts = [];

  for (const entry of entries || []) {
    const aliases = [
      entry.display_name,
      entry.identifier,
      String(entry.identifier || '').replace(/_/g, ' '),
      String(entry.identifier || '').replace(/_/g, '-'),
    ];

    for (const alias of aliases) {
      const trimmed = String(alias || '').trim();
      if (!trimmed) {
        continue;
      }

      const key = normalizeAliasText(trimmed);
      if (!key || pokemonAliasToIdentifier.has(key)) {
        continue;
      }

      pokemonAliasToIdentifier.set(key, entry.identifier);
      aliasTexts.push(trimmed);
    }
  }

  if (aliasTexts.length === 0) {
    pokemonLinkRegex = null;
    return;
  }

  aliasTexts.sort((a, b) => b.length - a.length);

  try {
    pokemonLinkRegex = new RegExp(`(${aliasTexts.map(escapeRegExp).join('|')})`, 'giu');
  } catch {
    pokemonLinkRegex = null;
  }
}

function appendTextNode(container, text) {
  if (!text) {
    return;
  }
  container.appendChild(document.createTextNode(text));
}

const QUIZ_CHOICES_RE = /\[\[QUIZ_CHOICES\]\]([\s\S]*?)\[\[\/QUIZ_CHOICES\]\]/;
const QUIZ_MENU_RE = /\[\[QUIZ_MENU\]\]([\s\S]*?)\[\[\/QUIZ_MENU\]\]/;
const BATTLE_STATUS_RE = /\[\[BATTLE_STATUS\]\]([\s\S]*?)\[\[\/BATTLE_STATUS\]\]/;
const BATTLE_MOVES_RE = /\[\[BATTLE_MOVES\]\]([\s\S]*?)\[\[\/BATTLE_MOVES\]\]/;
const ALL_MARKERS_RE = /(\[\[BATTLE_STATUS\]\][\s\S]*?\[\[\/BATTLE_STATUS\]\]|\[\[BATTLE_MOVES\]\][\s\S]*?\[\[\/BATTLE_MOVES\]\]|\[\[QUIZ_MENU\]\][\s\S]*?\[\[\/QUIZ_MENU\]\]|\[\[QUIZ_CHOICES\]\][\s\S]*?\[\[\/QUIZ_CHOICES\]\])/;

const STATUS_LABEL = {
  BRN: 'QUE', PAR: 'PAR', PSN: 'VEN', TOX: 'TOX',
  FRZ: 'GEL', SLP: 'SOM', FNT: 'DSM', OK: '',
};

function renderQuizMenu(container, optionsText) {
  const lines = optionsText.trim().split('\n').filter(Boolean);
  const grid = document.createElement('div');
  grid.className = 'quiz-menu-grid';
  lines.forEach((line) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quiz-menu-btn';
    btn.textContent = line.trim();
    btn.addEventListener('click', () => {
      chatInput.value = line.trim();
      chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    grid.appendChild(btn);
  });
  container.appendChild(grid);
}

function renderQuizChoices(container, optionsText) {
  const lines = optionsText.trim().split('\n').filter(Boolean);
  const grid = document.createElement('div');
  grid.className = 'quiz-choices-grid';
  lines.forEach((line) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quiz-choice-btn';
    btn.textContent = line.trim();
    btn.addEventListener('click', () => {
      const letter = line.trim()[0];
      chatInput.value = letter;
      chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    grid.appendChild(btn);
  });
  container.appendChild(grid);
}

function renderTextSegment(container, segment) {
  if (!pokemonLinkRegex || !segment) {
    if (segment) appendTextNode(container, segment);
    return;
  }
  pokemonLinkRegex.lastIndex = 0;
  let lastIndex = 0;
  let foundLink = false;
  let match;
  while ((match = pokemonLinkRegex.exec(segment)) !== null) {
    const matchText = match[0];
    const start = match.index;
    const end = start + matchText.length;
    if (!hasWordBoundaries(segment, start, end)) continue;
    const key = normalizeAliasText(matchText);
    const identifier = pokemonAliasToIdentifier.get(key);
    if (!identifier) continue;
    appendTextNode(container, segment.slice(lastIndex, start));
    const linkButton = document.createElement('button');
    linkButton.type = 'button';
    linkButton.className = 'chat-pokemon-link';
    linkButton.textContent = matchText;
    linkButton.addEventListener('click', () => openPokemonModal(identifier));
    container.appendChild(linkButton);
    lastIndex = end;
    foundLink = true;
  }
  appendTextNode(container, segment.slice(lastIndex));
}

function renderBattleStatus(container, innerText) {
  const panel = document.createElement('div');
  panel.className = 'battle-status-panel';

  const halves = innerText.trim().split(/\nvs\n/);
  const myPart = halves[0] || '';
  const oppPart = halves[1] || '';

  function renderSlot(line) {
    const parts = line.trim().split('|');
    if (parts.length < 4) return null;
    const [name, cur, max, status] = parts;
    const currentHp = Number(cur);
    const maxHp = Number(max) || 1;
    const pct = Math.max(0, Math.min(100, Math.round((currentHp / maxHp) * 100)));
    const colorClass = pct > 50 ? 'green' : pct > 20 ? 'yellow' : 'red';

    const row = document.createElement('div');
    row.className = 'battle-slot-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'battle-slot-name';
    nameSpan.textContent = name;

    const hpInfo = document.createElement('span');
    hpInfo.className = 'battle-slot-hp-info';
    hpInfo.textContent = `${currentHp}/${maxHp}`;

    const statusSpan = document.createElement('span');
    const isFainted = status === 'FNT';
    const hasStatus = status !== 'OK' && !isFainted;
    statusSpan.className = `battle-slot-status${hasStatus ? ' has-status' : ''}${isFainted ? ' fainted' : ''}`;
    statusSpan.textContent = STATUS_LABEL[status] || status;

    const track = document.createElement('div');
    track.className = 'hp-bar-track';
    const fill = document.createElement('div');
    fill.className = `hp-bar-fill ${colorClass}`;
    fill.style.width = `${pct}%`;
    track.appendChild(fill);

    row.appendChild(nameSpan);
    row.appendChild(hpInfo);
    row.appendChild(statusSpan);
    row.appendChild(track);
    return row;
  }

  function renderTeam(text, label) {
    const teamDiv = document.createElement('div');
    teamDiv.className = 'battle-team-block';
    const teamLabel = document.createElement('div');
    teamLabel.className = 'battle-team-label';
    teamLabel.textContent = label;
    teamDiv.appendChild(teamLabel);
    for (const line of text.trim().split('\n').filter(Boolean)) {
      const slot = renderSlot(line);
      if (slot) teamDiv.appendChild(slot);
    }
    return teamDiv;
  }

  panel.appendChild(renderTeam(myPart, 'Seu time'));
  const divider = document.createElement('div');
  divider.className = 'battle-vs-divider';
  divider.textContent = 'vs';
  panel.appendChild(divider);
  panel.appendChild(renderTeam(oppPart, 'Oponente'));

  container.appendChild(panel);
}

function renderBattleMoves(container, innerText) {
  const lines = innerText.trim().split('\n').filter(Boolean);
  const grid = document.createElement('div');
  grid.className = 'battle-moves-grid';
  lines.forEach((line) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'battle-move-btn';
    btn.textContent = line.trim();
    btn.addEventListener('click', () => {
      const letter = line.trim()[0];
      chatInput.value = letter;
      chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    grid.appendChild(btn);
  });
  container.appendChild(grid);
}

function renderBotMessageWithLinks(container, text) {
  container.innerHTML = '';

  const parts = text.split(ALL_MARKERS_RE);
  for (const part of parts) {
    if (!part) continue;
    let m;
    if ((m = BATTLE_STATUS_RE.exec(part)) !== null) {
      renderBattleStatus(container, m[1]);
    } else if ((m = BATTLE_MOVES_RE.exec(part)) !== null) {
      renderBattleMoves(container, m[1]);
    } else if ((m = QUIZ_MENU_RE.exec(part)) !== null) {
      renderQuizMenu(container, m[1]);
    } else if ((m = QUIZ_CHOICES_RE.exec(part)) !== null) {
      renderQuizChoices(container, m[1]);
    } else {
      renderTextSegment(container, part);
    }
  }
}

function appendMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-message ${role}`;

  if (role === 'bot') {
    renderBotMessageWithLinks(bubble, String(text || ''));
  } else {
    bubble.textContent = text;
  }

  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeSpriteLookupKey(text) {
  return normalizeText(text).replace(/[^a-z0-9]+/g, '');
}

function mapSpritesByKey(sprites) {
  spriteMap = new Map();
  for (const sprite of sprites || []) {
    const rawId = String(sprite?.id || '').trim();
    if (!rawId) {
      continue;
    }

    const key = normalizeSpriteLookupKey(rawId);
    if (!key) {
      continue;
    }

    const variant = normalizeText(sprite?.variant) === 'shiny' ? 'shiny' : 'normal';
    const current = spriteMap.get(key) || { normal: null, shiny: null };
    current[variant] = sprite.url;
    spriteMap.set(key, current);
  }
}

function findSpriteUrls(detail) {
  const candidates = [detail.identifier, detail.display_name, String(detail.id)];

  for (const candidate of candidates) {
    const normalized = normalizeSpriteLookupKey(candidate);
    if (spriteMap.has(normalized)) {
      return spriteMap.get(normalized);
    }
  }

  return null;
}

function updateModalSpriteToggleState() {
  const hasShiny = !!currentModalSpriteSet.shiny;
  modalSpriteToggle.disabled = !hasShiny;

  if (!hasShiny) {
    modalSpriteToggle.textContent = 'Shiny indisponivel';
    modalSpriteToggle.setAttribute('aria-pressed', 'false');
    return;
  }

  const isShiny = currentModalSpriteSet.active === 'shiny';
  modalSpriteToggle.textContent = isShiny ? 'Ver sprite normal' : 'Ver sprite shiny';
  modalSpriteToggle.setAttribute('aria-pressed', isShiny ? 'true' : 'false');
}

function applyModalSpriteVariant(variant) {
  const wantsShiny = variant === 'shiny';
  const targetVariant = wantsShiny && currentModalSpriteSet.shiny ? 'shiny' : 'normal';
  currentModalSpriteSet.active = targetVariant;

  const nextSprite = currentModalSpriteSet[targetVariant] || placeholderSprite;
  modalSprite.src = nextSprite;
  modalSprite.alt =
    targetVariant === 'shiny'
      ? `Sprite shiny de ${currentModalSpriteLabel}`
      : `Sprite de ${currentModalSpriteLabel}`;

  updateModalSpriteToggleState();
}

function setupModalSprites(detail) {
  const resolved = findSpriteUrls(detail) || { normal: null, shiny: null };
  currentModalSpriteLabel = detail.display_name || 'Pokémon';
  currentModalSpriteSet = {
    normal: resolved.normal || resolved.shiny || null,
    shiny: resolved.shiny || null,
    active: 'normal',
  };

  applyModalSpriteVariant('normal');
}

function buildTypeOptions(entries) {
  while (pokemonFilterType.options.length > 1) {
    pokemonFilterType.remove(1);
  }

  const typeMap = new Map();
  for (const entry of entries) {
    const rawTypes = entry.types || [];
    const labels = entry.type_labels || [];
    rawTypes.forEach((type, index) => {
      if (!typeMap.has(type)) {
        typeMap.set(type, labels[index] || type);
      }
    });
  }

  const sortedTypes = [...typeMap.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  for (const [type, label] of sortedTypes) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = label;
    pokemonFilterType.appendChild(option);
  }
}

function createTypeBadges(types, typeLabels) {
  const container = document.createElement('div');
  container.className = 'entry-types';

  for (let index = 0; index < (typeLabels || []).length; index += 1) {
    const typeLabel = typeLabels[index];
    const type = (types || [])[index];

    const badge = document.createElement('span');
    badge.className = 'entry-type-badge';
    badge.textContent = typeLabel;
    applyTypeTheme(badge, type);
    container.appendChild(badge);
  }

  return container;
}

function renderPokemonList() {
  pokemonList.innerHTML = '';
  dexCount.textContent = `${filteredPokemon.length} Pokémon exibidos`;

  if (filteredPokemon.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = 'Nenhum Pokémon encontrado com os filtros atuais.';
    pokemonList.appendChild(empty);
    return;
  }

  for (const entry of filteredPokemon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pokemon-entry';
    button.addEventListener('click', () => openPokemonModal(entry.identifier));

    const title = document.createElement('div');
    title.className = 'entry-title';
    title.textContent = `#${entry.id} ${entry.display_name}`;

    const subtitle = document.createElement('div');
    subtitle.className = 'entry-subtitle';
    subtitle.textContent = entry.identifier.replace(/_/g, ' ');

    button.appendChild(title);
    button.appendChild(subtitle);
    button.appendChild(createTypeBadges(entry.types || [], entry.type_labels || []));

    pokemonList.appendChild(button);
  }
}

function applyPokemonFilters() {
  const nameFilter = normalizeText(pokemonFilterName.value);
  const typeFilter = pokemonFilterType.value;

  filteredPokemon = allPokemon.filter((entry) => {
    const matchesType = !typeFilter || (entry.types || []).includes(typeFilter);
    if (!matchesType) {
      return false;
    }

    if (!nameFilter) {
      return true;
    }

    const candidate = `${entry.display_name} ${entry.identifier} ${entry.id}`;
    return normalizeText(candidate).includes(nameFilter);
  });

  renderPokemonList();
}

function renderStatBars(detail) {
  modalStats.innerHTML = '';
  const max = Math.max(1, STAT_BAR_SCALE_MAX);

  for (const stat of detail.stats || []) {
    const row = document.createElement('div');
    row.className = 'stat-row';

    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = stat.label;

    const barWrap = document.createElement('div');
    barWrap.className = 'stat-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'stat-bar';
    const pct = Math.min(100, Math.round((Number(stat.value || 0) / max) * 100));
    bar.style.width = `${pct}%`;

    const value = document.createElement('span');
    value.className = 'stat-value';
    value.textContent = String(stat.value);

    barWrap.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(value);
    modalStats.appendChild(row);
  }
}

function renderRelationBadges(container, entries) {
  container.innerHTML = '';

  if (!entries || entries.length === 0) {
    const badge = document.createElement('span');
    badge.className = 'relation-badge muted';
    badge.textContent = 'nenhuma';
    container.appendChild(badge);
    return;
  }

  for (const entry of entries) {
    const data =
      typeof entry === 'string'
        ? { type: '', type_label: entry, multiplier: '' }
        : {
            type: entry.type || '',
            type_label: entry.type_label || '-',
            multiplier: entry.multiplier || '',
          };

    const badge = document.createElement('span');
    badge.className = 'relation-badge';
    badge.textContent = data.multiplier ? `${data.type_label} (${data.multiplier})` : data.type_label;
    applyTypeTheme(badge, data.type);
    container.appendChild(badge);
  }
}

function normalizeTypeRelations(relations) {
  return {
    weaknesses: Array.isArray(relations?.weaknesses) ? relations.weaknesses : [],
    resistances: Array.isArray(relations?.resistances) ? relations.resistances : [],
    immunities: Array.isArray(relations?.immunities) ? relations.immunities : [],
  };
}

function normalizeAbilityOption(option, fallbackLabel = '') {
  const label = moveFieldText(option?.label || fallbackLabel, fallbackLabel || '-');
  const rawIdentifier = moveFieldText(option?.identifier, normalizeText(label).replace(/\s+/g, '_'));

  return {
    identifier: rawIdentifier,
    label,
    short_effect: moveFieldText(option?.short_effect, ''),
    effect: moveFieldText(option?.effect, ''),
    type_relations: normalizeTypeRelations(option?.type_relations),
  };
}

function abilityDescriptionText(option) {
  const shortText = moveFieldText(option?.short_effect, '');
  const longText = moveFieldText(option?.effect, '');

  if (shortText && longText && normalizeText(shortText) !== normalizeText(longText)) {
    return `${shortText} ${longText}`;
  }

  return longText || shortText || 'Sem descrição detalhada disponível.';
}

function renderRelationsForSelectedAbility() {
  const selectedAbility = modalAbilitySelect.value;
  const selectedOption = currentModalAbilityOptions.find((option) => option.identifier === selectedAbility);
  const relations = selectedOption
    ? normalizeTypeRelations(selectedOption.type_relations)
    : normalizeTypeRelations(currentModalBaseTypeRelations);

  renderRelationBadges(modalWeaknesses, relations.weaknesses);
  renderRelationBadges(modalResistances, relations.resistances);
  renderRelationBadges(modalImmunities, relations.immunities);

  modalAbilityDescription.textContent = selectedOption
    ? abilityDescriptionText(selectedOption)
    : 'Sem descrição detalhada disponível.';
}

function setupAbilitySelection(detail) {
  const rawAbilityOptions = Array.isArray(detail.ability_options) ? detail.ability_options : [];
  currentModalAbilityOptions = rawAbilityOptions.map((option) => normalizeAbilityOption(option));
  currentModalBaseTypeRelations = normalizeTypeRelations(detail.type_relations);

  if (currentModalAbilityOptions.length === 0) {
    const fallbackLabels = Array.isArray(detail.abilities) ? detail.abilities : [];
    currentModalAbilityOptions = fallbackLabels.map((label) =>
      normalizeAbilityOption({ label, identifier: normalizeText(label).replace(/\s+/g, '_') }, label)
    );
  }

  const abilityLabels = currentModalAbilityOptions.map((option) => option.label);
  modalAbilities.textContent = abilityLabels.length > 0 ? abilityLabels.join(', ') : 'sem dados';

  modalAbilitySelect.innerHTML = '';
  if (currentModalAbilityOptions.length === 0) {
    const optionElement = document.createElement('option');
    optionElement.value = '';
    optionElement.textContent = 'Sem habilidade disponível';
    modalAbilitySelect.appendChild(optionElement);
    modalAbilitySelect.disabled = true;
    modalAbilityDescription.textContent = 'Sem dados de habilidade para este Pokémon.';

    const baseRelations = normalizeTypeRelations(currentModalBaseTypeRelations);
    renderRelationBadges(modalWeaknesses, baseRelations.weaknesses);
    renderRelationBadges(modalResistances, baseRelations.resistances);
    renderRelationBadges(modalImmunities, baseRelations.immunities);
    return;
  }

  for (const option of currentModalAbilityOptions) {
    const optionElement = document.createElement('option');
    optionElement.value = option.identifier;
    optionElement.textContent = option.label;
    modalAbilitySelect.appendChild(optionElement);
  }

  const selectedAbility = moveFieldText(detail.selected_ability, '');
  const hasSelectedAbility = currentModalAbilityOptions.some((option) => option.identifier === selectedAbility);
  modalAbilitySelect.value = hasSelectedAbility ? selectedAbility : currentModalAbilityOptions[0].identifier;
  modalAbilitySelect.disabled = currentModalAbilityOptions.length <= 1;
  renderRelationsForSelectedAbility();
}

function moveFieldText(value, fallback = '-') {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'null') {
    return fallback;
  }

  return text;
}

function normalizeMoveEntry(moveEntry) {
  if (typeof moveEntry === 'string') {
    const label = moveEntry;
    return {
      identifier: normalizeText(label).replace(/\s+/g, '_'),
      label,
      type: '',
      type_label: '-',
      category_label: '-',
      power: '-',
      accuracy: '-',
      pp: '-',
      priority: '0',
      effect: 'Sem descrição disponível.',
      effect_chance: '-',
      ailment: '-',
      effect_category: '-',
    };
  }

  const label = moveFieldText(moveEntry?.label || moveEntry?.identifier, 'Move');
  return {
    identifier: moveFieldText(moveEntry?.identifier, normalizeText(label).replace(/\s+/g, '_')),
    label,
    type: moveFieldText(moveEntry?.type, ''),
    type_label: moveFieldText(moveEntry?.type_label),
    category_label: moveFieldText(moveEntry?.category_label),
    power: moveFieldText(moveEntry?.power),
    accuracy: moveFieldText(moveEntry?.accuracy),
    pp: moveFieldText(moveEntry?.pp),
    priority: moveFieldText(moveEntry?.priority, '0'),
    effect: moveFieldText(moveEntry?.effect, 'Sem descrição disponível.'),
    effect_chance: moveFieldText(moveEntry?.effect_chance),
    ailment: moveFieldText(moveEntry?.ailment),
    effect_category: moveFieldText(moveEntry?.effect_category),
  };
}

function hideMovePopover() {
  if (activeMoveChip) {
    activeMoveChip.classList.remove('active');
    activeMoveChip = null;
  }

  movePopover.classList.add('hidden');
  movePopover.setAttribute('aria-hidden', 'true');
  movePopover.style.left = '-9999px';
  movePopover.style.top = '-9999px';
}

function positionMovePopover(anchorChip) {
  const anchorRect = anchorChip.getBoundingClientRect();
  const popoverRect = movePopover.getBoundingClientRect();

  let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - popoverRect.width - 12));

  let top = anchorRect.bottom + 10;
  if (top + popoverRect.height > window.innerHeight - 12) {
    top = anchorRect.top - popoverRect.height - 10;
  }
  top = Math.max(12, top);

  movePopover.style.left = `${Math.round(left)}px`;
  movePopover.style.top = `${Math.round(top)}px`;
}

function buildMovePopover(moveEntry) {
  movePopover.innerHTML = '';

  const title = document.createElement('h6');
  title.className = 'move-popover-title';
  title.textContent = moveEntry.label;
  applyTypeTheme(title, moveEntry.type);

  const grid = document.createElement('div');
  grid.className = 'move-popover-grid';

  const fields = [
    ['Tipo', moveEntry.type_label],
    ['Categoria', moveEntry.category_label],
    ['Poder', moveEntry.power],
    ['Precisão', moveEntry.accuracy],
    ['PP', moveEntry.pp],
    ['Prioridade', moveEntry.priority],
    ['Chance de efeito', moveEntry.effect_chance],
    ['Ailment', moveEntry.ailment],
    ['Classe efeito', moveEntry.effect_category],
  ];

  for (const [label, value] of fields) {
    const item = document.createElement('div');
    item.className = 'move-popover-item';

    const key = document.createElement('span');
    key.className = 'move-popover-key';
    key.textContent = label;

    const val = document.createElement('span');
    val.className = 'move-popover-value';
    val.textContent = value;

    item.appendChild(key);
    item.appendChild(val);
    grid.appendChild(item);
  }

  const effect = document.createElement('p');
  effect.className = 'move-popover-effect';
  effect.textContent = moveEntry.effect;

  movePopover.appendChild(title);
  movePopover.appendChild(grid);
  movePopover.appendChild(effect);
}

function toggleMovePopover(moveEntry, chip) {
  const isSameChipOpen = activeMoveChip === chip && !movePopover.classList.contains('hidden');
  if (isSameChipOpen) {
    hideMovePopover();
    return;
  }

  if (activeMoveChip) {
    activeMoveChip.classList.remove('active');
  }

  activeMoveChip = chip;
  activeMoveChip.classList.add('active');

  buildMovePopover(moveEntry);
  movePopover.classList.remove('hidden');
  movePopover.setAttribute('aria-hidden', 'false');
  positionMovePopover(chip);
}

function renderMoves(detail) {
  hideMovePopover();
  modalMoves.innerHTML = '';
  modalMovesSummary.textContent = `Movelist (${detail.moves_count || 0} moves)`;
  modalMovesSource.textContent = detail.moves_source === 'exact' ? '' : `Fonte de movelist: ${detail.moves_source}`;

  const rawMoves =
    Array.isArray(detail.moves_details) && detail.moves_details.length > 0
      ? detail.moves_details
      : detail.moves || [];

  for (const rawMove of rawMoves) {
    const moveEntry = normalizeMoveEntry(rawMove);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'move-chip';
    chip.textContent = moveEntry.label;
    applyTypeTheme(chip, moveEntry.type);
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMovePopover(moveEntry, chip);
    });

    modalMoves.appendChild(chip);
  }
}

function renderEvolution(detail) {
  modalEvolutionStages.innerHTML = '';
  modalEvolutionTransitions.innerHTML = '';

  const members = detail.evolution?.members || [];
  const transitions = detail.evolution?.transitions || [];

  if (!members || members.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'evolution-empty';
    empty.textContent = 'Sem dados de evolução para este Pokémon.';
    modalEvolutionStages.appendChild(empty);
    return;
  }

  const byStage = new Map();
  for (const member of members) {
    const stage = Number(member.stage || 1);
    if (!byStage.has(stage)) {
      byStage.set(stage, []);
    }
    byStage.get(stage).push(member);
  }

  const sortedStages = [...byStage.keys()].sort((a, b) => a - b);
  for (const stage of sortedStages) {
    const column = document.createElement('div');
    column.className = 'evolution-stage-column';

    const title = document.createElement('h5');
    title.className = 'evolution-stage-title';
    title.textContent = `Estágio ${stage}`;

    const list = document.createElement('div');
    list.className = 'evolution-stage-list';

    const membersInStage = [...byStage.get(stage)].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    for (const member of membersInStage) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `evolution-chip ${member.current ? 'current' : ''}`.trim();
      chip.textContent = member.display_name;
      applyTypeTheme(chip, member.types?.[0]);
      chip.addEventListener('click', () => {
        openPokemonModal(member.identifier);
      });
      list.appendChild(chip);
    }

    column.appendChild(title);
    column.appendChild(list);
    modalEvolutionStages.appendChild(column);
  }

  if (!transitions || transitions.length === 0) {
    return;
  }

  for (const transition of transitions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'evolution-transition-chip';
    item.textContent = `${transition.from_label} -> ${transition.to_label}: ${transition.condition}`;
    item.addEventListener('click', () => {
      if (transition.to_identifier) {
        openPokemonModal(transition.to_identifier);
      }
    });
    modalEvolutionTransitions.appendChild(item);
  }
}

function openModal() {
  pokemonModal.classList.remove('hidden');
  pokemonModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  hideMovePopover();
  pokemonModal.classList.add('hidden');
  pokemonModal.setAttribute('aria-hidden', 'true');
}

async function openPokemonModal(identifier) {
  try {
    let detail = detailCache.get(identifier);
    if (!detail) {
      const payload = await window.pokedexApi.getPokemonDetail(identifier);
      if (!payload.ok) {
        appendMessage('bot', payload.error || 'Não foi possível abrir detalhes desse Pokémon.');
        return;
      }
      detail = payload.detail;
      detailCache.set(identifier, detail);
    }

    selectedPokemonIdentifier = detail.identifier;

    modalName.textContent = detail.display_name;
    modalNumber.textContent = `#${detail.id}`;
    modalHeight.textContent = `${detail.height_m.toFixed(1)} m (${detail.height_dm} dm)`;
    modalWeight.textContent = `${detail.weight_kg.toFixed(1)} kg (${detail.weight_hg} hg)`;
    modalTypes.textContent = (detail.type_labels || []).join(', ');
    modalDescription.textContent = detail.description || 'Sem descrição disponível.';
    modalLore.textContent = detail.lore || 'Sem lore disponível.';

    setupModalSprites(detail);

    renderStatBars(detail);
    setupAbilitySelection(detail);
    renderEvolution(detail);
    renderMoves(detail);

    openModal();
  } catch (error) {
    appendMessage('bot', `Erro ao abrir detalhes: ${error.message}`);
  }
}

async function sendChatPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return;
  }

  appendMessage('user', text);
  try {
    const reply = await window.pokedexApi.ask(text);
    appendMessage('bot', reply);
  } catch (error) {
    appendMessage('bot', `Erro: ${error.message}`);
  }
}

async function boot() {
  appendMessage('bot', 'Conectando ao motor de análise...');

  try {
    await window.pokedexApi.ping();

    const appInfo = await window.pokedexApi.getAppInfo();
    if (appInfo.isPackaged) {
      appendMessage('bot', 'Aviso: rodando versao empacotada — alteracoes no codigo-fonte nao serao refletidas. Use "electron ." na pasta gui/ para modo dev.');
    }

    const sprites = await window.pokedexApi.listSprites();
    mapSpritesByKey(sprites);

    const payload = await window.pokedexApi.listPokemon();
    if (!payload.ok) {
      throw new Error(payload.error || 'Falha ao carregar Pokédex.');
    }

    allPokemon = payload.pokemon || [];
    filteredPokemon = [...allPokemon];
    buildPokemonLinkIndex(allPokemon);

    buildTypeOptions(allPokemon);
    applyPokemonFilters();

    dexStatus.textContent = 'Lista Pokédex carregada.';
    appendMessage(
      'bot',
      'Pokédex pronta. Use a lista da esquerda para dados rápidos e o chat para análises avançadas.'
    );
  } catch (error) {
    dexStatus.textContent = 'Falha ao carregar dados da Pokédex.';
    dexCount.textContent = '';
    appendMessage('bot', `Falha ao iniciar: ${error.message}`);
  }
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = chatInput.value.trim();
  if (!prompt) {
    return;
  }

  chatInput.value = '';
  chatInput.focus();
  await sendChatPrompt(prompt);
});

resetButton.addEventListener('click', async () => {
  try {
    const reply = await window.pokedexApi.reset();
    appendMessage('bot', reply);
  } catch (error) {
    appendMessage('bot', `Erro ao resetar: ${error.message}`);
  }
});

pokemonFilterName.addEventListener('input', applyPokemonFilters);
pokemonFilterType.addEventListener('change', applyPokemonFilters);

clearFiltersButton.addEventListener('click', () => {
  pokemonFilterName.value = '';
  pokemonFilterType.value = '';
  applyPokemonFilters();
  pokemonFilterName.focus();
});

modalSpriteToggle.addEventListener('click', () => {
  if (!currentModalSpriteSet.shiny) {
    return;
  }
  const nextVariant = currentModalSpriteSet.active === 'shiny' ? 'normal' : 'shiny';
  applyModalSpriteVariant(nextVariant);
});

modalBackdrop.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);
modalAbilitySelect.addEventListener('change', renderRelationsForSelectedAbility);
pokemonModal.addEventListener('scroll', hideMovePopover, true);

document.addEventListener('click', (event) => {
  if (movePopover.classList.contains('hidden')) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    hideMovePopover();
    return;
  }

  if (target.closest('.move-chip') || target.closest('#move-popover')) {
    return;
  }

  hideMovePopover();
});

window.addEventListener('resize', () => {
  if (!movePopover.classList.contains('hidden') && activeMoveChip) {
    positionMovePopover(activeMoveChip);
  }
});

modalChatButton.addEventListener('click', async () => {
  if (!selectedPokemonIdentifier) {
    return;
  }
  closeModal();

  const query = `pokemon ${selectedPokemonIdentifier.replace(/_/g, ' ')}`;
  chatInput.value = query;
  await sendChatPrompt(query);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  if (!movePopover.classList.contains('hidden')) {
    hideMovePopover();
    return;
  }

  if (!pokemonModal.classList.contains('hidden')) {
    closeModal();
  }
});

boot();

// ============================================================================
// BATTLE PANEL
// ============================================================================

// ── Constants ──────────────────────────────────────────────────────────────

const VGC_ITEMS = [
  { id: 'life_orb', name: 'Life Orb' },
  { id: 'choice_band', name: 'Choice Band' },
  { id: 'choice_specs', name: 'Choice Specs' },
  { id: 'choice_scarf', name: 'Choice Scarf' },
  { id: 'assault_vest', name: 'Assault Vest' },
  { id: 'leftovers', name: 'Leftovers' },
  { id: 'rocky_helmet', name: 'Rocky Helmet' },
  { id: 'focus_sash', name: 'Focus Sash' },
  { id: 'sitrus_berry', name: 'Sitrus Berry' },
  { id: 'lum_berry', name: 'Lum Berry' },
  { id: 'weakness_policy', name: 'Weakness Policy' },
  { id: 'clear_amulet', name: 'Clear Amulet' },
  { id: 'safety_goggles', name: 'Safety Goggles' },
  { id: 'covert_cloak', name: 'Covert Cloak' },
  { id: 'booster_energy', name: 'Booster Energy' },
  { id: 'throat_spray', name: 'Throat Spray' },
  { id: 'eviolite', name: 'Eviolite' },
  { id: 'occa_berry', name: 'Occa Berry' },
  { id: 'passho_berry', name: 'Passho Berry' },
  { id: 'wacan_berry', name: 'Wacan Berry' },
  { id: 'yache_berry', name: 'Yache Berry' },
  { id: 'chople_berry', name: 'Chople Berry' },
  { id: 'rindo_berry', name: 'Rindo Berry' },
  { id: 'shuca_berry', name: 'Shuca Berry' },
  { id: 'coba_berry', name: 'Coba Berry' },
  { id: 'payapa_berry', name: 'Payapa Berry' },
  { id: 'haban_berry', name: 'Haban Berry' },
  { id: 'kasib_berry', name: 'Kasib Berry' },
  { id: 'roseli_berry', name: 'Roseli Berry' },
  { id: 'charcoal', name: 'Charcoal' },
  { id: 'mystic_water', name: 'Mystic Water' },
  { id: 'magnet', name: 'Magnet' },
  { id: 'miracle_seed', name: 'Miracle Seed' },
  { id: 'twisted_spoon', name: 'Twisted Spoon' },
  { id: 'silk_scarf', name: 'Silk Scarf' },
  { id: 'dragon_fang', name: 'Dragon Fang' },
  { id: 'black_glasses', name: 'Black Glasses' },
  { id: 'metal_coat', name: 'Metal Coat' },
  { id: 'sharp_beak', name: 'Sharp Beak' },
  { id: 'spell_tag', name: 'Spell Tag' },
  { id: 'fairy_feather', name: 'Fairy Feather' },
  { id: 'hard_stone', name: 'Hard Stone' },
  { id: 'black_belt', name: 'Black Belt' },
  { id: 'soft_sand', name: 'Soft Sand' },
  { id: 'poison_barb', name: 'Poison Barb' },
  { id: 'silver_powder', name: 'Silver Powder' },
  { id: 'never-melt_ice', name: 'Never-Melt Ice' },
  { id: 'expert_belt', name: 'Expert Belt' },
  { id: 'red_card', name: 'Red Card' },
  // Mega Stones
  { id: 'kangaskhanite', name: 'Kangaskhanite' },
  { id: 'salamencite', name: 'Salamencite' },
  { id: 'charizardite-x', name: 'Charizardite X' },
  { id: 'charizardite-y', name: 'Charizardite Y' },
  { id: 'mewtwonite-x', name: 'Mewtwonite X' },
  { id: 'mewtwonite-y', name: 'Mewtwonite Y' },
  { id: 'gengarite', name: 'Gengarite' },
  { id: 'lucarionite', name: 'Lucarionite' },
  { id: 'garchompite', name: 'Garchompite' },
  { id: 'lopunnite', name: 'Lopunnite' },
  { id: 'cameruptite', name: 'Cameruptite' },
  { id: 'diancite', name: 'Diancite' },
  { id: 'swampertite', name: 'Swampertite' },
  { id: 'sceptilite', name: 'Sceptilite' },
  { id: 'blazikenite', name: 'Blazikenite' },
  { id: 'galladite', name: 'Galladite' },
  { id: 'gardevoirite', name: 'Gardevoirite' },
  { id: 'beedrillite', name: 'Beedrillite' },
  { id: 'aerodactylite', name: 'Aerodactylite' },
  { id: 'tyranitarite', name: 'Tyranitarite' },
  { id: 'scizorite', name: 'Scizorite' },
  { id: 'gyaradosite', name: 'Gyaradosite' },
  { id: 'pinsirite', name: 'Pinsirite' },
  { id: 'absolite', name: 'Absolite' },
  { id: 'mawilite', name: 'Mawilite' },
  { id: 'manectite', name: 'Manectite' },
  { id: 'houndoominite', name: 'Houndoominite' },
  { id: 'aggronite', name: 'Aggronite' },
  { id: 'ampharosite', name: 'Ampharosite' },
  { id: 'banettite', name: 'Banettite' },
  { id: 'heracronite', name: 'Heracronite' },
  { id: 'medichamite', name: 'Medichamite' },
  { id: 'altarianite', name: 'Altarianite' },
  { id: 'sharpedonite', name: 'Sharpedonite' },
  { id: 'slowbronite', name: 'Slowbronite' },
  { id: 'steelixite', name: 'Steelixite' },
  { id: 'sablenite', name: 'Sablenite' },
  { id: 'audinite', name: 'Audinite' },
  { id: 'venusaurite', name: 'Venusaurite' },
  { id: 'blastoisinite', name: 'Blastoisinite' },
  { id: 'alakazite', name: 'Alakazite' },
  { id: 'latiasite', name: 'Latiasite' },
  { id: 'latiosite', name: 'Latiosite' },
  { id: 'feraligatrite', name: 'Feraligatrite' },
  { id: 'meganiumite', name: 'Meganiumite' },
];

// ── DOM refs ────────────────────────────────────────────────────────────────

const battlePanelEl   = document.getElementById('battle-panel');
const bpBuilderEl     = document.getElementById('bp-builder');
const bpArenaEl       = document.getElementById('bp-arena');
const bpUserSlotsEl   = document.getElementById('bp-user-slots');
const bpEnemySlotsEl  = document.getElementById('bp-enemy-slots');
const bpEditorEl      = document.getElementById('bp-editor');
const bpEditorSprite  = document.getElementById('bp-editor-sprite');
const bpEditorName    = document.getElementById('bp-editor-poke-name');
const bpEditorTypes   = document.getElementById('bp-editor-poke-types');
const bpPokeInput     = document.getElementById('bp-pokemon-input');
const bpPokeSugg      = document.getElementById('bp-pokemon-suggestions');
const bpAbilitySelect = document.getElementById('bp-ability-select');
const bpNatureSelect  = document.getElementById('bp-nature-select');
const bpItemInput     = document.getElementById('bp-item-input');
const bpItemSugg      = document.getElementById('bp-item-suggestions');
const bpEvTotal       = document.getElementById('bp-ev-total');
const bpEvInputs      = document.querySelectorAll('.bp-ev-input');
const bpMovesList     = document.getElementById('bp-moves-list');
const bpMoveSearchWrap = document.getElementById('bp-move-search-wrap');
const bpMoveInput     = document.getElementById('bp-move-input');
const bpMoveSugg      = document.getElementById('bp-move-suggestions');
const bpEnemyCustom   = document.getElementById('bp-enemy-custom');
const bpValidationMsg = document.getElementById('bp-validation-msg');
const bpStartBtn      = document.getElementById('bp-start-btn');
const bpTurnBadge     = document.getElementById('bp-turn-badge');
const bpFieldBadges   = document.getElementById('bp-field-badges');
const bpEnemyActive   = document.getElementById('bp-enemy-active');
const bpEnemyBench    = document.getElementById('bp-enemy-bench');
const bpPlayerActive  = document.getElementById('bp-player-active');
const bpPlayerBench   = document.getElementById('bp-player-bench');
const bpBattleLog     = document.getElementById('bp-battle-log');
const bpActionPanel   = document.getElementById('bp-action-panel');
const bpUserCount     = document.getElementById('bp-user-count');
const bpEnemyCount    = document.getElementById('bp-enemy-count');

// ── Suggestion backdrop (closes any open dropdown on outside click) ──────────

const bpSuggBackdrop = (() => {
  const el = document.createElement('div');
  // Must be inside battlePanelEl (z-index: 500 stacking context) so z-index 999 here
  // is below the suggestions (z-index 1001) but above everything else in the panel.
  el.style.cssText = 'position:absolute;inset:0;z-index:999;display:none;';
  battlePanelEl.appendChild(el);
  el.addEventListener('mousedown', (e) => { e.preventDefault(); bpHideAllSugg(); });
  return el;
})();

function bpShowSugg(sugg) {
  bpSuggBackdrop.style.display = 'block';
  sugg.classList.remove('hidden');
}

function bpHideAllSugg() {
  bpPokeSugg.classList.add('hidden');
  bpItemSugg.classList.add('hidden');
  bpMoveSugg.classList.add('hidden');
  bpSuggBackdrop.style.display = 'none';
}

// ── State ───────────────────────────────────────────────────────────────────

const bp = {
  editingTeam: 'user',     // 'user' | 'enemy'
  editingSlot: 0,
  userSlots: [null, null, null, null],     // Array<config|null>
  enemySlots: [null, null, null, null],
  enemyMode: 'random',
  detail: null,            // loaded detail for the current editing slot
  detailCache: new Map(),  // identifier -> detail
  availableMoves: [],      // moves for the current Pokémon
  battleState: null,       // last VBResponse
  chosen: [null, null],    // chosen actions per slot
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function bpDisplayName(id) {
  return String(id || '').split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function bpCurrentSlots() {
  return bp.editingTeam === 'user' ? bp.userSlots : bp.enemySlots;
}

function bpSpriteUrl(identifier) {
  if (!identifier) return null;
  const entry = spriteMap.get(identifier);
  return entry ? entry.normal : null;
}

function bpTypeThemeColor(type) {
  const t = typeThemeFor(type);
  return t ? t.bg : '#f0f0f0';
}

// ── Open / Close ────────────────────────────────────────────────────────────

function openBattlePanel() {
  battlePanelEl.classList.remove('hidden');
  battlePanelEl.setAttribute('aria-hidden', 'false');
  bpShowView('builder');
  requestAnimationFrame(() => {
    bpRenderAllSlots();
    bpSelectSlot('user', 0);
  });
}

function closeBattlePanel() {
  battlePanelEl.classList.add('hidden');
  battlePanelEl.setAttribute('aria-hidden', 'true');
}

function bpShowView(which) {
  bpBuilderEl.classList.toggle('hidden', which !== 'builder');
  bpArenaEl.classList.toggle('hidden', which !== 'arena');
}

// ── Team slot rendering ──────────────────────────────────────────────────────

function bpRenderAllSlots() {
  bpRenderTeamSlots('user');
  bpRenderTeamSlots('enemy');
}

function bpRenderTeamSlots(team) {
  const container = team === 'user' ? bpUserSlotsEl : bpEnemySlotsEl;
  const slots = team === 'user' ? bp.userSlots : bp.enemySlots;
  container.innerHTML = '';
  slots.forEach((cfg, i) => {
    const card = document.createElement('div');
    card.className = 'bp-slot-card' +
      (cfg ? ' filled' : '') +
      (bp.editingTeam === team && bp.editingSlot === i ? ' selected' : '');
    card.dataset.team = team;
    card.dataset.slot = i;

    if (cfg) {
      const url = bpSpriteUrl(cfg.identifier);
      if (url) {
        const img = document.createElement('img');
        img.className = 'bp-slot-sprite';
        img.src = url;
        img.alt = cfg.identifier;
        card.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'bp-slot-sprite-placeholder';
        ph.textContent = '?';
        card.appendChild(ph);
      }
      const nm = document.createElement('div');
      nm.className = 'bp-slot-name';
      nm.textContent = bpDisplayName(cfg.identifier);
      card.appendChild(nm);
      const det = document.createElement('div');
      det.className = 'bp-slot-detail';
      det.textContent = cfg.ability ? bpDisplayName(cfg.ability) : '';
      card.appendChild(det);
    } else {
      const ph = document.createElement('div');
      ph.className = 'bp-slot-sprite-placeholder';
      ph.textContent = '+';
      card.appendChild(ph);
      const num = document.createElement('div');
      num.className = 'bp-slot-number';
      num.textContent = `Slot ${i + 1}`;
      card.appendChild(num);
    }

    card.addEventListener('click', () => bpSelectSlot(team, i));
    container.appendChild(card);
  });

  // Update count badges
  const count = slots.filter(Boolean).length;
  if (team === 'user') bpUserCount.textContent = `${count} / 4`;
  if (team === 'enemy' && bpEnemyCount) bpEnemyCount.textContent = `${count} / 4`;
}

// ── Select slot to edit ──────────────────────────────────────────────────────

function bpSelectSlot(team, idx) {
  bpSaveCurrentSlot();
  bp.editingTeam = team;
  bp.editingSlot = idx;
  bpRenderAllSlots();
  bpUpdateEditorFromSlot();
}

function bpSaveCurrentSlot() {
  const slots = bpCurrentSlots();
  const existing = slots[bp.editingSlot];
  if (!existing) return;

  // Read EV values
  const evs = {};
  bpEvInputs.forEach((inp) => {
    const stat = inp.dataset.stat;
    const val = Math.max(0, Math.min(252, parseInt(inp.value, 10) || 0));
    if (val > 0) evs[stat] = val;
  });

  slots[bp.editingSlot] = {
    ...existing,
    ability: bpAbilitySelect.value || existing.ability,
    nature: bpNatureSelect.value || existing.nature || 'hardy',
    item: bpItemInput.value.trim()
      ? (VGC_ITEMS.find((it) => it.name.toLowerCase() === bpItemInput.value.trim().toLowerCase())?.id
         || bpItemInput.value.trim().toLowerCase().replace(/\s+/g, '_'))
      : null,
    evs,
    moves: existing.moves || [],
  };
}

function bpUpdateEditorFromSlot() {
  const cfg = bpCurrentSlots()[bp.editingSlot];
  bp.detail = cfg ? bp.detailCache.get(cfg.identifier) : null;
  bp.availableMoves = (bp.detail && bp.detail.moves_details) ? bp.detail.moves_details : [];

  if (cfg) {
    // Sprite
    const url = bpSpriteUrl(cfg.identifier);
    bpEditorSprite.src = url || '';
    bpEditorSprite.style.display = url ? '' : 'none';
    bpEditorName.textContent = bpDisplayName(cfg.identifier);

    // Types
    bpEditorTypes.innerHTML = '';
    const detail = bp.detail;
    const types = detail ? detail.types : [];
    types.forEach((t) => {
      const badge = document.createElement('span');
      badge.className = 'type-badge';
      badge.textContent = t;
      applyTypeTheme(badge, t);
      bpEditorTypes.appendChild(badge);
    });

    // Pokémon input
    bpPokeInput.value = bpDisplayName(cfg.identifier);

    // Ability
    bpPopulateAbilities(detail ? detail.ability_options : null, cfg.ability);

    // Nature
    bpNatureSelect.value = cfg.nature || 'hardy';

    // Item
    const itemObj = cfg.item ? VGC_ITEMS.find((it) => it.id === cfg.item) : null;
    bpItemInput.value = itemObj ? itemObj.name : (cfg.item ? bpDisplayName(cfg.item) : '');

    // EVs
    bpEvInputs.forEach((inp) => {
      inp.value = (cfg.evs && cfg.evs[inp.dataset.stat]) || 0;
    });
    bpUpdateEvTotal();

    // Moves
    bpRenderMovesList(cfg.moves || []);

    // Load full detail if not cached
    if (!bp.detail) {
      bpLoadDetail(cfg.identifier).then(() => bpUpdateEditorFromSlot());
    }
  } else {
    bpEditorSprite.src = '';
    bpEditorSprite.style.display = 'none';
    bpEditorName.textContent = '—';
    bpEditorTypes.innerHTML = '';
    bpPokeInput.value = '';
    bpAbilitySelect.innerHTML = '<option value="">— selecione um Pokémon —</option>';
    bpNatureSelect.value = 'hardy';
    bpItemInput.value = '';
    bpEvInputs.forEach((inp) => { inp.value = 0; });
    bpEvTotal.textContent = '0 / 510';
    bpRenderMovesList([]);
  }

  bpHideAllSugg();
  bpMoveSearchWrap.classList.add('hidden');
  bpMoveInput.value = '';
}

async function bpLoadDetail(identifier) {
  if (bp.detailCache.has(identifier)) {
    bp.detail = bp.detailCache.get(identifier);
    return;
  }
  try {
    const result = await pokedexApi.getPokemonDetail(identifier);
    if (result && result.ok) {
      bp.detailCache.set(identifier, result.detail);
      bp.detail = result.detail;
    }
  } catch { /* ignore */ }
}

// ── Pokémon picker autocomplete ──────────────────────────────────────────────

bpPokeInput.addEventListener('input', () => {
  const q = bpPokeInput.value.trim().toLowerCase();
  if (!q || q.length < 1) { bpHideAllSugg(); return; }
  const matches = allPokemon
    .filter((p) => {
      const id = (p.identifier || '').toLowerCase();
      const name = (p.display_name || '').toLowerCase();
      return id.includes(q) || name.includes(q);
    })
    .slice(0, 8);
  bpPokeSugg.innerHTML = '';
  if (matches.length === 0) { bpHideAllSugg(); return; }
  matches.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'bp-suggestion-item';
    div.textContent = p.display_name || bpDisplayName(p.identifier);
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      bpHideAllSugg();
      bpSelectPokemon(p.identifier, p.display_name || bpDisplayName(p.identifier));
    });
    bpPokeSugg.appendChild(div);
  });
  bpShowSugg(bpPokeSugg);
});

bpPokeInput.addEventListener('blur', () => {
  // Closed via global mousedown listener instead
});

function deriveMegaStoneId(identifier) {
  const EXPLICIT = {
    'charizard-mega-x': 'charizardite-x', 'charizard-mega-y': 'charizardite-y',
    'mewtwo-mega-x': 'mewtwonite-x',      'mewtwo-mega-y': 'mewtwonite-y',
    'lopunny-mega': 'lopunnite',           'audino-mega': 'audinite',
    'blastoise-mega': 'blastoisinite',     'alakazam-mega': 'alakazite',
    'kangaskhan-mega': 'kangaskhanite',
  };
  if (EXPLICIT[identifier]) return EXPLICIT[identifier];
  const m = identifier.match(/^(.+)-mega(?:-(.+))?$/);
  if (!m) return null;
  const stoneName = m[1] + 'ite';
  return m[2] ? `${stoneName}-${m[2]}` : stoneName;
}

async function bpSelectPokemon(identifier, displayName) {
  bpPokeInput.value = displayName;
  const slots = bpCurrentSlots();

  // Check duplicate
  const alreadyIn = slots.some((s, i) => s && s.identifier === identifier && i !== bp.editingSlot);
  if (alreadyIn) {
    bpValidationMsg.textContent = `${displayName} já está no time.`;
    setTimeout(() => { bpValidationMsg.textContent = ''; }, 2000);
    return;
  }

  // Init slot config
  slots[bp.editingSlot] = {
    identifier,
    ability: '',
    nature: 'hardy',
    item: null,
    moves: [],
    evs: { special_attack: 0, attack: 0, speed: 0, hp: 0 },
  };

  // Load detail
  await bpLoadDetail(identifier);
  const detail = bp.detail;

  // Set ability to first available
  if (detail && detail.ability_options && detail.ability_options.length > 0) {
    slots[bp.editingSlot].ability = detail.ability_options[0].id;
  }

  // Auto-fill mega stone when selecting a mega evolution
  if (identifier.includes('-mega')) {
    const stoneId = deriveMegaStoneId(identifier);
    const stoneItem = stoneId ? VGC_ITEMS.find((it) => it.id === stoneId) : null;
    if (stoneItem) slots[bp.editingSlot].item = stoneItem.id;
  }

  // Build available moves list
  if (detail && detail.moves_details) {
    bp.availableMoves = detail.moves_details;
  }

  bpUpdateEditorFromSlot();
  bpPokeInput.blur();
  bpRenderTeamSlots(bp.editingTeam);
  bpCheckStart();
}

// ── Ability ──────────────────────────────────────────────────────────────────

function bpPopulateAbilities(abilityOptions, currentAbility) {
  bpAbilitySelect.innerHTML = '';
  if (!abilityOptions || abilityOptions.length === 0) {
    bpAbilitySelect.innerHTML = '<option value="">—</option>';
    return;
  }
  abilityOptions.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = bpDisplayName(a.id);
    bpAbilitySelect.appendChild(opt);
  });
  if (currentAbility) bpAbilitySelect.value = currentAbility;
}

bpAbilitySelect.addEventListener('change', () => {
  const cfg = bpCurrentSlots()[bp.editingSlot];
  if (cfg) { cfg.ability = bpAbilitySelect.value; bpRenderTeamSlots(bp.editingTeam); }
});

bpNatureSelect.addEventListener('change', () => {
  const cfg = bpCurrentSlots()[bp.editingSlot];
  if (cfg) cfg.nature = bpNatureSelect.value;
});

// ── Item autocomplete ────────────────────────────────────────────────────────

bpItemInput.addEventListener('input', () => {
  const q = bpItemInput.value.trim().toLowerCase();
  bpItemSugg.innerHTML = '';
  if (!q) { bpHideAllSugg(); return; }
  const matches = VGC_ITEMS.filter((it) => it.name.toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) { bpHideAllSugg(); return; }
  matches.forEach((it) => {
    const div = document.createElement('div');
    div.className = 'bp-suggestion-item';
    div.textContent = it.name;
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      bpItemInput.value = it.name;
      bpHideAllSugg();
      const cfg = bpCurrentSlots()[bp.editingSlot];
      if (cfg) cfg.item = it.id;
    });
    bpItemSugg.appendChild(div);
  });
  bpShowSugg(bpItemSugg);
});
bpItemInput.addEventListener('blur', () => {
  // Closed via global mousedown listener instead
});

// ── EVs ──────────────────────────────────────────────────────────────────────

function bpUpdateEvTotal() {
  let total = 0;
  bpEvInputs.forEach((inp) => { total += Math.max(0, parseInt(inp.value, 10) || 0); });
  bpEvTotal.textContent = `${total} / 510`;
  bpEvTotal.classList.toggle('over', total > 510);
}

bpEvInputs.forEach((inp) => {
  inp.addEventListener('input', () => {
    bpUpdateEvTotal();
    const cfg = bpCurrentSlots()[bp.editingSlot];
    if (cfg) {
      if (!cfg.evs) cfg.evs = {};
      const val = Math.max(0, Math.min(252, parseInt(inp.value, 10) || 0));
      if (val > 0) cfg.evs[inp.dataset.stat] = val;
      else delete cfg.evs[inp.dataset.stat];
    }
  });
});

// ── Moves ────────────────────────────────────────────────────────────────────

function bpRenderMovesList(moves) {
  bpMovesList.innerHTML = '';
  moves.forEach((moveId, i) => {
    const chip = document.createElement('span');
    chip.className = 'bp-move-chip';
    chip.textContent = bpDisplayName(moveId);
    const rmBtn = document.createElement('button');
    rmBtn.className = 'bp-move-chip-remove';
    rmBtn.textContent = '×';
    rmBtn.type = 'button';
    rmBtn.addEventListener('click', () => {
      const cfg = bpCurrentSlots()[bp.editingSlot];
      if (cfg) { cfg.moves.splice(i, 1); bpRenderMovesList(cfg.moves); bpCheckStart(); }
    });
    chip.appendChild(rmBtn);
    bpMovesList.appendChild(chip);
  });
  if (moves.length < 4) {
    const addBtn = document.createElement('button');
    addBtn.className = 'bp-add-move-btn';
    addBtn.type = 'button';
    addBtn.textContent = '+ Golpe';
    addBtn.addEventListener('click', () => {
      bpMoveSearchWrap.classList.remove('hidden');
      bpMoveInput.focus();
    });
    bpMovesList.appendChild(addBtn);
  }
}

bpMoveInput.addEventListener('input', () => {
  const q = bpMoveInput.value.trim().toLowerCase();
  bpMoveSugg.innerHTML = '';
  const source = bp.availableMoves.length > 0 ? bp.availableMoves : [];
  if (!q) { bpHideAllSugg(); return; }
  const matches = source
    .filter((m) => {
      const name = (m.label || m.name || m.identifier || m.id || '').toLowerCase();
      const id   = (m.identifier || m.id || '').toLowerCase();
      return name.includes(q) || id.includes(q);
    })
    .slice(0, 10);
  if (matches.length === 0) { bpHideAllSugg(); return; }
  matches.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'bp-suggestion-item';
    const label = m.label || m.name || bpDisplayName(m.identifier || m.id || '');
    const power = m.power && m.power !== '—' && m.power !== '-' ? ` (${m.power})` : '';
    const type  = m.type || m.type_id;
    div.textContent = label + power + (type ? ` [${type}]` : '');
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      bpHideAllSugg();
      bpMoveSearchWrap.classList.add('hidden');
      bpMoveInput.value = '';
      const cfg = bpCurrentSlots()[bp.editingSlot];
      const moveId = m.identifier || m.id;
      if (cfg && cfg.moves.length < 4 && !cfg.moves.includes(moveId)) {
        cfg.moves.push(moveId);
        bpRenderMovesList(cfg.moves);
        bpCheckStart();
      }
    });
    bpMoveSugg.appendChild(div);
  });
  bpShowSugg(bpMoveSugg);
});
bpMoveInput.addEventListener('blur', () => {
  // Closed via global mousedown listener instead
});

// ── Enemy mode toggle ────────────────────────────────────────────────────────

document.querySelectorAll('input[name="bp-enemy-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    bp.enemyMode = radio.value;
    bpEnemyCustom.classList.toggle('hidden', radio.value !== 'custom');
    if (radio.value === 'custom' && bpEnemySlotsEl.children.length === 0) {
      bpRenderTeamSlots('enemy');
    }
    bpCheckStart();
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

function bpCheckStart() {
  bpSaveCurrentSlot();
  const filled = bp.userSlots.filter(Boolean).length;
  const enemyOk = bp.enemyMode === 'random' || bp.enemySlots.filter(Boolean).length === 4;
  const evOk = bp.userSlots.every((s) => {
    if (!s) return true;
    const total = Object.values(s.evs || {}).reduce((a, b) => a + b, 0);
    return total <= 510;
  });
  const hasAbility = bp.userSlots.every((s) => !s || s.ability);
  const hasMoves = bp.userSlots.every((s) => !s || (s.moves && s.moves.length >= 1));

  bpStartBtn.disabled = !(filled === 4 && enemyOk && evOk && hasAbility && hasMoves);
  if (!evOk) bpValidationMsg.textContent = 'EVs acima de 510 em um Pokémon.';
  else if (!hasMoves) bpValidationMsg.textContent = 'Cada Pokémon precisa de ao menos 1 golpe.';
  else bpValidationMsg.textContent = '';
}

// ── Start battle ─────────────────────────────────────────────────────────────

async function bpStartBattle() {
  bpSaveCurrentSlot();
  bpStartBtn.disabled = true;
  bpValidationMsg.textContent = 'Iniciando batalha…';

  const userTeam = {
    pokemon: bp.userSlots.map((s) => ({
      identifier: s.identifier,
      ability: s.ability || 'pressure',
      item: s.item || null,
      moves: s.moves || [],
      evs: s.evs || {},
      nature: s.nature || 'hardy',
    })),
  };

  const payload = { user: userTeam, mode: bp.enemyMode };
  if (bp.enemyMode === 'custom') {
    payload.enemy = {
      pokemon: bp.enemySlots.map((s) => ({
        identifier: s.identifier,
        ability: s.ability || 'pressure',
        item: s.item || null,
        moves: s.moves || [],
        evs: s.evs || {},
        nature: s.nature || 'hardy',
      })),
    };
  }

  try {
    const raw = await pokedexApi.ask(`__BATTLE_INIT_JSON__:${JSON.stringify(payload)}`);
    const state = JSON.parse(raw);
    if (state.type === 'error') {
      bpValidationMsg.textContent = `Erro: ${state.message}`;
      bpStartBtn.disabled = false;
      return;
    }
    bp.battleState = state;
    bp.chosen = [null, null];
    bpShowView('arena');
    bpRenderArena(state);
  } catch (e) {
    bpValidationMsg.textContent = `Erro: ${e.message}`;
    bpStartBtn.disabled = false;
  }
}

// ── Arena rendering ───────────────────────────────────────────────────────────

function bpRenderArena(state) {
  bpTurnBadge.textContent = `Turno ${state.turn + 1}`;

  // Field conditions
  bpFieldBadges.innerHTML = '';
  const { weather, weatherTurns, terrain, terrainTurns, trickRoom, trickRoomTurns } = state.field;
  const tw0 = state.teams[0]?.tailwindTurns || 0;
  const tw1 = state.teams[1]?.tailwindTurns || 0;

  if (weather !== 'none') {
    const wLabel = { sun:'☀ Sol', rain:'🌧 Chuva', sandstorm:'🌪 Areia', hail:'❄ Granizo', harsh_sun:'☀☀ Sol intenso', heavy_rain:'🌧🌧 Chuva intensa' }[weather] || weather;
    bpFieldBadges.appendChild(bpBadge(wLabel + (weatherTurns > 0 ? ` (${weatherTurns})` : ''), `weather-${weather.replace('_','-').split('-')[0]}`));
  }
  if (terrain !== 'none') {
    const tLabel = { electric:'⚡ Elétrico', psychic:'🔮 Psíquico', grassy:'🌿 Gramado', misty:'🌫 Névoa' }[terrain] || terrain;
    bpFieldBadges.appendChild(bpBadge(tLabel + (terrainTurns > 0 ? ` (${terrainTurns})` : ''), `terrain-${terrain}`));
  }
  if (trickRoom) bpFieldBadges.appendChild(bpBadge(`🕐 Trick Room (${trickRoomTurns})`, 'trick-room'));
  if (tw0 > 0) bpFieldBadges.appendChild(bpBadge(`💨 Tailwind ×2 (${tw0})`, 'tailwind'));
  if (tw1 > 0) bpFieldBadges.appendChild(bpBadge(`💨 TW inimigo (${tw1})`, 'tailwind'));

  // Enemy team (index 1)
  bpRenderActiveSlots(bpEnemyActive, state.teams[1]?.active || []);
  bpRenderBench(bpEnemyBench, state.teams[1]?.bench || []);

  // Player team (index 0)
  bpRenderActiveSlots(bpPlayerActive, state.teams[0]?.active || []);
  bpRenderBench(bpPlayerBench, state.teams[0]?.bench || []);

  // Battle log
  if (state.log && state.log.length > 0) {
    bpBattleLog.innerHTML = '';
    state.log.forEach((line) => {
      const div = document.createElement('div');
      div.className = 'bp-log-line' + (/desmaiou|vitória|derrot/i.test(line) ? ' emphasis' : '');
      div.textContent = line;
      bpBattleLog.appendChild(div);
    });
    bpBattleLog.scrollTop = bpBattleLog.scrollHeight;
  }

  // Action panel
  bp.chosen = [null, null];
  bpRenderActionPanel(state);
}

function bpBadge(label, cssClass) {
  const span = document.createElement('span');
  span.className = `bp-field-badge ${cssClass}`;
  span.textContent = label;
  return span;
}

function bpRenderActiveSlots(container, active) {
  container.innerHTML = '';
  active.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'bp-arena-poke-card' + (!p || p.fainted ? ' fainted' : '');

    if (!p) {
      card.innerHTML = '<div class="bp-arena-poke-name" style="color:#aaa">(vazio)</div>';
      container.appendChild(card);
      return;
    }

    const pct = p.maxHp > 0 ? (p.hp / p.maxHp) : 0;
    const colorClass = pct > 0.5 ? 'green' : pct > 0.2 ? 'yellow' : 'red';

    const nm = document.createElement('div');
    nm.className = 'bp-arena-poke-name';
    nm.textContent = p.name;
    card.appendChild(nm);

    const hpText = document.createElement('div');
    hpText.className = 'bp-arena-hp-text';
    hpText.textContent = p.fainted ? 'KO' : `${p.hp}/${p.maxHp}`;
    card.appendChild(hpText);

    const track = document.createElement('div');
    track.className = 'bp-hp-bar-track';
    const fill = document.createElement('div');
    fill.className = `bp-hp-bar-fill ${colorClass}`;
    fill.style.width = `${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%`;
    track.appendChild(fill);
    card.appendChild(track);

    if (p.status && p.status !== 'healthy') {
      const sb = document.createElement('span');
      sb.className = 'bp-arena-status-badge';
      const abbr = { burned:'BRN', paralyzed:'PAR', poisoned:'PSN', badly_poisoned:'TOX', frozen:'FRZ', asleep:'SLP' };
      sb.textContent = abbr[p.status] || p.status.slice(0,3).toUpperCase();
      card.appendChild(sb);
    }

    container.appendChild(card);
  });
}

function bpRenderBench(container, bench) {
  container.innerHTML = '';
  bench.forEach((p) => {
    const pill = document.createElement('span');
    pill.className = 'bp-bench-pill' + (p.fainted ? ' fainted' : '');
    const pct = p.maxHp > 0 ? Math.round(p.hp / p.maxHp * 100) : 0;
    pill.textContent = `${p.name} ${p.fainted ? 'KO' : pct + '%'}`;
    container.appendChild(pill);
  });
}

// ── Action panel ──────────────────────────────────────────────────────────────

function bpRenderActionPanel(state) {
  bpActionPanel.innerHTML = '';

  if (state.type === 'battle_end') {
    bpShowEndBanner(state);
    return;
  }

  if (state.type === 'requires_switch') {
    bpRenderSwitchPanel(state);
    return;
  }

  // Normal turn: one section per active slot
  const pending = state.pendingActions || [];
  pending.forEach((slotInfo, idx) => {
    if (!slotInfo) return;

    const section = document.createElement('div');

    const lbl = document.createElement('div');
    lbl.className = 'bp-action-slot-label' + (bp.chosen[idx] ? ' done' : '');
    lbl.id = `bp-slot-lbl-${idx}`;
    lbl.textContent = `${slotInfo.actorName} — escolha uma ação:`;
    if (bp.chosen[idx]) lbl.textContent += ' ✓';
    section.appendChild(lbl);

    // Move buttons
    const grid = document.createElement('div');
    grid.className = 'bp-move-btns';
    slotInfo.moves.forEach((mv) => {
      const btn = document.createElement('button');
      btn.className = 'bp-arena-move-btn' + (bpActionChosen(idx, mv) ? ' selected' : '');
      btn.type = 'button';
      const typePip = `[${mv.type}]`;
      const pwrPip = mv.power > 0 ? ` ${mv.power}` : '';
      btn.innerHTML = `<strong>${mv.name}</strong><br><small>${typePip}${pwrPip} ${mv.category}</small>`;
      btn.addEventListener('click', () => bpChooseMove(idx, slotInfo, mv));
      grid.appendChild(btn);
    });
    section.appendChild(grid);

    // Switch options
    if (slotInfo.switches.length > 0) {
      const swRow = document.createElement('div');
      swRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
      slotInfo.switches.forEach((sw) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bp-arena-switch-btn' + (bpSwitchChosen(idx, sw) ? ' selected' : '');
        const pct = sw.maxHp > 0 ? Math.round(sw.hp / sw.maxHp * 100) : 0;
        btn.textContent = `↔ ${sw.name} (${pct}%)`;
        btn.addEventListener('click', () => bpChooseSwitch(idx, slotInfo, sw));
        swRow.appendChild(btn);
      });
      section.appendChild(swRow);
    }

    if (idx < pending.length - 1) {
      const div = document.createElement('div');
      div.className = 'bp-action-divider';
      section.appendChild(div);
    }

    bpActionPanel.appendChild(section);
  });

  // Execute button (shown when both active slots have chosen)
  const activeCount = (state.pendingActions || []).length;
  const chosenCount = bp.chosen.slice(0, activeCount).filter(Boolean).length;
  if (activeCount > 0 && chosenCount === activeCount) {
    const execBtn = document.createElement('button');
    execBtn.className = 'bp-execute-btn';
    execBtn.type = 'button';
    execBtn.textContent = '▶ Executar Turno';
    execBtn.addEventListener('click', bpExecuteTurn);
    bpActionPanel.appendChild(execBtn);
  }
}

function bpActionChosen(slotIdx, mv) {
  const c = bp.chosen[slotIdx];
  return c && c.kind === 'move' && c.moveId === mv.moveId;
}

function bpSwitchChosen(slotIdx, sw) {
  const c = bp.chosen[slotIdx];
  return c && c.kind === 'switch' && c.partyIdx === sw.partyIdx;
}

function bpChooseMove(slotIdx, slotInfo, mv) {
  const targetUid = mv.isSpread || mv.isSelf
    ? (bp.battleState?.teams[0]?.active[slotIdx]?.uid || slotInfo.actorUid)
    : (mv.defaultTargetUid || slotInfo.actorUid);
  bp.chosen[slotIdx] = { kind: 'move', actorUid: slotInfo.actorUid, moveId: mv.moveId, targetUid };
  bpRenderActionPanel(bp.battleState);
}

function bpChooseSwitch(slotIdx, slotInfo, sw) {
  const userTeam = bp.battleState?.teams[0];
  const teamIdx = 0;
  bp.chosen[slotIdx] = {
    kind: 'switch', teamIdx, activeSlot: slotInfo.slot, partyIdx: sw.partyIdx,
  };
  bpRenderActionPanel(bp.battleState);
}

async function bpExecuteTurn() {
  const actions = bp.chosen.filter(Boolean);
  if (actions.length === 0) return;

  try {
    const raw = await pokedexApi.ask(`__BATTLE_ACT_JSON__:${JSON.stringify({ actions })}`);
    const state = JSON.parse(raw);
    if (state.type === 'error') {
      bpBattleLog.textContent = `Erro: ${state.message}`;
      return;
    }
    bp.battleState = state;
    bp.chosen = [null, null];
    bpRenderArena(state);
  } catch (e) {
    bpBattleLog.textContent = `Erro: ${e.message}`;
  }
}

function bpRenderSwitchPanel(state) {
  bpActionPanel.innerHTML = '';

  // Find fainted slots
  const userTeam = state.teams[0];
  userTeam.active.forEach((p, slot) => {
    if (!p || !p.fainted) return;
    const bench = state.teams[0].bench.filter((b) => !b.fainted);
    if (bench.length === 0) return;

    const lbl = document.createElement('div');
    lbl.className = 'bp-switch-required-label';
    lbl.textContent = `${p.name} desmaiou! Escolha um substituto:`;
    bpActionPanel.appendChild(lbl);

    const opts = document.createElement('div');
    opts.className = 'bp-switch-options';
    bench.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bp-switch-option-btn';
      const pct = b.maxHp > 0 ? Math.round(b.hp / b.maxHp * 100) : 0;
      btn.textContent = `${b.name} ${pct}%`;
      btn.addEventListener('click', () => bpDoForcedSwitch(0, slot, b.uid, state));
      opts.appendChild(btn);
    });
    bpActionPanel.appendChild(opts);
  });
}

async function bpDoForcedSwitch(teamIdx, activeSlot, benchUid, state) {
  const team = state.teams[teamIdx];
  const benchEntry = (team.bench || []).find((b) => b && b.uid === benchUid);
  if (!benchEntry) return;
  const partyIdx = benchEntry.partyIdx;

  try {
    const raw = await pokedexApi.ask(`__BATTLE_SWITCH_JSON__:${JSON.stringify({ teamIdx, activeSlot, partyIdx })}`);
    const newState = JSON.parse(raw);
    if (newState.type === 'error') { bpBattleLog.textContent = `Erro: ${newState.message}`; return; }
    bp.battleState = newState;
    bp.chosen = [null, null];
    bpRenderArena(newState);
  } catch (e) { bpBattleLog.textContent = `Erro: ${e.message}`; }
}

function bpShowEndBanner(state) {
  bpActionPanel.innerHTML = '';
  const won = state.winner === 0;
  const banner = document.createElement('div');
  banner.className = `bp-end-banner ${won ? 'win' : 'lose'}`;
  banner.innerHTML = `<div class="bp-end-banner-title">${won ? '🏆 Vitória!' : '💀 Derrota!'}</div>
    <div class="bp-end-banner-sub">Turno ${state.turn} — pressione "Desistir" para voltar ao builder.</div>`;
  bpActionPanel.appendChild(banner);
}

// ── Event listeners ──────────────────────────────────────────────────────────

document.getElementById('battle-panel-open').addEventListener('click', openBattlePanel);
document.getElementById('bp-close').addEventListener('click', closeBattlePanel);
document.getElementById('bp-start-btn').addEventListener('click', bpStartBattle);
document.getElementById('bp-forfeit-btn').addEventListener('click', () => {
  bpShowView('builder');
  bpStartBtn.disabled = false;
  bpValidationMsg.textContent = '';
  bpCheckStart();
});

