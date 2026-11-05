// Replaces Bun.password with @node-rs/argon2.
// Writes the same PHC string format as Bun (argon2id, m=65536, t=2, p=1), so existing hashes still verify. No reset or migration.
import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Algorithm is a TypeScript const enum. tsx/esbuild cannot inline const enums from a dependency's .d.ts,
// so use the literal value of Algorithm.Argon2id (2).
const ARGON2ID = 2 as Algorithm;

export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: ARGON2ID,
    memoryCost: 65536,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

/** Same argument order as Bun.password.verify(password, hash). Returns false for a malformed hash instead of throwing. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    return await verify(encoded, password);
  } catch {
    return false;
  }
}
