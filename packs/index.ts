export { routePack } from "./route/pack.js";
export { screenPack } from "./screen/pack.js";
export { rankPack } from "./rank/pack.js";
export { verifyPack } from "./verify/pack.js";
export { riskPack } from "./risk/pack.js";
export { progressPack } from "./progress/pack.js";
export { completionPack } from "./completion/pack.js";

import { completionPack } from "./completion/pack.js";
import { progressPack } from "./progress/pack.js";
import { rankPack } from "./rank/pack.js";
import { riskPack } from "./risk/pack.js";
import { routePack } from "./route/pack.js";
import { screenPack } from "./screen/pack.js";
import { verifyPack } from "./verify/pack.js";

/** The finite alpha set; callers cannot mutate this registry. */
export const builtinPacks = Object.freeze([
  routePack,
  screenPack,
  rankPack,
  verifyPack,
  riskPack,
  progressPack,
  completionPack,
]);
