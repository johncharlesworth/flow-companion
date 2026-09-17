import { describe, expect, it } from 'vitest';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import { checkIdentifiers, cleanMermaid, countNodes, extractMermaid, flowIdentifiers, hasOpenMermaidFence, identifiersIn, neutraliseOpenMermaidFence } from './mermaid-text';

// The pure half of Draw this flow: find the one
// diagram in an answer, tidy its labels before Mermaid sees them, count its
// nodes, and check that every API-looking name in it exists in the flow.

const ANSWER = `Here is the picture.

\`\`\`mermaid
flowchart TD
  A["Account is updated"] --> B{"Enterprise account?"}
  B -->|Yes| C["Update the account"]
  B -->|No| D["Assign a follow-up owner"]
  C --> E["Create a follow-up task"]
  D --> E
\`\`\`

The flow branches once on the account type and always ends with a task.`;

describe('extractMermaid', () => {
  it('returns the body of the one closed mermaid block, trimmed', () => {
    expect(extractMermaid(ANSWER)).toBe(`flowchart TD\n  A["Account is updated"] --> B{"Enterprise account?"}\n  B -->|Yes| C["Update the account"]\n  B -->|No| D["Assign a follow-up owner"]\n  C --> E["Create a follow-up task"]\n  D --> E`);
  });

  it('returns null when there is no mermaid block, or the block is still open', () => {
    expect(extractMermaid('No diagram here.\n\n```json\n{}\n```')).toBeNull();
    expect(extractMermaid('```mermaid\nflowchart TD\n  A --> B')).toBeNull();
    expect(extractMermaid('')).toBeNull();
  });

  it('takes the first block when the model sends two', () => {
    expect(extractMermaid('```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nflowchart TD\n  C --> D\n```')).toBe('flowchart TD\n  A --> B');
  });
});

describe('open fences while streaming', () => {
  it('detects an unfinished mermaid fence and neutralises it to plain code so nothing tries to draw a half diagram', () => {
    const partial = 'Here it is.\n\n```mermaid\nflowchart TD\n  A["Start"] -->';
    expect(hasOpenMermaidFence(partial)).toBe(true);
    expect(neutraliseOpenMermaidFence(partial)).toBe('Here it is.\n\n```text\nflowchart TD\n  A["Start"] -->');
  });

  it('leaves a closed block and other languages alone', () => {
    expect(hasOpenMermaidFence(ANSWER)).toBe(false);
    expect(neutraliseOpenMermaidFence(ANSWER)).toBe(ANSWER);
    const json = 'Formula:\n\n```json\n{"a": 1';
    expect(hasOpenMermaidFence(json)).toBe(false);
    expect(neutraliseOpenMermaidFence(json)).toBe(json);
  });
});

describe('cleanMermaid', () => {
  it('forces a top-down flowchart header for the narrow panel', () => {
    expect(cleanMermaid('graph LR\n  A --> B')).toBe('flowchart TD\n  A --> B');
    expect(cleanMermaid('flowchart LR\n  A --> B')).toBe('flowchart TD\n  A --> B');
    expect(cleanMermaid('  A --> B')).toBe('flowchart TD\n  A --> B');
  });

  it('straightens curly quotes and drops quotes, parentheses, and semicolons inside quoted labels', () => {
    expect(cleanMermaid('flowchart TD\n  A[“Checks the (account) type; then routes”] --> B{"Is it \\"Enterprise\\"?"}')).toBe('flowchart TD\n  A["Checks the account type then routes"] --> B{"Is it Enterprise?"}');
  });

  it('quotes an unquoted label so its punctuation cannot break the parser', () => {
    expect(cleanMermaid('flowchart TD\n  A[Checks the (account) type] --> B{Enterprise?}\n  B --> C(Update; the account)')).toBe('flowchart TD\n  A["Checks the account type"] --> B{"Enterprise?"}\n  B --> C("Update the account")');
  });

  it('keeps stadium and hexagon shapes and edge labels, cleaning inside them', () => {
    expect(cleanMermaid('flowchart TD\n  A(["Start (record saved)"]) --> B{{"Wait; then"}}\n  B -->|"Yes (all)"| C["End"]')).toBe('flowchart TD\n  A(["Start record saved"]) --> B{{"Wait then"}}\n  B -->|Yes all| C["End"]');
  });

  it('collapses whitespace in labels and drops init directives and click lines', () => {
    expect(cleanMermaid('%%{init: {"theme": "dark"}}%%\nflowchart TD\n  A["Two   spaces\tand a tab"] --> B["End"]\n  click A "https://evil.example"\n\n\n  B --> C["Done"]')).toBe('flowchart TD\n  A["Two spaces and a tab"] --> B["End"]\n  B --> C["Done"]');
  });

  it('strips a directive however it is laid out: several lines, unterminated, or sharing a line with the header', () => {
    // Mermaid's directive regex spans lines and tolerates a missing closer; a directive can set themeCSS, which is CSS injected into the panel.
    expect(cleanMermaid('%%{init: {\n  "themeCSS": "} body { display: none } .x {"\n}}%%\nflowchart TD\n  A["Start"] --> B["End"]')).toBe('flowchart TD\n  A["Start"] --> B["End"]');
    expect(cleanMermaid('flowchart TD\n  A["Start"] --> B["End"]\n%%{init: {"themeVariables": {"fontFamily": "x"}}')).toBe('flowchart TD\n  A["Start"] --> B["End"]');
    expect(cleanMermaid('%%{init: {"theme": "dark"}}%% flowchart LR\n  A["Start"] --> B["End"]')).toBe('flowchart TD\n  A["Start"] --> B["End"]');
  });

  it('strips HTML tags inside labels', () => {
    expect(cleanMermaid('flowchart TD\n  A["<b>Bold</b> step"] --> B["<img src=x onerror=alert(1)>"]')).toBe('flowchart TD\n  A["Bold step"] --> B[""]');
  });
});

