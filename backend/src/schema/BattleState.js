import { Schema, MapSchema, defineTypes } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";

export class BattleState extends Schema {
  players = new MapSchema();
}

defineTypes(BattleState, {
  players: { map: PlayerState }
});
