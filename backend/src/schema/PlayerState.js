import { Schema, defineTypes } from "@colyseus/schema";

export class PlayerState extends Schema {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  walking = false;
  armed = false;
  weaponId = "";
  reloading = false;
  aiming = false;
}

defineTypes(PlayerState, {
  x: "float32",
  y: "float32",
  z: "float32",
  yaw: "float32",
  pitch: "float32",
  walking: "boolean",
  armed: "boolean",
  weaponId: "string",
  reloading: "boolean",
  aiming: "boolean"
});
