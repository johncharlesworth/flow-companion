import { describe, expect, it } from 'vitest';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import {
  extractFlow,
  fetchFlowRecord,
  FLOW_FETCH_TIMEOUT_MS,
  NotOnFlowPageError,
  parseFlowRoute,
  queryFlowDefinition,
  RESOLUTION_TIMEOUT_MS,
  sameFlowRoute,
  UnsavedFlowError,
} from './flow-extractor';
import type { RestOptions, SfdcClient } from './sfdc-client';

// Synthetic ids (allowlisted for the PII scanner). 301 = Flow version, 300 = FlowDefinition.
const VERSION_ID = '301XXXX0000ABCDxyz';
const LATEST_ID = '301XXXX0000LATESTx';
const ACTIVE_ID = '301XXXX0000ACTIVEx';
const DEFINITION_ID = '300XXXX0000ABCDxyz';

const BUILDER = 'https://mycompany.lightning.force.com/builder_platform_interaction/flowBuilder.app';

type Call = { path: string; options: RestOptions };

function fakeClient(impl: (path: string, options: RestOptions) => Promise<unknown>) {
  const calls: Call[] = [];
  const client = {
    rest: async (path: string, options: RestOptions = {}) => {
      calls.push({ path, options });
      return impl(path, options);
    },
  } as unknown as SfdcClient;
  return { client, calls };
}

const decoded = (path: string) => decodeURIComponent(path);

const flowRecord = (id: string, definitionId = DEFINITION_ID) => ({
  Id: id,
  VersionNumber: 4,
  Status: 'Draft',
  MasterLabel: 'Synthetic Test Flow',
  DefinitionId: definitionId,
  ProcessType: 'AutoLaunchedFlow',
  LastModifiedDate: '2026-09-01T10:00:00.000+0000',
  Metadata: syntheticFlow,
});

const definitionRow = (latest: string | null, active: string | null) => ({
  records: [
    {
      Id: DEFINITION_ID,
      ActiveVersionId: active,
      ActiveVersion: active ? { VersionNumber: 3 } : null,
      LatestVersionId: latest,
      LatestVersion: latest ? { VersionNumber: 4 } : null,
    },
  ],
});

describe('parseFlowRoute', () => {
  it('extracts flowId (301 prefix Flow Version ID) from query string', () => {
    expect(parseFlowRoute(`${BUILDER}?flowId=${VERSION_ID}`)).toEqual({ kind: 'flowVersion', id: VERSION_ID });
  });

  it('extracts flowDefId (300 prefix FlowDefinition ID) from query string', () => {
    expect(parseFlowRoute(`${BUILDER}?flowDefId=${DEFINITION_ID}`)).toEqual({
      kind: 'flowDefinition',
      id: DEFINITION_ID,
    });
  });

  it('prefers flowId when both are present (more specific), ignoring other params', () => {
    const url = `${BUILDER}?flowDefId=${DEFINITION_ID}&flowId=${VERSION_ID}&sfdcIFrameOrigin=https%3A%2F%2Fmycompany.my.salesforce-setup.com&clc=1`;
    expect(parseFlowRoute(url)).toEqual({ kind: 'flowVersion', id: VERSION_ID });
  });

  it('recognises the Builder route with no ids as an unsaved flow', () => {
    expect(parseFlowRoute(BUILDER)).toEqual({ kind: 'unsavedFlow' });
    expect(parseFlowRoute(`${BUILDER}?processType=AutoLaunchedFlow`)).toEqual({ kind: 'unsavedFlow' });
  });

  it('returns notOnFlowPage for other Salesforce pages, non-URLs, and empty ids', () => {
    expect(parseFlowRoute('https://mycompany.lightning.force.com/lightning/setup/Flows/home')).toEqual({
      kind: 'notOnFlowPage',
    });
    expect(parseFlowRoute('not a url')).toEqual({ kind: 'notOnFlowPage' });
    expect(parseFlowRoute(`${BUILDER}?flowId=`)).toEqual({ kind: 'unsavedFlow' });
  });

  it('rejects ids that are not 15–18 alphanumerics before they can reach a query', () => {
    expect(parseFlowRoute(`${BUILDER}?flowId=301ABC`)).toEqual({ kind: 'unsavedFlow' });
    expect(parseFlowRoute(`${BUILDER}?flowId=${VERSION_ID}'+OR+1=1`)).toEqual({ kind: 'unsavedFlow' });
    expect(parseFlowRoute(`${BUILDER}?flowDefId=../../evil`)).toEqual({ kind: 'unsavedFlow' });
  });
});

