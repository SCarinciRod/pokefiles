/**
 * battle_abilities.ts
 *
 * Registry of VGC-relevant ability and item effects implemented as hooks.
 * Each entry defines handlers for specific battle events.
 *
 * Item effects for type-boosting, type-resist berries, and choice items are
 * also handled here via the ITEM_REGISTRY.
 */

import { AbilityHandlers, AbilityContext, ItemHandlers, ItemContext, BattlePokemon, BattleState } from './battle_types';

// ---------------------------------------------------------------------------
// Helpers used by multiple handlers
// ---------------------------------------------------------------------------

function activeOpponents(ctx: AbilityContext): BattlePokemon[] {
  return ctx.opponents.filter((p) => !p.fainted);
}

function setWeather(state: BattleState, weather: BattleState['field']['weather'], turns: number, log: (m: string) => void): void {
  if (state.field.weather === weather) return;
  state.field.weather = weather;
  state.field.weatherTurns = turns;
  const LABELS: Record<string, string> = {
    sun: 'O sol ficou intenso!', rain: 'Começou a chover!',
    sandstorm: 'Uma tempestade de areia se formou!', hail: 'Começou a nevar!',
    harsh_sun: 'O sol ficou extremamente intenso!', heavy_rain: 'Uma chuva torrencial começou!',
  };
  log(LABELS[weather] ?? 'O clima mudou!');
}

function setTerrain(state: BattleState, terrain: BattleState['field']['terrain'], turns: number, log: (m: string) => void): void {
  if (state.field.terrain === terrain) return;
  state.field.terrain = terrain;
  state.field.terrainTurns = turns;
  const LABELS: Record<string, string> = {
    electric: 'Um campo elétrico se formou!', psychic: 'Um campo psíquico se formou!',
    grassy: 'Um campo gramado se formou!', misty: 'Um campo de névoa se formou!',
  };
  log(LABELS[terrain] ?? 'O campo mudou!');
}

function applyStatDrop(target: BattlePokemon, stat: keyof BattlePokemon['boosts'], stages: number, ctx: AbilityContext): void {
  if (target.currentAbility === 'clear_body' || target.currentAbility === 'white_smoke') {
    ctx.log(`${target.identifier} não foi afetado por Clear Body!`);
    return;
  }
  if (target.config.item === 'clear_amulet' && !target.itemConsumed) {
    ctx.log(`${target.identifier} não foi afetado por Clear Amulet!`);
    return;
  }
  const prev = target.boosts[stat];
  target.boosts[stat] = Math.max(-6, prev + stages);
  const delta = target.boosts[stat] - prev;
  if (delta !== 0) ctx.log(`${target.identifier}: ${stat} ${delta > 0 ? '+' : ''}${delta}!`);
  // Competitive / Defiant: +2 to special attack or attack when a stat is dropped by opponent
  if (delta < 0) {
    if (target.currentAbility === 'competitive') target.boosts.special_attack = Math.min(6, target.boosts.special_attack + 2);
    if (target.currentAbility === 'defiant') target.boosts.attack = Math.min(6, target.boosts.attack + 2);
  }
}

