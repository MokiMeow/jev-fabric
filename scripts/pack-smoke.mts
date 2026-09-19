import { verifyPackArtifacts } from "./pack-smoke.mjs";

export { verifyPackArtifacts };

if (process.argv[1]?.endsWith("pack-smoke.mts")) verifyPackArtifacts();