describe('sameFlowRoute', () => {
  it('compares kind and id, not the raw URL', () => {
    const a = parseFlowRoute(`${BUILDER}?flowId=${VERSION_ID}&clc=1`);
    const b = parseFlowRoute(`${BUILDER}?clc=2&flowId=${VERSION_ID}`);
    expect(sameFlowRoute(a, b)).toBe(true);
    expect(sameFlowRoute(a, parseFlowRoute(`${BUILDER}?flowDefId=${DEFINITION_ID}`))).toBe(false);
    expect(sameFlowRoute({ kind: 'notOnFlowPage' }, { kind: 'notOnFlowPage' })).toBe(true);
    expect(sameFlowRoute({ kind: 'unsavedFlow' }, { kind: 'notOnFlowPage' })).toBe(false);
  });
});

describe('queryFlowDefinition', () => {
  it('SOQL fetches by LatestVersionId (NOT ActiveVersionId) — load-bearing invariant', async () => {
    // The definition query reads ActiveVersionId for the header tooltip, but
    // the version the panel loads is always the latest saved one.
    const { client, calls } = fakeClient(async () => definitionRow(LATEST_ID, ACTIVE_ID));
    const definition = await queryFlowDefinition(client, DEFINITION_ID);
    expect(decoded(calls[0]!.path)).toMatch(
      /^\/services\/data\/v67\.0\/tooling\/query\/\?q=SELECT Id, ActiveVersionId, ActiveVersion\.VersionNumber, LatestVersionId, LatestVersion\.VersionNumber FROM FlowDefinition WHERE Id = '300XXXX0000ABCDxyz'$/,
    );
    expect(definition).toEqual({
      Id: DEFINITION_ID,
      ActiveVersionId: ACTIVE_ID,
      ActiveVersionNumber: 3,
      LatestVersionId: LATEST_ID,
      LatestVersionNumber: 4,
    });

    const { client: client2, calls: calls2 } = fakeClient(async (path) =>
      path.includes('FlowDefinition') ? definitionRow(LATEST_ID, ACTIVE_ID) : flowRecord(LATEST_ID),
    );
    await extractFlow(client2, { kind: 'flowDefinition', id: DEFINITION_ID });
    expect(calls2[1]!.path).toContain(`/tooling/sobjects/Flow/${LATEST_ID}`);
    expect(calls2[1]!.path).not.toContain(ACTIVE_ID);
  });

  it('uses the Tooling API v67.0 query endpoint with a 20 s timeout and the caller signal', async () => {
    const controller = new AbortController();
    const { client, calls } = fakeClient(async () => definitionRow(LATEST_ID, null));
    await queryFlowDefinition(client, DEFINITION_ID, controller.signal);
    expect(calls[0]!.path).toMatch(/^\/services\/data\/v67\.0\/tooling\/query\/\?q=/);
    expect(calls[0]!.options).toEqual({ signal: controller.signal, timeoutMs: 20_000 });
    expect(RESOLUTION_TIMEOUT_MS).toBe(20_000);
  });

  it('returns null active fields when the flow has no active version', async () => {
    const { client } = fakeClient(async () => definitionRow(LATEST_ID, null));
    expect(await queryFlowDefinition(client, DEFINITION_ID)).toMatchObject({
      ActiveVersionId: null,
      ActiveVersionNumber: null,
      LatestVersionNumber: 4,
    });
  });

  it('returns null when there are zero records', async () => {
    const { client } = fakeClient(async () => ({ records: [] }));
    expect(await queryFlowDefinition(client, DEFINITION_ID)).toBeNull();
  });

  it('refuses an id that is not a Salesforce id before building SOQL', async () => {
    const { client, calls } = fakeClient(async () => ({ records: [] }));
    await expect(queryFlowDefinition(client, "300XYZ' OR 1=1")).rejects.toThrow(/invalid/i);
    expect(calls).toHaveLength(0);
  });
});

