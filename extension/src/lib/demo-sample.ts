// The demo flow the demo runs on: the synthetic test fixture, given the name
// and description the panel shows for it, so the model's answers and the
// header agree. Kept free of path aliases because a plain Node script reads it.

export const DEMO_LABEL = 'Customer Tier Routing Flow';
export const DEMO_DESCRIPTION =
  'Routes an updated account by customer type. Enterprise accounts are set to Active through the Update Account Info action, then every account gets a follow-up owner and a follow-up task.';

/** The raw fixture with the demo's own label, interview label, and description in place of the test ones. */
export function demoSample<T extends object>(sample: T): T & { label: string; interviewLabel: string; description: string } {
  return { ...sample, label: DEMO_LABEL, interviewLabel: `${DEMO_LABEL} {!$Flow.CurrentDateTime}`, description: DEMO_DESCRIPTION };
}