describe('countNodes', () => {
  it('counts distinct node ids across shapes, chains, and edge labels', () => {
    expect(countNodes(extractMermaid(ANSWER)!)).toBe(5);
    expect(countNodes('flowchart TD\n  A --> B --> C\n  B -->|No| D\n  D & E --> F\n  style A fill:#fff\n  classDef x fill:#000')).toBe(6);
    expect(countNodes('flowchart TD')).toBe(0);
  });

  it('does not count words inside labels as nodes', () => {
    expect(countNodes('flowchart TD\n  A["B C D"] -->|E F| G')).toBe(2);
  });
});

describe('identifiers', () => {
  it('finds API-looking names (underscored or CamelCase) in labels and ids, not plain words or short ids', () => {
    expect(identifiersIn('flowchart TD\n  A["Runs Check_Customer_Type"] --> UpdateAccount["Calls UpdateAccount then $Record.OwnerId"]\n  B1 -->|Is_Valid| C["Enterprise account?"]')).toEqual(['Check_Customer_Type', 'UpdateAccount', 'OwnerId', 'Is_Valid']);
  });

  it('ids that carry a label are not checked (the reader never sees them); bare ids are, since Mermaid prints them', () => {
    expect(identifiersIn('flowchart TD\n  Start["Account updated"] --> CheckType{"Check customer type"}\n  CheckType -->|Enterprise| UpdateInfo["Update the account"]')).toEqual([]);
    expect(identifiersIn('flowchart TD\n  Start --> Check_Customer_Type\n  Check_Customer_Type -->|Enterprise| UpdateAccount["UpdateAccount"]')).toEqual(['Check_Customer_Type', 'UpdateAccount']);
  });

  it('flowIdentifiers collects every API-looking token from the flow JSON, names included', () => {
    const names = flowIdentifiers(syntheticFlow);
    for (const expected of ['CheckCustomerType', 'UpdateAccount', 'AssignFollowupOwner', 'CreateFollowupTask', 'AccountAgeInDays', 'DefaultOwnerVariable', 'AnnualRevenue']) expect(names.has(expected)).toBe(true);
    expect(names.has('Delete_Everything')).toBe(false);
  });

  it('checkIdentifiers lists the names a diagram uses that the flow does not have, once each', () => {
    const diagram = 'flowchart TD\n  A["CheckCustomerType"] --> B["Delete_Everything"]\n  B --> C["Delete_Everything again"] --> D["UpdateAccount"]';
    expect(checkIdentifiers(diagram, syntheticFlow)).toEqual({ known: ['CheckCustomerType', 'UpdateAccount'], unknown: ['Delete_Everything'] });
    expect(checkIdentifiers('flowchart TD\n  A["Plain words only"] --> B["Enterprise?"]', syntheticFlow)).toEqual({ known: [], unknown: [] });
  });
});
