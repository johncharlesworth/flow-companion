// Lossless normalization for Salesforce Flow metadata JSON.
//
// Strips noise fields that don't carry semantic meaning for explanation:
// - locationX / locationY (canvas coordinates)
// - processMetadataValues: [] (empty audit arrays)
// - nameSegment / versionSegment (redundant — derivable from fullName)
// - elementSubtype: null
// - value blocks collapsed to their non-null discriminated fields
//
// Everything else passes through untouched, including keys this code has
// never seen: Winter '27 persists End elements and adds grouping and tags,
// and future releases will add more. Roughly 8% smaller on typical flows;
// the real win is less noise for the model to attend to.

const NOISE_KEYS = new Set(['locationX', 'locationY', 'nameSegment', 'versionSegment']);

export function normalizeFlow(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(normalizeFlow);
  }
  if (input === null || typeof input !== 'object') {
    return input;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (NOISE_KEYS.has(key)) continue;
    if (key === 'processMetadataValues' && Array.isArray(value) && value.length === 0) continue;
    if (key === 'elementSubtype' && value === null) continue;
    if (key === 'value' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const collapsed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== null) collapsed[k] = normalizeFlow(v);
      }
      out[key] = collapsed;
      continue;
    }
    out[key] = normalizeFlow(value);
  }
  return out;
}
