// Refuses to package placeholder demo answers. The sample flow plays answers
// bundled from test/fixtures/synthetic-demo-answers.json; until they are
// recorded from a real model (`npm run record-demo`) that file is marked
// provisional. Run first by `npm run zip`: exits non-zero when the file is
// provisional, an answer is empty, the draw answer has no diagram, or a row of
// the sample flow's Explain picker has no answer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { demoAnswerProblems } from '../src/lib/demo-recordings.ts';

const fixtures = join(fileURLToPath(new URL('..', import.meta.url)), 'test', 'fixtures');
const read = (name: string): unknown => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));

const file = read('synthetic-demo-answers.json');
const problems = demoAnswerProblems(file, read('synthetic-flow.json'));
if ((file as { provisional?: unknown } | null)?.provisional === true) problems.unshift('the answers are provisional placeholders; run `npm run record-demo` with a real key');

if (problems.length) {
  console.error(`demo recordings: not ready to package\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('demo recordings: complete and recorded from a real model');
