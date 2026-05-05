import { ActionProfile, ActionOrder, StatMap } from './types';

// --- Speed Control ---

export interface SpeedControlState {
  tailwindTurns: number;    // 0 = inactive; 1–4 = active (counts down each turn)
  trickRoomTurns: number;   // 0 = inactive; 1–5 = active (counts down each turn)
  speedStages: Record<string, number>; // pokemon_identifier → stage (-6 to +6)
}

export function createSpeedControlState(): SpeedControlState {
  return { tailwindTurns: 0, trickRoomTurns: 0, speedStages: {} };
}

// Stage multiplier table per Gen V+ mechanics
const STAGE_MULTIPLIERS: Record<number, number> = {
  [-6]: 2 / 8,
  [-5]: 2 / 7,
  [-4]: 2 / 6,
  [-3]: 2 / 5,
  [-2]: 2 / 4,
  [-1]: 2 / 3,
  [0]:  2 / 2,
  [1]:  3 / 2,
  [2]:  4 / 2,
  [3]:  5 / 2,
  [4]:  6 / 2,
  [5]:  7 / 2,
  [6]:  8 / 2,
};

export function applySpeedStage(baseSpeed: number, stage: number): number {
  const clampedStage = Math.max(-6, Math.min(6, stage));
  return Math.floor(baseSpeed * (STAGE_MULTIPLIERS[clampedStage] ?? 1));
}

export function applyTailwind(speed: number): number {
  return speed * 2;
}

export function effectiveSpeed(
  identifier: string,
  statSpeed: number,
  speedControl: SpeedControlState
): number {
  const stage = speedControl.speedStages[identifier] ?? 0;
  let speed = applySpeedStage(statSpeed, stage);
  if (speedControl.tailwindTurns > 0) {
    speed = applyTailwind(speed);
  }
  return speed;
}

export function isTrickRoomActive(speedControl: SpeedControlState): boolean {
  return speedControl.trickRoomTurns > 0;
}

export function activateTailwind(state: SpeedControlState): SpeedControlState {
  return { ...state, tailwindTurns: 4 };
}

export function activateTrickRoom(state: SpeedControlState): SpeedControlState {
  // Re-using trick room while active cancels it immediately
  if (state.trickRoomTurns > 0) {
    return { ...state, trickRoomTurns: 0 };
  }
  return { ...state, trickRoomTurns: 5 };
}

export function tickSpeedControl(state: SpeedControlState): SpeedControlState {
  return {
    ...state,
    tailwindTurns: Math.max(0, state.tailwindTurns - 1),
    trickRoomTurns: Math.max(0, state.trickRoomTurns - 1),
  };
}

// --- Redirection ---

export interface RedirectionState {
  redirectTarget: string | null; // pokemon_identifier of Follow Me / Rage Powder user
  active: boolean;
}

export function createRedirectionState(): RedirectionState {
  return { redirectTarget: null, active: false };
}

export function activateRedirection(identifier: string): RedirectionState {
  return { redirectTarget: identifier, active: true };
}

export function clearRedirection(): RedirectionState {
  return { redirectTarget: null, active: false };
}

// Returns the actual target after applying redirection logic.
// Spread moves, Z-moves, Max moves, and self-targeting moves ignore redirection.
export function resolveTarget(
  originalTarget: string,
  moveCategory: 'single' | 'spread' | 'self' | 'ally',
  redirection: RedirectionState
): string {
  if (!redirection.active || redirection.redirectTarget === null) {
    return originalTarget;
  }
  if (moveCategory !== 'single') {
    return originalTarget;
  }
  return redirection.redirectTarget;
}

// --- Protect State ---

export interface ProtectState {
  protectedPokemon: Set<string>;  // pokemon_identifiers behind Protect / Detect
  wideGuardActive: boolean;       // blocks spread moves for the whole side
  quickGuardActive: boolean;      // blocks priority moves for the whole side
}

export function createProtectState(): ProtectState {
  return { protectedPokemon: new Set(), wideGuardActive: false, quickGuardActive: false };
}

export function activateProtect(state: ProtectState, identifier: string): ProtectState {
  const next = new Set(state.protectedPokemon);
  next.add(identifier);
  return { ...state, protectedPokemon: next };
}

export function activateWideGuard(state: ProtectState): ProtectState {
  return { ...state, wideGuardActive: true };
}

export function activateQuickGuard(state: ProtectState): ProtectState {
  return { ...state, quickGuardActive: true };
}

export function clearProtectState(): ProtectState {
  return createProtectState();
}

// Returns true if the move is blocked by an active protection.
export function isProtected(
  target: string,
  movePriority: number,
  moveCategory: 'single' | 'spread' | 'self' | 'ally',
  protect: ProtectState
): boolean {
  if (moveCategory === 'self') return false;

  if (protect.quickGuardActive && movePriority > 0) return true;
  if (protect.wideGuardActive && moveCategory === 'spread') return true;
  if (protect.protectedPokemon.has(target)) return true;

  return false;
}

// --- VGC Action Profile (extends core ActionProfile with VGC context) ---

export interface VGCActionProfile extends ActionProfile {
  identifier: string;
  stats: StatMap;
}

// Resolves full turn order for a list of VGC actions, applying trick room and tailwind.
export function resolveTurnOrder(
  actions: VGCActionProfile[],
  speedControl: SpeedControlState
): VGCActionProfile[] {
  const trickRoom = isTrickRoomActive(speedControl);

  const withEffectiveSpeed = actions.map((a) => ({
    action: a,
    effSpeed: effectiveSpeed(a.identifier, a.stats.speed, speedControl),
  }));

  withEffectiveSpeed.sort((x, y) => {
    // 1. Priority bracket (higher always goes first, regardless of trick room)
    if (x.action.priority !== y.action.priority) {
      return y.action.priority - x.action.priority;
    }

    // 2. Within same priority: trick room reverses speed comparison
    if (x.effSpeed !== y.effSpeed) {
      return trickRoom
        ? x.effSpeed - y.effSpeed   // lower speed goes first under trick room
        : y.effSpeed - x.effSpeed;  // higher speed goes first normally
    }

    // 3. Speed tie: use expected damage as tiebreaker (higher damage breaks tie first)
    return y.action.damage - x.action.damage;
  });

  return withEffectiveSpeed.map((e) => e.action);
}

// Convenience: compare exactly two actions under VGC rules, returns ActionOrder
export function compareVGCActionOrder(
  a: VGCActionProfile,
  b: VGCActionProfile,
  speedControl: SpeedControlState
): ActionOrder {
  const ordered = resolveTurnOrder([a, b], speedControl);
  return ordered[0].identifier === a.identifier ? 'first' : 'second';
}
