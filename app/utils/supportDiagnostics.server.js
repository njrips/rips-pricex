import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { summarizeDiagnostics } = require("../../server/src/services/support/supportDiagnostics.js");
