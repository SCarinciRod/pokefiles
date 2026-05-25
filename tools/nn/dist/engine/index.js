"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatusMoveEffect = exports.SPREAD_MOVES = exports.TYPE_RESIST_BERRY = exports.ITEM_TYPE_BOOST = exports.ABILITY_REGISTRY = exports.BattleAI = exports.displayPokeName = exports.BattleSimulator = exports.DeterministicEngine = void 0;
var engine_1 = require("./engine");
Object.defineProperty(exports, "DeterministicEngine", { enumerable: true, get: function () { return engine_1.DeterministicEngine; } });
__exportStar(require("./types"), exports);
__exportStar(require("./mechanics"), exports);
__exportStar(require("./vgc_mechanics"), exports);
__exportStar(require("./battle_types"), exports);
var battle_sim_1 = require("./battle_sim");
Object.defineProperty(exports, "BattleSimulator", { enumerable: true, get: function () { return battle_sim_1.BattleSimulator; } });
Object.defineProperty(exports, "displayPokeName", { enumerable: true, get: function () { return battle_sim_1.displayPokeName; } });
var battle_ai_1 = require("./battle_ai");
Object.defineProperty(exports, "BattleAI", { enumerable: true, get: function () { return battle_ai_1.BattleAI; } });
var battle_abilities_1 = require("./battle_abilities");
Object.defineProperty(exports, "ABILITY_REGISTRY", { enumerable: true, get: function () { return battle_abilities_1.ABILITY_REGISTRY; } });
Object.defineProperty(exports, "ITEM_TYPE_BOOST", { enumerable: true, get: function () { return battle_abilities_1.ITEM_TYPE_BOOST; } });
Object.defineProperty(exports, "TYPE_RESIST_BERRY", { enumerable: true, get: function () { return battle_abilities_1.TYPE_RESIST_BERRY; } });
Object.defineProperty(exports, "SPREAD_MOVES", { enumerable: true, get: function () { return battle_abilities_1.SPREAD_MOVES; } });
Object.defineProperty(exports, "getStatusMoveEffect", { enumerable: true, get: function () { return battle_abilities_1.getStatusMoveEffect; } });
