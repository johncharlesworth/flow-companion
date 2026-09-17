// Structural untrusted-data boundary around the Salesforce flow JSON
// (invariant 6: flow JSON is untrusted data). Applied by every provider adapter
// before placing the flow JSON into the first user message.
//
// We do NOT sanitize content inside the JSON — that would silently drop
// legitimate content and is an arms race. The system prompt instructs the
// model to treat field contents as data, never instructions.

export const FLOW_WRAP_OPEN = '<flow_metadata_json>';
export const FLOW_WRAP_CLOSE = '</flow_metadata_json>';

export function wrapFlowJson(flowJsonString: string): string {
  return `${FLOW_WRAP_OPEN}\n${flowJsonString}\n${FLOW_WRAP_CLOSE}`;
}
