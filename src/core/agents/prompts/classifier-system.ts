// Active classifier system prompt. Re-exports the current version.
// Old versions are kept alongside (classifier-system.v1.ts, .v2.ts) for
// diffing — never imported from runtime code.

export { CLASSIFIER_PROMPT_VERSION, CLASSIFIER_SYSTEM_PROMPT } from "./classifier-system.v3";
