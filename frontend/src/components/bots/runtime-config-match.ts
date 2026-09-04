export function runtimeConfigMatches(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  return Object.entries(expected).filter(([key]) => !key.startsWith("_")).every(([key, value]) => {
    const observed = actual[key];
    if (value == null) return observed == null;
    if (observed == null) return false;
    if (typeof value === "boolean") return observed === value;
    if (String(value).trim() !== "" && Number.isFinite(Number(value))) {
      return String(observed).trim() !== "" && Number(observed) === Number(value);
    }
    return String(observed) === String(value);
  });
}