function displayName(id: string): string {
  return id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// Ability Registry
// ---------------------------------------------------------------------------

export const ABILITY_REGISTRY: Partial<Record<string, AbilityHandlers>> = {

  // ── Weather setters ──────────────────────────────────────────────────────

  drought: {
    on_switch_in: (ctx) => setWeather(ctx.state, 'sun', 5, ctx.log),
  },
  drizzle: {
    on_switch_in: (ctx) => setWeather(ctx.state, 'rain', 5, ctx.log),
  },
  sand_stream: {
    on_switch_in: (ctx) => setWeather(ctx.state, 'sandstorm', 5, ctx.log),
  },
  snow_warning: {
    on_switch_in: (ctx) => setWeather(ctx.state, 'hail', 5, ctx.log),
  },
  desolate_land: {
    on_switch_in: (ctx) => setWeather(ctx.state, 'harsh_sun', 0, ctx.log), // 0 = infinite until form leaves
  },
  primordial_sea: {
    on_switch_in: (ctx) => setWeather(ctx.state, 'heavy_rain', 0, ctx.log),
  },
  cloud_nine: {
    on_switch_in: (ctx) => ctx.log(`${displayName(ctx.self.identifier)} suprimiu o efeito do clima!`),
    on_damage_calc: (ctx) => { ctx.damageMult *= 1; /* suppress weather bonuses */ },
  },
  air_lock: {
    on_switch_in: (ctx) => ctx.log(`${displayName(ctx.self.identifier)} suprimiu o efeito do clima!`),
  },

  // ── Terrain setters ──────────────────────────────────────────────────────

  electric_surge: {
    on_switch_in: (ctx) => setTerrain(ctx.state, 'electric', 5, ctx.log),
  },
  psychic_surge: {
    on_switch_in: (ctx) => setTerrain(ctx.state, 'psychic', 5, ctx.log),
  },
  grassy_surge: {
    on_switch_in: (ctx) => setTerrain(ctx.state, 'grassy', 5, ctx.log),
  },
  misty_surge: {
    on_switch_in: (ctx) => setTerrain(ctx.state, 'misty', 5, ctx.log),
  },

  // ── Speed modifiers (on_damage_calc adjusts speedMult) ──────────────────

  swift_swim: {
    on_damage_calc: (ctx) => {
      if (ctx.state.field.weather === 'rain' || ctx.state.field.weather === 'heavy_rain') ctx.speedMult *= 2;
    },
  },
  chlorophyll: {
    on_damage_calc: (ctx) => {
      if (ctx.state.field.weather === 'sun' || ctx.state.field.weather === 'harsh_sun') ctx.speedMult *= 2;
    },
  },
  sand_rush: {
    on_damage_calc: (ctx) => {
      if (ctx.state.field.weather === 'sandstorm') ctx.speedMult *= 2;
    },
  },
  slush_rush: {
    on_damage_calc: (ctx) => {
      if (ctx.state.field.weather === 'hail') ctx.speedMult *= 2;
    },
  },
  surge_surfer: {
    on_damage_calc: (ctx) => {
      if (ctx.state.field.terrain === 'electric') ctx.speedMult *= 2;
    },
  },
  grass_pelt: {
    on_damage_calc: (ctx) => {
      if (ctx.state.field.terrain === 'grassy') ctx.speedMult *= 1.5;
    },
  },
  speed_boost: {
    on_turn_end: (ctx) => {
      ctx.self.boosts.speed = Math.min(6, ctx.self.boosts.speed + 1);
      ctx.log(`${displayName(ctx.self.identifier)} ficou mais rápido! (Speed Boost)`);
    },
  },
  unburden: {
    on_damage_calc: (ctx) => {
      if (ctx.self.itemConsumed && ctx.self.config.item !== null) ctx.speedMult *= 2;
    },
  },

  // ── Damage output modifiers ──────────────────────────────────────────────

  solar_power: {
    on_damage_calc: (ctx) => {
      if (ctx.state.field.weather === 'sun' || ctx.state.field.weather === 'harsh_sun') ctx.damageMult *= 1.5;
    },
    on_turn_end: (ctx) => {
      if (ctx.state.field.weather === 'sun' || ctx.state.field.weather === 'harsh_sun') {
        const dmg = Math.max(1, Math.floor(ctx.self.maxHp / 8));
        ctx.self.currentHp = Math.max(0, ctx.self.currentHp - dmg);
        ctx.log(`${displayName(ctx.self.identifier)} sofreu dano do Solar Power!`);
      }
    },
  },
  sheer_force: {
    on_damage_calc: (ctx) => { ctx.damageMult *= 1.3; }, // simplified: always 1.3x (normally only for moves with secondary effects)
  },
  adaptability: {
    on_damage_calc: (ctx) => {
      // STAB becomes ×2 instead of ×1.5; handled in sim by checking this ability
    },
  },
  technician: {
    // Applied in battle_sim.ts when move base power <= 60
  },
  huge_power: {
    on_damage_calc: (ctx) => { ctx.damageMult *= 2; }, // ×2 Attack (applied in stat calc)
  },
  pure_power: {
    on_damage_calc: (ctx) => { ctx.damageMult *= 2; },
  },
  tinted_lens: {
    // Applied in battle_sim.ts when computing type mult: NVE becomes neutral
  },
  neuroforce: {
    on_damage_calc: (ctx) => {
      // ×1.25 if move is super-effective — handled in battle_sim
    },
  },

  // ── Defensive ────────────────────────────────────────────────────────────

  multiscale: {
    on_damage_calc: (ctx) => {
      if (ctx.self.currentHp === ctx.self.maxHp) ctx.defenseMult *= 0.5;
    },
  },
  shadow_shield: {
    on_damage_calc: (ctx) => {
      if (ctx.self.currentHp === ctx.self.maxHp) ctx.defenseMult *= 0.5;
    },
  },
  filter: {
    on_damage_calc: (ctx) => { ctx.defenseMult *= 0.75; }, // only triggers on SE — checked in sim
  },
  solid_rock: {
    on_damage_calc: (ctx) => { ctx.defenseMult *= 0.75; },
  },
  prism_armor: {
    on_damage_calc: (ctx) => { ctx.defenseMult *= 0.75; },
  },
  thick_fat: {
    on_damage_calc: (ctx) => {
      if (ctx.self.config.item !== 'utility_umbrella') {
        // fire and ice dealt at 0.5x — checked in sim against move type
      }
    },
  },
  fluffy: {
    on_damage_calc: (ctx) => { /* halves physical, doubles fire — handled in sim */ },
  },
  fur_coat: {
    on_damage_calc: (ctx) => {
      // halves physical damage — handled in sim
    },
  },
  ice_scales: {
    on_damage_calc: (ctx) => {
      // halves special damage — handled in sim
    },
  },

  // ── Entry hazard immunity ─────────────────────────────────────────────────

  levitate: {},

  // ── Status-related ───────────────────────────────────────────────────────

  natural_cure: {
    // cures status on switch-out — handled in switch logic in sim
  },
  magic_guard: {
    // no residual damage — handled in end-of-turn in sim
  },
  poison_heal: {
    on_turn_end: (ctx) => {
      if (ctx.self.status === 'poisoned' || ctx.self.status === 'badly_poisoned') {
        const heal = Math.max(1, Math.floor(ctx.self.maxHp / 8));
        ctx.self.currentHp = Math.min(ctx.self.maxHp, ctx.self.currentHp + heal);
        ctx.log(`${displayName(ctx.self.identifier)} se recuperou pelo veneno! (Poison Heal)`);
      }
    },
  },
  guts: {
    on_damage_calc: (ctx) => {
      if (ctx.self.status !== 'healthy') ctx.damageMult *= 1.5;
    },
  },

  // ── Intimidate + stat-interaction ────────────────────────────────────────

  intimidate: {
    on_switch_in: (ctx) => {
      for (const opp of activeOpponents(ctx)) {
        if (opp.currentAbility === 'inner_focus' || opp.currentAbility === 'own_tempo' ||
            opp.currentAbility === 'oblivious' || opp.currentAbility === 'scrappy') {
          ctx.log(`${displayName(opp.identifier)} não foi intimidado!`);
          continue;
        }
        if (opp.currentAbility === 'rattled') {
          opp.boosts.speed = Math.min(6, opp.boosts.speed + 1);
          ctx.log(`${displayName(opp.identifier)} ficou assustado e ficou mais rápido!`);
        }
        applyStatDrop(opp, 'attack', -1, ctx);
      }
    },
  },
  inner_focus: {},  // immune to flinch — handled in sim
  own_tempo: {},    // immune to confusion/intimidate — handled above
  scrappy: {},      // can hit Ghost with Normal/Fighting — handled in type calc

  // ── Redirection ──────────────────────────────────────────────────────────

  lightning_rod: {
    // redirects Electric moves to self, +1 SpA — handled in target resolution in sim
  },
  storm_drain: {
    // redirects Water moves to self, +1 SpA
  },

  // ── Copying / changing type ───────────────────────────────────────────────

  protean: {
    on_move_use: (ctx) => {
      // change type to move's type — handled in battle_sim when executing move
    },
  },
  libero: {
    on_move_use: (ctx) => {
      // same as protean
    },
  },

  // ── Regenerator ──────────────────────────────────────────────────────────

  regenerator: {
    // heals 1/3 HP on switch-out — handled in switch logic in sim
  },

  // ── Parental Bond ────────────────────────────────────────────────────────

  parental_bond: {
    // double-strike second at 0.25x — handled in move execution in sim
  },

  // ── Prankster ────────────────────────────────────────────────────────────

  prankster: {
    // status moves get +1 priority — handled in action sorting in sim
  },

  // ── Sturdy ───────────────────────────────────────────────────────────────

  sturdy: {
    on_hit_by_move: (ctx) => {
      // if HP was full before hit and damage would KO, survive at 1 HP
      // Logic handled in battle_sim.ts applyDamage
    },
  },

  // ── Tough Claws / Strong Jaw (damage boosts for specific move categories) ─

  tough_claws: {
    on_damage_calc: (ctx) => {
      // ×1.3 for contact moves — handled in sim
    },
  },
  strong_jaw: {
    on_damage_calc: (ctx) => {
      // ×1.5 for biting moves — handled in sim
    },
  },

  // ── Mega Launcher ─────────────────────────────────────────────────────────

  mega_launcher: {
    on_damage_calc: (ctx) => {
      // ×1.5 for pulse/aura moves — handled in sim
    },
  },

  // ── Weather damage immunity ───────────────────────────────────────────────

  sand_veil: {},
  ice_body: {
    on_turn_end: (ctx) => {
      if (ctx.state.field.weather === 'hail') {
        const heal = Math.max(1, Math.floor(ctx.self.maxHp / 16));
        ctx.self.currentHp = Math.min(ctx.self.maxHp, ctx.self.currentHp + heal);
        ctx.log(`${displayName(ctx.self.identifier)} recuperou HP com Ice Body!`);
      }
    },
  },
  rain_dish: {
    on_turn_end: (ctx) => {
      if (ctx.state.field.weather === 'rain' || ctx.state.field.weather === 'heavy_rain') {
        const heal = Math.max(1, Math.floor(ctx.self.maxHp / 16));
        ctx.self.currentHp = Math.min(ctx.self.maxHp, ctx.self.currentHp + heal);
        ctx.log(`${displayName(ctx.self.identifier)} recuperou HP com Rain Dish!`);
      }
    },
  },
  dry_skin: {
    on_turn_end: (ctx) => {
      if (ctx.state.field.weather === 'rain' || ctx.state.field.weather === 'heavy_rain') {
        const heal = Math.max(1, Math.floor(ctx.self.maxHp / 8));
        ctx.self.currentHp = Math.min(ctx.self.maxHp, ctx.self.currentHp + heal);
      } else if (ctx.state.field.weather === 'sun' || ctx.state.field.weather === 'harsh_sun') {
        const dmg = Math.max(1, Math.floor(ctx.self.maxHp / 8));
        ctx.self.currentHp = Math.max(0, ctx.self.currentHp - dmg);
        ctx.log(`${displayName(ctx.self.identifier)} sofreu dano do sol com Dry Skin!`);
      }
    },
  },
  overcoat: {},   // immune to weather damage, powder — handled in sim
  magic_bounce: {}, // reflects status moves — handled in sim (complex)

  // ── Competitive / Defiant ────────────────────────────────────────────────

  competitive: {},  // handled in applyStatDrop helper above
  defiant: {},

  // ── Queenly Majesty / Dazzling / Armor Tail ───────────────────────────────

  queenly_majesty: {},  // blocks priority moves targeting this Pokémon's side
  dazzling: {},
  armor_tail: {},

  // ── Harvest (berry recycling) ─────────────────────────────────────────────

  harvest: {
    on_turn_end: (ctx) => {
      if (ctx.self.itemConsumed && ctx.self.config.item?.endsWith('_berry')) {
        if (Math.random() < 0.5) {
          ctx.self.itemConsumed = false;
          ctx.log(`${displayName(ctx.self.identifier)} encontrou a ${ctx.self.config.item} de volta!`);
        }
      }
    },
  },

  // ── Power Construct (Zygarde 50%→Complete) ────────────────────────────────

  power_construct: {
    on_turn_end: (ctx) => {
      // Transform to Complete form when HP ≤ 50% — handled in sim via identifier swap
    },
  },
};

// ---------------------------------------------------------------------------
// Type-boosting item map (item_id → type_id, multiplier 1.2)
// ---------------------------------------------------------------------------

export const ITEM_TYPE_BOOST: Record<string, string> = {
  charcoal:         'fire',
  mystic_water:     'water',
  magnet:           'electric',
  miracle_seed:     'grass',
  'never-melt_ice': 'ice',
  black_belt:       'fighting',
  poison_barb:      'poison',
  soft_sand:        'ground',
  sharp_beak:       'flying',
  twisted_spoon:    'psychic',
  silver_powder:    'bug',
  hard_stone:       'rock',
  spell_tag:        'ghost',
  dragon_fang:      'dragon',
  black_glasses:    'dark',
  metal_coat:       'steel',
  silk_scarf:       'normal',
  fairy_feather:    'fairy',
  // Plates also boost type (but Arceus changes type — for now just boost)
  flame_plate:      'fire',
  splash_plate:     'water',
  zap_plate:        'electric',
  meadow_plate:     'grass',
  icicle_plate:     'ice',
  fist_plate:       'fighting',
  toxic_plate:      'poison',
  earth_plate:      'ground',
  sky_plate:        'flying',
  mind_plate:       'psychic',
  insect_plate:     'bug',
  stone_plate:      'rock',
  spooky_plate:     'ghost',
  draco_plate:      'dragon',
  dread_plate:      'dark',
  iron_plate:       'steel',
  pixie_plate:      'fairy',
};

// ---------------------------------------------------------------------------
// Type-resist berry map (item_id → type_id that triggers 0.5× on hit)
// ---------------------------------------------------------------------------

export const TYPE_RESIST_BERRY: Record<string, string> = {
  occa_berry:   'fire',
  passho_berry: 'water',
  wacan_berry:  'electric',
  rindo_berry:  'grass',
  yache_berry:  'ice',
  chople_berry: 'fighting',
  kebia_berry:  'poison',
  shuca_berry:  'ground',
  coba_berry:   'flying',
  payapa_berry: 'psychic',
  tanga_berry:  'bug',
  charti_berry: 'rock',
  kasib_berry:  'ghost',
  haban_berry:  'dragon',
  colbur_berry: 'dark',
  babiri_berry: 'steel',
  chilan_berry: 'normal',
  roseli_berry: 'fairy',
};

// ---------------------------------------------------------------------------
// Spread move set (hits both opponents, 0.75× damage each)
// ---------------------------------------------------------------------------

export const SPREAD_MOVES = new Set<string>([
  'earthquake', 'discharge', 'heat_wave', 'muddy_water', 'icy_wind',
  'blizzard', 'rock_slide', 'dazzling_gleam', 'surf', 'lava_plume',
  'sludge_wave', 'eruption', 'water_spout', 'hyper_voice', 'boomburst',
  'bulldoze', 'magnitude', 'razor_leaf', 'petal_blizzard', 'electroweb',
  'powder_snow', 'swift', 'twister', 'dragon_breath', 'incinerate',
  'glaciate', 'snarl', 'breaking_swipe', 'noble_roar', 'shadow_ball',  // shadow ball normally single but some formats treat differently
  'burning_jealousy', 'scale_shot', 'spirit_shackle',
]);

// ---------------------------------------------------------------------------
// Self-targeting / ally-targeting moves (not damage moves)
// ---------------------------------------------------------------------------

export const SELF_TARGET_MOVES = new Set<string>([
  'tailwind', 'trick_room', 'follow_me', 'rage_powder', 'helping_hand',
  'protect', 'detect', 'wide_guard', 'quick_guard', 'crafty_shield',
  'endure', 'substitute', 'bulk_up', 'nasty_plot', 'swords_dance',
  'calm_mind', 'quiver_dance', 'dragon_dance', 'shell_smash', 'shift_gear',
  'coil', 'iron_defense', 'amnesia', 'agility', 'autotomize', 'hone_claws',
]);

// Status move handlers: what does the move DO?
export type StatusMoveEffect =
  | { kind: 'tailwind' }
  | { kind: 'trick_room' }
  | { kind: 'follow_me' }
  | { kind: 'rage_powder' }
  | { kind: 'helping_hand' }
  | { kind: 'protect'; variant: 'single' | 'wide' | 'quick' }
  | { kind: 'stat_boost'; stat: keyof BattlePokemon['boosts']; stages: number }
  | { kind: 'taunt' }
  | { kind: 'unknown' };

export function getStatusMoveEffect(moveId: string): StatusMoveEffect {
  switch (moveId) {
    case 'tailwind': return { kind: 'tailwind' };
    case 'trick_room': return { kind: 'trick_room' };
    case 'follow_me': return { kind: 'follow_me' };
    case 'rage_powder': return { kind: 'rage_powder' };
    case 'helping_hand': return { kind: 'helping_hand' };
    case 'protect':
    case 'detect':
    case 'baneful_bunker':
    case 'spiky_shield': return { kind: 'protect', variant: 'single' };
    case 'wide_guard': return { kind: 'protect', variant: 'wide' };
    case 'quick_guard': return { kind: 'protect', variant: 'quick' };
    case 'swords_dance': return { kind: 'stat_boost', stat: 'attack', stages: 2 };
    case 'nasty_plot': return { kind: 'stat_boost', stat: 'special_attack', stages: 2 };
    case 'bulk_up': return { kind: 'stat_boost', stat: 'attack', stages: 1 };
    case 'calm_mind': return { kind: 'stat_boost', stat: 'special_attack', stages: 1 };
    case 'dragon_dance': return { kind: 'stat_boost', stat: 'attack', stages: 1 };
    case 'agility':
    case 'autotomize': return { kind: 'stat_boost', stat: 'speed', stages: 2 };
    case 'iron_defense': return { kind: 'stat_boost', stat: 'defense', stages: 2 };
    case 'amnesia': return { kind: 'stat_boost', stat: 'special_defense', stages: 2 };
    case 'taunt': return { kind: 'taunt' };
    default: return { kind: 'unknown' };
  }
}
