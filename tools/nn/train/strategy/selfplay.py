"""
selfplay.py — VGC doubles self-play training loop.

Runs N battles between two rule-based AI teams, records (team_a, team_b, winner),
derives pair-level win-rates, and exports updated synergy training data to
doubles_synergy_training.jsonl (to be used by train_strategy.py).

Usage:
    python selfplay.py [--n-battles 5000] [--db PATH] [--out-dir DIR] [--verbose]

The script uses a pure-Python battle simulator that mirrors the TypeScript
BattleSimulator logic (damage formula, type chart, basic status effects).
This is intentionally a faster/simpler version for bulk self-play — not a
complete reimplementation of every mechanic.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ── Path setup ──────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[4]  # tools/nn/train/strategy → repo root
DEFAULT_DB = REPO_ROOT / '.local_cache' / 'nn_export' / 'pokefiles_nn.sqlite3'
DEFAULT_OUT = REPO_ROOT / '.local_cache' / 'nn_export' / 'training'

# ── Constants ────────────────────────────────────────────────────────────────

LEVEL = 50
MAX_TURNS = 40  # safety cap to prevent infinite battles

# Non-fully-evolved Pokémon filter: loaded from DB (pokemon_is_nfe table or
# approximated by checking evolution chain — we use a simple BST threshold).
MIN_BST_FOR_FE = 400  # rough filter; fully-evolved typically ≥ 400 BST

# Items pool used when building random teams
RANDOM_ITEMS = [
    'life_orb', 'choice_scarf', 'choice_band', 'choice_specs',
    'assault_vest', 'leftovers', 'sitrus_berry',
    'rocky_helmet', 'focus_sash', None,
]

# Type boost items (type_id → multiplier)
ITEM_TYPE_BOOST = {
    'charcoal': ('fire', 1.2), 'mystic_water': ('water', 1.2),
    'magnet': ('electric', 1.2), 'miracle_seed': ('grass', 1.2),
    'never-melt_ice': ('ice', 1.2), 'black_belt': ('fighting', 1.2),
    'poison_barb': ('poison', 1.2), 'soft_sand': ('ground', 1.2),
    'sharp_beak': ('flying', 1.2), 'twisted_spoon': ('psychic', 1.2),
    'silver_powder': ('bug', 1.2), 'hard_stone': ('rock', 1.2),
    'spell_tag': ('ghost', 1.2), 'dragon_fang': ('dragon', 1.2),
    'black_glasses': ('dark', 1.2), 'metal_coat': ('steel', 1.2),
    'silk_scarf': ('normal', 1.2), 'fairy_feather': ('fairy', 1.2),
}

SPREAD_MOVES = {
    'earthquake', 'discharge', 'heat_wave', 'muddy_water', 'icy_wind',
    'blizzard', 'rock_slide', 'dazzling_gleam', 'surf', 'lava_plume',
    'sludge_wave', 'eruption', 'water_spout', 'hyper_voice', 'boomburst',
    'bulldoze', 'magnitude', 'razor_leaf', 'petal_blizzard', 'electroweb',
    'powder_snow', 'swift', 'twister', 'dragon_breath', 'incinerate',
    'glaciate', 'snarl', 'breaking_swipe', 'burning_jealousy',
}

WEATHER_BOOST = {
    ('sun', 'fire'): 1.5, ('sun', 'water'): 0.5,
    ('harsh_sun', 'fire'): 1.5, ('harsh_sun', 'water'): 0.0,
    ('rain', 'water'): 1.5, ('rain', 'fire'): 0.5,
    ('heavy_rain', 'water'): 1.5, ('heavy_rain', 'fire'): 0.0,
}

# ── Data loading ─────────────────────────────────────────────────────────────

def load_db(db_path: Path) -> dict[str, Any]:
    """Load all needed data from SQLite into memory."""
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row

        # Pokémon
        pokemon_rows = conn.execute(
            "SELECT p.identifier, p.source_generation, "
            "  ps_hp.value AS hp, ps_atk.value AS attack, ps_def.value AS defense, "
            "  ps_spa.value AS special_attack, ps_spd.value AS special_defense, ps_spe.value AS speed "
            "FROM pokemon p "
            "LEFT JOIN pokemon_stats ps_hp  ON ps_hp.pokemon_id  = p.id AND ps_hp.stat_id  = 'hp' "
            "LEFT JOIN pokemon_stats ps_atk ON ps_atk.pokemon_id = p.id AND ps_atk.stat_id = 'attack' "
            "LEFT JOIN pokemon_stats ps_def ON ps_def.pokemon_id = p.id AND ps_def.stat_id = 'defense' "
            "LEFT JOIN pokemon_stats ps_spa ON ps_spa.pokemon_id = p.id AND ps_spa.stat_id = 'special_attack' "
            "LEFT JOIN pokemon_stats ps_spd ON ps_spd.pokemon_id = p.id AND ps_spd.stat_id = 'special_defense' "
            "LEFT JOIN pokemon_stats ps_spe ON ps_spe.pokemon_id = p.id AND ps_spe.stat_id = 'speed' "
        ).fetchall()
        pokemon = {r['identifier']: dict(r) for r in pokemon_rows if r['hp'] is not None}

        # Types per Pokémon
        for row in conn.execute("SELECT p.identifier, GROUP_CONCAT(pt.type_id) AS types FROM pokemon p "
                                "JOIN pokemon_types pt ON pt.pokemon_id = p.id GROUP BY p.id"):
            if row['identifier'] in pokemon:
                pokemon[row['identifier']]['types'] = row['types'].split(',') if row['types'] else []

        # Abilities per Pokémon
        abilities_map: dict[str, list[str]] = defaultdict(list)
        for row in conn.execute("SELECT p.identifier, pa.ability_id FROM pokemon p "
                                "JOIN pokemon_abilities pa ON pa.pokemon_id = p.id ORDER BY pa.slot"):
            abilities_map[row['identifier']].append(row['ability_id'])

        # Moves per Pokémon (learnable)
        moves_by_pokemon: dict[str, list[str]] = defaultdict(list)
        for row in conn.execute("SELECT p.identifier, pm.move_id FROM pokemon p "
                                "JOIN pokemon_moves pm ON pm.pokemon_id = p.id"):
            moves_by_pokemon[row['identifier']].append(row['move_id'])

        # Move data
        moves: dict[str, dict] = {}
        for row in conn.execute("SELECT id, type_id, category, base_power, accuracy, pp FROM moves WHERE base_power > 0"):
            moves[row['id']] = dict(row)

        # Type chart
        type_chart: dict[str, dict[str, float]] = defaultdict(dict)
        for row in conn.execute("SELECT attack_type, defense_type, multiplier FROM type_chart"):
            type_chart[row[0]][row[1]] = row[2]

    return {
        'pokemon': pokemon,
        'abilities_map': dict(abilities_map),
        'moves_by_pokemon': dict(moves_by_pokemon),
        'moves': moves,
        'type_chart': dict(type_chart),
    }

# ── Stat calculation ──────────────────────────────────────────────────────────

def calc_stat(stat_id: str, base: int, level: int = LEVEL, iv: int = 31, ev: int = 0) -> int:
    shared = ((2 * base + iv + ev // 4) * level) // 100
    if stat_id == 'hp':
        return shared + level + 10
    return shared + 5  # neutral nature

def calc_stats(base_stats: dict) -> dict[str, int]:
    return {
        'hp': calc_stat('hp', base_stats.get('hp', 1)),
        'attack': calc_stat('atk', base_stats.get('attack', 1)),
        'defense': calc_stat('def', base_stats.get('defense', 1)),
        'special_attack': calc_stat('spa', base_stats.get('special_attack', 1)),
        'special_defense': calc_stat('spd', base_stats.get('special_defense', 1)),
        'speed': calc_stat('spe', base_stats.get('speed', 1)),
    }

# ── Type effectiveness ────────────────────────────────────────────────────────

def type_mult(chart: dict, atk_type: str, def_types: list[str]) -> float:
    by_atk = chart.get(atk_type, {})
    mult = 1.0
    for dt in def_types:
        mult *= by_atk.get(dt, 1.0)
    return mult

# ── Damage calculation ────────────────────────────────────────────────────────

def calc_damage(
    move: dict, atk_stat: int, def_stat: int,
    stab: float, type_m: float, weather_m: float = 1.0,
    spread: bool = False, other: float = 1.0
) -> float:
    """Returns average damage (92.5% roll)."""
    power = max(1, move['base_power'])
    level_term = (2 * LEVEL) // 5 + 2
    base = (level_term * power * atk_stat // def_stat) // 50 + 2
    # Apply modifiers in order
    dmg = base * (0.75 if spread else 1.0)
    dmg = dmg * weather_m
    dmg = dmg * 0.925  # avg roll
    dmg = dmg * stab
    dmg = dmg * type_m
    dmg = dmg * other
    return max(1.0, dmg)

# ── In-battle Pokémon state ───────────────────────────────────────────────────

@dataclass
class BattlePoke:
    identifier: str
    types: list[str]
    ability: str
    item: str | None
    moves: list[str]       # up to 4 move IDs (all damaging, from DB)
    max_hp: int
    current_hp: int
    stats: dict[str, int]
    fainted: bool = False
    boosts: dict[str, int] = field(default_factory=lambda: {
        'attack': 0, 'defense': 0, 'special_attack': 0, 'special_defense': 0, 'speed': 0
    })
    status: str = 'healthy'  # healthy / burned / paralyzed / poisoned
    item_consumed: bool = False

    def effective_stat(self, stat: str) -> int:
        base = self.stats[stat]
        b = self.boosts.get(stat, 0)
        mult = (2 + b) / 2 if b >= 0 else 2 / (2 - b)
        val = max(1, int(base * mult))
        if stat == 'attack' and self.ability in ('huge_power', 'pure_power'):
            val *= 2
        if stat == 'attack' and self.status == 'burned':
            val = val // 2
        if stat == 'speed' and self.status == 'paralyzed':
            val = val // 2
        if stat == 'speed' and self.item == 'choice_scarf' and not self.item_consumed:
            val = int(val * 1.5)
        return val

    @property
    def bst(self) -> int:
        return sum(self.stats.values())

# ── Team building ─────────────────────────────────────────────────────────────

def build_random_team(db: dict, n: int = 4, verbose: bool = False) -> list[BattlePoke]:
    """Build a random team of n fully-evolved Pokémon with legal movesets."""
    pokemon = db['pokemon']
    moves_by_poke = db['moves_by_pokemon']
    abilities_map = db['abilities_map']
    all_moves = db['moves']

    # Filter: FE approximation (BST ≥ MIN_BST_FOR_FE, no mega/primal forms, has moves)
    candidates = [
        pid for pid, p in pokemon.items()
        if (p.get('hp', 0) or 0) > 0
        and sum(p.get(s, 0) or 0 for s in ('hp', 'attack', 'defense', 'special_attack', 'special_defense', 'speed')) >= MIN_BST_FOR_FE
        and 'mega' not in pid and 'primal' not in pid and 'gmax' not in pid
        and pid in moves_by_poke
        and len([m for m in moves_by_poke.get(pid, []) if m in all_moves]) >= 4
    ]

    if len(candidates) < n:
        raise ValueError(f"Not enough Pokémon candidates ({len(candidates)}) for team size {n}")

    chosen_ids = random.sample(candidates, n)
    team: list[BattlePoke] = []

    for pid in chosen_ids:
        pdata = pokemon[pid]
        base_stats = {
            'hp': pdata.get('hp', 1) or 1,
            'attack': pdata.get('attack', 1) or 1,
            'defense': pdata.get('defense', 1) or 1,
            'special_attack': pdata.get('special_attack', 1) or 1,
            'special_defense': pdata.get('special_defense', 1) or 1,
            'speed': pdata.get('speed', 1) or 1,
        }
        stats = calc_stats(base_stats)
        types = pdata.get('types', ['normal'])

        # Choose ability
        ability_pool = abilities_map.get(pid, ['none'])
        ability = random.choice(ability_pool) if ability_pool else 'none'

        # Choose 4 damaging moves from learnable set
        learnable_damaging = [m for m in moves_by_poke.get(pid, []) if m in all_moves]
        chosen_moves = random.sample(learnable_damaging, min(4, len(learnable_damaging)))
        if not chosen_moves:
            chosen_moves = ['tackle']  # fallback

        # Choose item
        item = random.choice(RANDOM_ITEMS)

        team.append(BattlePoke(
            identifier=pid,
            types=types,
            ability=ability,
            item=item,
            moves=chosen_moves,
            max_hp=stats['hp'],
            current_hp=stats['hp'],
            stats=stats,
        ))

    return team

# ── Greedy AI ──────────────────────────────────────────────────────────────────

def pick_best_move(
    attacker: BattlePoke,
    opponents: list[BattlePoke],
    type_chart: dict,
    all_moves: dict,
    weather: str = 'none',
) -> tuple[str, BattlePoke] | None:
    """Pick (move_id, target) maximizing expected damage."""
    best_dmg = -1.0
    best = None

    for move_id in attacker.moves:
        move = all_moves.get(move_id)
        if not move or move['base_power'] <= 0:
            continue

        is_physical = move['category'] == 'physical'
        atk_stat_key = 'attack' if is_physical else 'special_attack'
        def_stat_key = 'defense' if is_physical else 'special_defense'
        is_spread = move_id in SPREAD_MOVES

        for target in opponents:
            if target.fainted:
                continue
            def_stat = target.effective_stat(def_stat_key)
            atk_stat = attacker.effective_stat(atk_stat_key)
            tm = type_mult(type_chart, move['type_id'], target.types)
            if tm == 0:
                continue
            stab = 1.5 if move['type_id'] in attacker.types else 1.0
            wm = WEATHER_BOOST.get((weather, move['type_id']), 1.0)
            if wm == 0.0:
                continue
            # Item boost
            item_m = 1.0
            if attacker.item and not attacker.item_consumed:
                if attacker.item in ITEM_TYPE_BOOST:
                    itype, imult = ITEM_TYPE_BOOST[attacker.item]
                    if itype == move['type_id']:
                        item_m = imult
                if attacker.item == 'life_orb':
                    item_m *= 1.3
                if attacker.item == 'choice_band' and is_physical:
                    item_m *= 1.5
                if attacker.item == 'choice_specs' and not is_physical:
                    item_m *= 1.5
                if attacker.item == 'expert_belt' and tm > 1:
                    item_m *= 1.2
            dmg = calc_damage(move, atk_stat, def_stat, stab, tm, wm, is_spread, item_m)
            # Normalize by target HP
            score = dmg / max(1, target.current_hp)
            if score > best_dmg:
                best_dmg = score
                best = (move_id, target)

    return best

# ── Battle simulation ─────────────────────────────────────────────────────────

@dataclass
class SimField:
    weather: str = 'none'
    weather_turns: int = 0
    trick_room: bool = False
    trick_room_turns: int = 0
    tailwind: list[int] = field(default_factory=lambda: [0, 0])

def active_pokes(team: list[BattlePoke]) -> list[BattlePoke]:
    return [p for p in team if not p.fainted]

def run_battle(
    team_a: list[BattlePoke],
    team_b: list[BattlePoke],
    type_chart: dict,
    all_moves: dict,
    verbose: bool = False,
) -> int:
    """
    Simulate a VGC doubles battle between team_a and team_b.
    Returns 0 if team_a wins, 1 if team_b wins.
    """
    field = SimField()

    # Entry abilities: weather setters
    WEATHER_ABILITIES = {
        'drought': 'sun', 'drizzle': 'rain',
        'sand_stream': 'sandstorm', 'snow_warning': 'hail',
    }
    TERRAIN_SETTING_ABILITIES = {'electric_surge', 'psychic_surge', 'grassy_surge', 'misty_surge'}

    all_pokes = team_a[:2] + team_b[:2]
    for poke in all_pokes:
        if poke.ability in WEATHER_ABILITIES:
            field.weather = WEATHER_ABILITIES[poke.ability]
            field.weather_turns = 5
        if poke.ability == 'intimidate':
            # Drop opponent's attack -1
            opponents = team_b[:2] if poke in team_a[:2] else team_a[:2]
            for opp in opponents:
                if not opp.fainted and opp.ability not in ('inner_focus', 'own_tempo'):
                    opp.boosts['attack'] = max(-6, opp.boosts['attack'] - 1)

    for turn in range(MAX_TURNS):
        alive_a = active_pokes(team_a)
        alive_b = active_pokes(team_b)
        if not alive_a:
            return 1
        if not alive_b:
            return 0

        # Each active Pokémon picks best move
        actions: list[tuple[BattlePoke, str, BattlePoke]] = []  # (attacker, move_id, target)

        for attacker in alive_a[:2]:
            result = pick_best_move(attacker, alive_b[:2], type_chart, all_moves, field.weather)
            if result:
                actions.append((attacker, result[0], result[1]))

        for attacker in alive_b[:2]:
            result = pick_best_move(attacker, alive_a[:2], type_chart, all_moves, field.weather)
            if result:
                actions.append((attacker, result[0], result[1]))

        # Sort by speed (simplified: ignore priority)
        def action_speed(act: tuple) -> float:
            poke = act[0]
            spd = poke.effective_stat('speed')
            if poke.ability == 'swift_swim' and field.weather in ('rain', 'heavy_rain'):
                spd *= 2
            if poke.ability == 'chlorophyll' and field.weather in ('sun', 'harsh_sun'):
                spd *= 2
            return spd if not field.trick_room else -spd

        actions.sort(key=action_speed, reverse=True)

        # Execute actions
        for attacker, move_id, target in actions:
            if attacker.fainted or target.fainted:
                continue
            move = all_moves.get(move_id)
            if not move:
                continue

            is_physical = move['category'] == 'physical'
            is_spread = move_id in SPREAD_MOVES
            atk_stat = attacker.effective_stat('attack' if is_physical else 'special_attack')
            targets_hit = (team_b if attacker in team_a else team_a)[:2] if is_spread else [target]

            for tgt in targets_hit:
                if tgt.fainted:
                    continue
                def_stat = tgt.effective_stat('defense' if is_physical else 'special_defense')
                tm = type_mult(type_chart, move['type_id'], tgt.types)
                if tm == 0:
                    continue
                stab = 1.5 if move['type_id'] in attacker.types else 1.0
                wm = WEATHER_BOOST.get((field.weather, move['type_id']), 1.0)
                if wm == 0.0:
                    continue

                item_m = 1.0
                if attacker.item and not attacker.item_consumed:
                    if attacker.item == 'life_orb': item_m *= 1.3
                    if attacker.item == 'choice_band' and is_physical: item_m *= 1.5
                    if attacker.item == 'choice_specs' and not is_physical: item_m *= 1.5

                dmg = calc_damage(move, atk_stat, def_stat, stab, tm, wm, is_spread, item_m)
                # Apply some randomness (85%–100% roll)
                dmg = dmg * random.uniform(0.85, 1.0) / 0.925

                # Sturdy / Focus Sash
                if tgt.current_hp == tgt.max_hp and dmg >= tgt.current_hp:
                    if tgt.ability == 'sturdy' or (tgt.item == 'focus_sash' and not tgt.item_consumed):
                        dmg = tgt.current_hp - 1
                        if tgt.item == 'focus_sash':
                            tgt.item_consumed = True

                # Sitrus berry
                tgt.current_hp = max(0, tgt.current_hp - int(dmg))
                if not tgt.item_consumed and tgt.item == 'sitrus_berry' and tgt.current_hp <= tgt.max_hp // 2:
                    tgt.current_hp = min(tgt.max_hp, tgt.current_hp + tgt.max_hp // 4)
                    tgt.item_consumed = True

                if tgt.current_hp == 0:
                    tgt.fainted = True
                    if verbose:
                        print(f"  {tgt.identifier} fainted (turn {turn+1})")

            # Life Orb recoil
            if attacker.item == 'life_orb' and not attacker.item_consumed and not attacker.fainted:
                recoil = max(1, attacker.max_hp // 10)
                attacker.current_hp = max(0, attacker.current_hp - recoil)
                if attacker.current_hp == 0:
                    attacker.fainted = True

        # End-of-turn: burn / weather damage (simplified)
        for poke in team_a[:2] + team_b[:2]:
            if poke.fainted:
                continue
            if poke.status == 'burned' and poke.ability != 'magic_guard':
                poke.current_hp = max(0, poke.current_hp - max(1, poke.max_hp // 16))
                if poke.current_hp == 0:
                    poke.fainted = True

        # Refill active slots from bench (simplified: next alive party member)
        for team in (team_a, team_b):
            for i in range(min(2, len(team))):
                if team[i].fainted:
                    bench = [p for p in team[2:] if not p.fainted]
                    if bench:
                        team[i] = bench[0]
                        # Intimidate on switch-in
                        if team[i].ability == 'intimidate':
                            opps = team_b[:2] if team is team_a else team_a[:2]
                            for opp in opps:
                                if not opp.fainted and opp.ability not in ('inner_focus', 'own_tempo'):
                                    opp.boosts['attack'] = max(-6, opp.boosts['attack'] - 1)

        # Tick weather
        if field.weather_turns > 0:
            field.weather_turns -= 1
            if field.weather_turns == 0:
                field.weather = 'none'

        # Check win
        if all(p.fainted for p in team_a):
            return 1
        if all(p.fainted for p in team_b):
            return 0

    # Turn limit: team with more HP remaining wins
    hp_a = sum(max(0, p.current_hp) for p in team_a)
    hp_b = sum(max(0, p.current_hp) for p in team_b)
    return 0 if hp_a >= hp_b else 1

# ── Win-rate derivation ───────────────────────────────────────────────────────

def compute_pair_winrates(
    results: list[tuple[list[str], list[str], int]]
) -> dict[tuple[str, str], tuple[int, int]]:
    """
    For each (pokemon_a, pokemon_b) pair that appeared on the same team,
    compute (wins, total_battles) where win means their team won.
    """
    pair_stats: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])

    for ids_a, ids_b, winner in results:
        # Pairs within team A
        for i, pa in enumerate(ids_a):
            for pb in ids_a[i + 1:]:
                key = (min(pa, pb), max(pa, pb))
                pair_stats[key][1] += 1
                if winner == 0:
                    pair_stats[key][0] += 1
        # Pairs within team B
        for i, pa in enumerate(ids_b):
            for pb in ids_b[i + 1:]:
                key = (min(pa, pb), max(pa, pb))
                pair_stats[key][1] += 1
                if winner == 1:
                    pair_stats[key][0] += 1

    return {k: (v[0], v[1]) for k, v in pair_stats.items()}

# ── Training data export ──────────────────────────────────────────────────────

def export_synergy_jsonl(
    pair_winrates: dict[tuple[str, str], tuple[int, int]],
    db: dict,
    out_dir: Path,
    min_battles: int = 5,
) -> None:
    """
    Write doubles_synergy_training.jsonl augmented with self-play win-rates.
    Format matches what train_strategy.py expects.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / 'doubles_synergy_training_selfplay.jsonl'

    pokemon = db['pokemon']
    type_chart = db['type_chart']
    abilities_map = db['abilities_map']

    STAT_ORDER = ['hp', 'attack', 'defense', 'special_attack', 'special_defense', 'speed']
    ALL_TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison',
                 'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy']

    def type_vec(types: list[str]) -> list[int]:
        return [1 if t in types else 0 for t in ALL_TYPES]

    def stat_vec(pdata: dict) -> list[float]:
        total = sum(pdata.get(s, 1) or 1 for s in STAT_ORDER)
        return [(pdata.get(s, 1) or 1) / max(1, total) for s in STAT_ORDER]

    written = 0
    with open(out_path, 'w', encoding='utf-8') as f:
        for (pa, pb), (wins, total) in pair_winrates.items():
            if total < min_battles:
                continue
            if pa not in pokemon or pb not in pokemon:
                continue

            win_rate = wins / total
            # Convert win_rate to a [-1, 1] score (0.5 win-rate → 0 = neutral synergy)
            score = (win_rate - 0.5) * 2

            pa_data = pokemon[pa]
            pb_data = pokemon[pb]
            pa_types = pa_data.get('types', ['normal'])
            pb_types = pb_data.get('types', ['normal'])

            features = (
                type_vec(pa_types) + type_vec(pb_types) +
                stat_vec(pa_data) + stat_vec(pb_data)
            )

            record = {
                'pokemon_a': pa, 'pokemon_b': pb,
                'score': round(score, 4),
                'win_rate': round(win_rate, 4),
                'battles': total,
                'features': [round(x, 4) for x in features],
            }
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
            written += 1

    print(f'[selfplay] Exported {written} synergy pairs to {out_path}')

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description='VGC self-play training loop')
    parser.add_argument('--n-battles', type=int, default=1000, help='Number of battles to simulate')
    parser.add_argument('--db', type=str, default=str(DEFAULT_DB), help='Path to SQLite DB')
    parser.add_argument('--out-dir', type=str, default=str(DEFAULT_OUT), help='Output directory')
    parser.add_argument('--team-size', type=int, default=4, help='Pokémon per team (bring N)')
    parser.add_argument('--verbose', action='store_true', help='Print battle logs')
    parser.add_argument('--seed', type=int, default=None, help='Random seed for reproducibility')
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    db_path = Path(args.db)
    if not db_path.exists():
        print(f'[selfplay] ERROR: DB not found at {db_path}', file=sys.stderr)
        sys.exit(1)

    print(f'[selfplay] Loading database from {db_path}')
    db = load_db(db_path)
    print(f'[selfplay] Loaded {len(db["pokemon"])} Pokémon, {len(db["moves"])} damaging moves')

    results: list[tuple[list[str], list[str], int]] = []
    wins_a = 0

    print(f'[selfplay] Running {args.n_battles} battles (team_size={args.team_size}) …')
    for i in range(args.n_battles):
        try:
            team_a = build_random_team(db, args.team_size)
            team_b = build_random_team(db, args.team_size)
        except ValueError as e:
            print(f'[selfplay] Skipping battle {i}: {e}', file=sys.stderr)
            continue

        ids_a = [p.identifier for p in team_a]
        ids_b = [p.identifier for p in team_b]

        winner = run_battle(team_a, team_b, db['type_chart'], db['moves'], verbose=args.verbose)
        results.append((ids_a, ids_b, winner))
        if winner == 0:
            wins_a += 1

        if (i + 1) % 100 == 0:
            print(f'  [{i+1}/{args.n_battles}] Team A win rate: {wins_a / (i+1):.1%}')

    print(f'\n[selfplay] Done! {len(results)} battles. Team A win rate: {wins_a/max(1,len(results)):.1%}')

    pair_winrates = compute_pair_winrates(results)
    print(f'[selfplay] Found {len(pair_winrates)} unique pairs with data')

    export_synergy_jsonl(pair_winrates, db, Path(args.out_dir))
    print(f'[selfplay] Training data written. Run train_strategy.py to retrain the model.')


if __name__ == '__main__':
    main()
