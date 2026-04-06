export async function loadIndexedArrayWithFallback(id, indexedLoader, fileLoader, selectFallback) {
  const normalizedId = String(id ?? "").trim();
  if (!normalizedId) return [];

  let indexedResult = null;
  if (typeof indexedLoader === "function") {
    try {
      const indexed = await indexedLoader(normalizedId);
      if (Array.isArray(indexed)) {
        indexedResult = indexed;
        if (indexed.length > 0) return indexed;
      }
    } catch {
      // fallback below
    }
  }

  const fallbackPayload = typeof fileLoader === "function" ? await fileLoader(normalizedId) : null;
  const fallback = typeof selectFallback === "function" ? selectFallback(fallbackPayload) : fallbackPayload;
  return Array.isArray(fallback) && fallback.length > 0 ? fallback : indexedResult ?? [];
}

export async function loadIndexedObjectWithFallback(id, indexedLoader, fileLoader, emptyValue = null) {
  const normalizedId = String(id ?? "").trim();
  if (!normalizedId) return emptyValue;

  let indexedResult = null;
  if (typeof indexedLoader === "function") {
    try {
      const indexed = await indexedLoader(normalizedId);
      if (indexed && typeof indexed === "object") {
        indexedResult = indexed;
        if (Object.keys(indexed).length > 0) return indexed;
      }
    } catch {
      // fallback below
    }
  }

  const fallback = typeof fileLoader === "function" ? await fileLoader(normalizedId) : null;
  if (fallback && typeof fallback === "object" && Object.keys(fallback).length > 0) {
    return fallback;
  }
  return fallback ?? indexedResult ?? emptyValue;
}
