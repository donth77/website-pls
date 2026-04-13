import { TARGET_DIMS } from "./embed";

/**
 * Serialize an embedding vector into a pgvector literal (e.g. "[0.1,0.2,...]").
 *
 * Defends against SQL injection in `$queryRawUnsafe`/`$executeRawUnsafe` calls
 * that bind the result via `$N::vector`: if a compromised or buggy embedding
 * provider returned non-numeric values, naive `Array.join(",")` would
 * interpolate arbitrary strings into the SQL parameter. Every value must be a
 * finite number; the array length must match the pinned dimensionality.
 */
export function toVectorLiteral(vec: readonly number[]): string {
  if (!Array.isArray(vec)) {
    throw new Error("Embedding is not an array");
  }
  if (vec.length !== TARGET_DIMS) {
    throw new Error(
      `Embedding has wrong dimensions: ${vec.length} vs ${TARGET_DIMS}`,
    );
  }
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Embedding value at index ${i} is not a finite number`);
    }
  }
  return `[${vec.join(",")}]`;
}
