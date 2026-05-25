'use strict';

// Converted from move_tactical_catalog.pl (now in legacy_pl/).
// Seeds: direct move → seed-role assignments.
// Expands: role hierarchy (seed-role → expanded roles, always includes self).

/** @type {Record<string, string[]>} */
const seeds = {
  // pivot
  u_turn: ['pivot'],
  volt_switch: ['pivot'],
  flip_turn: ['pivot'],
  parting_shot: ['pivot'],
  teleport: ['pivot'],
  baton_pass: ['pivot'],
  shed_tail: ['pivot'],

  // protection
  protect: ['protection'],
  detect: ['protection'],
  kings_shield: ['protection'],
  spiky_shield: ['protection'],
  baneful_bunker: ['protection'],
  obstruct: ['protection'],
  silk_trap: ['protection'],
  burning_bulwark: ['protection'],
  wide_guard: ['protection'],
  quick_guard: ['protection'],
  crafty_shield: ['protection'],
  mat_block: ['protection'],

  // redirection
  follow_me: ['redirection'],
  rage_powder: ['redirection'],

  // fake_out
  fake_out: ['fake_out'],

  // speed_control
  tailwind: ['speed_control'],
  icy_wind: ['speed_control'],
  electroweb: ['speed_control'],
  thunder_wave: ['speed_control'],
  bulldoze: ['speed_control'],
  scary_face: ['speed_control'],

  // trick_room
  trick_room: ['trick_room'],

  // ally_boost
  helping_hand: ['ally_boost'],
  coaching: ['ally_boost'],
  howl: ['ally_boost'],

  // screen_control
  reflect: ['screen_control'],
  light_screen: ['screen_control'],
  aurora_veil: ['screen_control'],

  // hazard
  stealth_rock: ['hazard'],
  spikes: ['hazard'],
  toxic_spikes: ['hazard'],
  sticky_web: ['hazard'],
  stone_axe: ['hazard'],
  ceaseless_edge: ['hazard'],

  // hazard_clear
  defog: ['hazard_clear'],
  rapid_spin: ['hazard_clear'],
  mortal_spin: ['hazard_clear'],
  tidy_up: ['hazard_clear'],
  court_change: ['hazard_clear'],

  // terrain_control
  electric_terrain: ['terrain_control'],
  psychic_terrain: ['terrain_control'],
  grassy_terrain: ['terrain_control'],
  misty_terrain: ['terrain_control'],

  // weather_control
  rain_dance: ['weather_control'],
  sunny_day: ['weather_control'],
  sandstorm: ['weather_control'],
  hail: ['weather_control'],
  snowscape: ['weather_control'],

  // setup_buff
  swords_dance: ['setup_buff'],
  dragon_dance: ['setup_buff'],
  nasty_plot: ['setup_buff'],
  quiver_dance: ['setup_buff'],
  calm_mind: ['setup_buff'],
  bulk_up: ['setup_buff'],
  shell_smash: ['setup_buff'],
  agility: ['setup_buff'],
  coil: ['setup_buff'],
  work_up: ['setup_buff'],
  belly_drum: ['setup_buff'],

  // disruption
  taunt: ['disruption'],
  snarl: ['disruption'],
  will_o_wisp: ['disruption'],
  encore: ['disruption'],
  disable: ['disruption'],
  yawn: ['disruption'],
  roar: ['disruption'],
  dragon_tail: ['disruption'],

  // self_drop_pressure
  close_combat: ['self_drop_pressure'],
  superpower: ['self_drop_pressure'],
  draco_meteor: ['self_drop_pressure'],
  leaf_storm: ['self_drop_pressure'],
  overheat: ['self_drop_pressure'],
  make_it_rain: ['self_drop_pressure'],
  v_create: ['self_drop_pressure'],

  // recovery
  roost: ['recovery'],
  recover: ['recovery'],
  slack_off: ['recovery'],
  soft_boiled: ['recovery'],
  synthesis: ['recovery'],
  morning_sun: ['recovery'],
  moonlight: ['recovery'],
  wish: ['recovery'],
  rest: ['recovery'],
  shore_up: ['recovery'],
  heal_order: ['recovery'],
  milk_drink: ['recovery'],
  leech_seed: ['recovery'],
};

// Each entry means: seed-role expands to all listed roles (plus itself, always).
/** @type {Record<string, string[]>} */
const expands = {
  setup_buff:      ['buff'],
  ally_boost:      ['buff'],
  screen_control:  ['buff', 'control'],
  disruption:      ['debuff', 'control'],
  speed_control:   ['debuff', 'control'],
  status_spread:   ['debuff'],
  trick_room:      ['control'],
  protection:      ['control'],
  redirection:     ['control'],
  fake_out:        ['control'],
  hazard:          ['control'],
  hazard_clear:    ['control'],
  terrain_control: ['control'],
  weather_control: ['control'],
  pivot:           ['control'],
};

module.exports = { seeds, expands };
