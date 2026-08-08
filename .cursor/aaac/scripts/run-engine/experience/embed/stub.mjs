/**
 * Stub provider — alias of hash for tests (AAAC_EMBEDDING_PROVIDER=stub).
 */
import { createHashProvider } from "./hash.mjs";

export function createStubProvider(dims = 384) {
  const base = createHashProvider(dims);
  return { ...base, id: "stub", model: "stub-hash" };
}
