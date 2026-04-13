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
const modalHeight = document.getElementById('modal-height');
const modalWeight = document.getElementById('modal-weight');
const modalTypes = document.getElementById('modal-types');
const modalAbilities = document.getElementById('modal-abilities');
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

function renderBotMessageWithLinks(container, text) {
  if (!pokemonLinkRegex) {
    container.textContent = text;
    return;
  }

  container.innerHTML = '';
  pokemonLinkRegex.lastIndex = 0;

  let lastIndex = 0;
  let foundAtLeastOne = false;
  let match;

  while ((match = pokemonLinkRegex.exec(text)) !== null) {
    const matchText = match[0];
    const start = match.index;
    const end = start + matchText.length;

    if (!hasWordBoundaries(text, start, end)) {
      continue;
    }

    const key = normalizeAliasText(matchText);
    const identifier = pokemonAliasToIdentifier.get(key);
    if (!identifier) {
      continue;
    }

    appendTextNode(container, text.slice(lastIndex, start));

    const linkButton = document.createElement('button');
    linkButton.type = 'button';
    linkButton.className = 'chat-pokemon-link';
    linkButton.textContent = matchText;
    linkButton.addEventListener('click', () => {
      openPokemonModal(identifier);
    });

    container.appendChild(linkButton);
    lastIndex = end;
    foundAtLeastOne = true;
  }

  appendTextNode(container, text.slice(lastIndex));

  if (!foundAtLeastOne) {
    container.textContent = text;
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

function mapSpritesByKey(sprites) {
  spriteMap = new Map();
  for (const sprite of sprites || []) {
    const key = normalizeText(sprite.id).replace(/[\s-]+/g, '_');
    spriteMap.set(key, sprite.url);
  }
}

function findSpriteUrl(detail) {
  const candidates = [detail.identifier, detail.display_name, String(detail.id)];

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate).replace(/[\s-]+/g, '_');
    if (spriteMap.has(normalized)) {
      return spriteMap.get(normalized);
    }
  }

  return null;
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
    modalAbilities.textContent = (detail.abilities || []).join(', ');
    modalDescription.textContent = detail.description || 'Sem descrição disponível.';
    modalLore.textContent = detail.lore || 'Sem lore disponível.';

    const spriteUrl = findSpriteUrl(detail) || placeholderSprite;
    modalSprite.src = spriteUrl;
    modalSprite.alt = `Sprite de ${detail.display_name}`;

    renderStatBars(detail);
    renderRelationBadges(modalWeaknesses, detail.type_relations?.weaknesses || []);
    renderRelationBadges(modalResistances, detail.type_relations?.resistances || []);
    renderRelationBadges(modalImmunities, detail.type_relations?.immunities || []);
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
  appendMessage('bot', 'Conectando ao motor Prolog...');

  try {
    await window.pokedexApi.ping();

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

modalBackdrop.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);
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
