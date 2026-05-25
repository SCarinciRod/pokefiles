"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSpeedControlState = createSpeedControlState;
exports.applySpeedStage = applySpeedStage;
exports.applyTailwind = applyTailwind;
exports.effectiveSpeed = effectiveSpeed;
exports.isTrickRoomActive = isTrickRoomActive;
exports.activateTailwind = activateTailwind;
exports.activateTrickRoom = activateTrickRoom;
exports.tickSpeedControl = tickSpeedControl;
exports.createRedirectionState = createRedirectionState;
exports.activateRedirection = activateRedirection;
exports.clearRedirection = clearRedirection;
exports.resolveTarget = resolveTarget;
exports.createProtectState = createProtectState;
exports.activateProtect = activateProtect;
exports.activateWideGuard = activateWideGuard;
exports.activateQuickGuard = activateQuickGuard;
exports.clearProtectState = clearProtectState;
exports.isProtected = isProtected;
exports.resolveTurnOrder = resolveTurnOrder;
exports.compareVGCActionOrder = compareVGCActionOrder;
function createSpeedControlState() {
    return { tailwindTurns: 0, trickRoomTurns: 0, speedStages: {} };
}
// Stage multiplier table per Gen V+ mechanics
const STAGE_MULTIPLIERS = {
    [-6]: 2 / 8,
    [-5]: 2 / 7,
    [-4]: 2 / 6,
    [-3]: 2 / 5,
    [-2]: 2 / 4,
    [-1]: 2 / 3,
    [0]: 2 / 2,
    [1]: 3 / 2,
    [2]: 4 / 2,
    [3]: 5 / 2,
    [4]: 6 / 2,
    [5]: 7 / 2,
    [6]: 8 / 2,
};
function applySpeedStage(baseSpeed, stage) {
    const clampedStage = Math.max(-6, Math.min(6, stage));
    return Math.floor(baseSpeed * (STAGE_MULTIPLIERS[clampedStage] ?? 1));
}
function applyTailwind(speed) {
    return speed * 2;
}
function effectiveSpeed(identifier, statSpeed, speedControl) {
    const stage = speedControl.speedStages[identifier] ?? 0;
    let speed = applySpeedStage(statSpeed, stage);
    if (speedControl.tailwindTurns > 0) {
        speed = applyTailwind(speed);
    }
    return speed;
}
function isTrickRoomActive(speedControl) {
    return speedControl.trickRoomTurns > 0;
}
function activateTailwind(state) {
    return { ...state, tailwindTurns: 4 };
}
function activateTrickRoom(state) {
    // Re-using trick room while active cancels it immediately
    if (state.trickRoomTurns > 0) {
        return { ...state, trickRoomTurns: 0 };
    }
    return { ...state, trickRoomTurns: 5 };
}
function tickSpeedControl(state) {
    return {
        ...state,
        tailwindTurns: Math.max(0, state.tailwindTurns - 1),
        trickRoomTurns: Math.max(0, state.trickRoomTurns - 1),
    };
}
function createRedirectionState() {
    return { redirectTarget: null, active: false };
}
function activateRedirection(identifier) {
    return { redirectTarget: identifier, active: true };
}
function clearRedirection() {
    return { redirectTarget: null, active: false };
}
// Returns the actual target after applying redirection logic.
// Spread moves, Z-moves, Max moves, and self-targeting moves ignore redirection.
function resolveTarget(originalTarget, moveCategory, redirection) {
    if (!redirection.active || redirection.redirectTarget === null) {
        return originalTarget;
    }
    if (moveCategory !== 'single') {
        return originalTarget;
    }
    return redirection.redirectTarget;
}
function createProtectState() {
    return { protectedPokemon: new Set(), wideGuardActive: false, quickGuardActive: false };
}
function activateProtect(state, identifier) {
    const next = new Set(state.protectedPokemon);
    next.add(identifier);
    return { ...state, protectedPokemon: next };
}
function activateWideGuard(state) {
    return { ...state, wideGuardActive: true };
}
function activateQuickGuard(state) {
    return { ...state, quickGuardActive: true };
}
function clearProtectState() {
    return createProtectState();
}
// Returns true if the move is blocked by an active protection.
function isProtected(target, movePriority, moveCategory, protect) {
    if (moveCategory === 'self')
        return false;
    if (protect.quickGuardActive && movePriority > 0)
        return true;
    if (protect.wideGuardActive && moveCategory === 'spread')
        return true;
    if (protect.protectedPokemon.has(target))
        return true;
    return false;
}
// Resolves full turn order for a list of VGC actions, applying trick room and tailwind.
function resolveTurnOrder(actions, speedControl) {
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
                ? x.effSpeed - y.effSpeed // lower speed goes first under trick room
                : y.effSpeed - x.effSpeed; // higher speed goes first normally
        }
        // 3. Speed tie: use expected damage as tiebreaker (higher damage breaks tie first)
        return y.action.damage - x.action.damage;
    });
    return withEffectiveSpeed.map((e) => e.action);
}
// Convenience: compare exactly two actions under VGC rules, returns ActionOrder
function compareVGCActionOrder(a, b, speedControl) {
    const ordered = resolveTurnOrder([a, b], speedControl);
    return ordered[0].identifier === a.identifier ? 'first' : 'second';
}