describe('fetchFlowRecord', () => {
  it('GETs /tooling/sobjects/Flow/<id> with a 45 s timeout and returns the full record', async () => {
    const controller = new AbortController();
    const { client, calls } = fakeClient(async () => flowRecord(VERSION_ID));
    const record = await fetchFlowRecord(client, VERSION_ID, controller.signal);
    expect(calls[0]!.path).toBe(`/services/data/v67.0/tooling/sobjects/Flow/${VERSION_ID}`);
    expect(calls[0]!.options).toEqual({ signal: controller.signal, timeoutMs: 45_000 });
    expect(FLOW_FETCH_TIMEOUT_MS).toBe(45_000);
    expect(record.Metadata).toEqual(syntheticFlow);
    expect(record).toMatchObject({ VersionNumber: 4, Status: 'Draft', DefinitionId: DEFINITION_ID });
  });

  it('refuses an id that is not a Salesforce id before building the path', async () => {
    const { client, calls } = fakeClient(async () => flowRecord(VERSION_ID));
    await expect(fetchFlowRecord(client, '../../limits')).rejects.toThrow(/invalid/i);
    expect(calls).toHaveLength(0);
  });
});

describe('extractFlow', () => {
  it('flowId (301) route: fetch the record, then the definition for the active version', async () => {
    const { client, calls } = fakeClient(async (path) =>
      path.includes('FlowDefinition') ? definitionRow(VERSION_ID, ACTIVE_ID) : flowRecord(VERSION_ID),
    );
    const loaded = await extractFlow(client, { kind: 'flowVersion', id: VERSION_ID });
    expect(loaded.record.Metadata).toEqual(syntheticFlow);
    expect(loaded.definition.ActiveVersionNumber).toBe(3);
    expect(calls.map((c) => c.path)[0]).toBe(`/services/data/v67.0/tooling/sobjects/Flow/${VERSION_ID}`);
    expect(decoded(calls[1]!.path)).toContain(`WHERE Id = '${DEFINITION_ID}'`);
  });

  it('flowDefId (300) route: resolve the latest version, then fetch it', async () => {
    const { client, calls } = fakeClient(async (path) =>
      path.includes('FlowDefinition') ? definitionRow(LATEST_ID, ACTIVE_ID) : flowRecord(LATEST_ID),
    );
    const loaded = await extractFlow(client, { kind: 'flowDefinition', id: DEFINITION_ID });
    expect(loaded.record.Id).toBe(LATEST_ID);
    expect(calls).toHaveLength(2);
    expect(decoded(calls[0]!.path)).toContain('LatestVersionId');
    expect(calls[1]!.path).toBe(`/services/data/v67.0/tooling/sobjects/Flow/${LATEST_ID}`);
  });

  it('passes the caller signal to both calls so navigation can cancel either', async () => {
    const controller = new AbortController();
    const { client, calls } = fakeClient(async (path) =>
      path.includes('FlowDefinition') ? definitionRow(LATEST_ID, null) : flowRecord(LATEST_ID),
    );
    await extractFlow(client, { kind: 'flowDefinition', id: DEFINITION_ID }, controller.signal);
    expect(calls.every((c) => c.options.signal === controller.signal)).toBe(true);
  });

  it('throws UnsavedFlowError when the definition has no saved version', async () => {
    const { client } = fakeClient(async () => definitionRow(null, null));
    await expect(extractFlow(client, { kind: 'flowDefinition', id: DEFINITION_ID })).rejects.toBeInstanceOf(
      UnsavedFlowError,
    );
  });

  it('throws typed errors for non-flow routes without calling Salesforce', async () => {
    const { client, calls } = fakeClient(async () => ({}));
    await expect(extractFlow(client, { kind: 'notOnFlowPage' })).rejects.toBeInstanceOf(NotOnFlowPageError);
    await expect(extractFlow(client, { kind: 'unsavedFlow' })).rejects.toBeInstanceOf(UnsavedFlowError);
    expect(calls).toHaveLength(0);
  });
});
