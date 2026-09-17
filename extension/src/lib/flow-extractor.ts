// Reads a Flow's last saved metadata through the Tooling API. Ported from the
// earlier build build with the ids are validated before they
// reach a query or a path, the whole Flow record comes back (not just
// Metadata), the FlowDefinition's active version is fetched for the header
// tooltip, the Builder route with no ids is recognised as an unsaved flow,
// non-flow URLs throw a typed error, and every call carries a timeout that
// the active-flow hook can cancel on navigation.

import type { SfdcClient } from './sfdc-client';

export const TOOLING_API_VERSION = '67.0';
export const RESOLUTION_TIMEOUT_MS = 20_000;
export const FLOW_FETCH_TIMEOUT_MS = 45_000;

/** Salesforce ids are 15 or 18 alphanumeric characters; anything else never reaches SOQL. */
export const SF_ID_RE = /^[a-zA-Z0-9]{15,18}$/;

const BUILDER_PATH_RE = /\/builder_platform_interaction\/flowBuilder\.app$/i;

export type FlowRoute =
  | { kind: 'flowVersion'; id: string } // ?flowId=301… (preferred when both are present)
  | { kind: 'flowDefinition'; id: string } // ?flowDefId=300…
  | { kind: 'unsavedFlow' } // Flow Builder with no ids: a new flow that was never saved
  | { kind: 'notOnFlowPage' };

export function parseFlowRoute(url: string): FlowRoute {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'notOnFlowPage' };
  }
  const flowId = parsed.searchParams.get('flowId');
  if (flowId && SF_ID_RE.test(flowId)) return { kind: 'flowVersion', id: flowId };
  const flowDefId = parsed.searchParams.get('flowDefId');
  if (flowDefId && SF_ID_RE.test(flowDefId)) return { kind: 'flowDefinition', id: flowDefId };
  if (BUILDER_PATH_RE.test(parsed.pathname)) return { kind: 'unsavedFlow' };
  return { kind: 'notOnFlowPage' };
}

/** Two routes name the same thing; compared by parsed ids, never by raw URL. */
export function sameFlowRoute(a: FlowRoute, b: FlowRoute): boolean {
  if (a.kind !== b.kind) return false;
  if ('id' in a && 'id' in b) return a.id === b.id;
  return true;
}

export class NotOnFlowPageError extends Error {
  constructor() {
    super('This tab is not showing a saved Flow');
    this.name = 'NotOnFlowPageError';
  }
}

export class UnsavedFlowError extends Error {
  constructor() {
    super('This Flow has no saved version yet');
    this.name = 'UnsavedFlowError';
  }
}

export interface FlowRecord {
  Id: string;
  VersionNumber: number;
  Status: string;
  MasterLabel: string;
  DefinitionId: string;
  ProcessType: string;
  LastModifiedDate: string;
  Metadata: unknown;
}

export interface FlowDefinitionInfo {
  Id: string;
  ActiveVersionId: string | null;
  ActiveVersionNumber: number | null;
  LatestVersionId: string | null;
  LatestVersionNumber: number | null;
}

export interface LoadedFlow {
  record: FlowRecord;
  definition: FlowDefinitionInfo;
}

interface QueryResult<T> {
  records: T[];
}

interface FlowDefinitionRow {
  Id: string;
  ActiveVersionId: string | null;
  ActiveVersion: { VersionNumber: number } | null;
  LatestVersionId: string | null;
  LatestVersion: { VersionNumber: number } | null;
}

function assertSfId(id: string): void {
  if (!SF_ID_RE.test(id)) throw new Error('Invalid Salesforce id');
}

function queryPath(soql: string): string {
  return `/services/data/v${TOOLING_API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`;
}

/**
 * One query answers both "which version is the latest saved one" and "which
 * version is active", so the header can say "v4 · Draft; active version is v3".
 * When the tab names only a FlowDefinition, the version FETCHED is
 * LatestVersionId, never ActiveVersionId; a flowId in the tab is fetched as is.
 */
export async function queryFlowDefinition(
  client: SfdcClient,
  definitionId: string,
  signal?: AbortSignal,
): Promise<FlowDefinitionInfo | null> {
  assertSfId(definitionId);
  const soql =
    'SELECT Id, ActiveVersionId, ActiveVersion.VersionNumber, LatestVersionId, LatestVersion.VersionNumber ' +
    `FROM FlowDefinition WHERE Id = '${definitionId}'`;
  const result = await client.rest<QueryResult<FlowDefinitionRow>>(queryPath(soql), {
    signal,
    timeoutMs: RESOLUTION_TIMEOUT_MS,
  });
  const row = result.records[0];
  if (!row) return null;
  return {
    Id: row.Id,
    ActiveVersionId: row.ActiveVersionId ?? null,
    ActiveVersionNumber: row.ActiveVersion?.VersionNumber ?? null,
    LatestVersionId: row.LatestVersionId ?? null,
    LatestVersionNumber: row.LatestVersion?.VersionNumber ?? null,
  };
}

export async function fetchFlowRecord(
  client: SfdcClient,
  flowVersionId: string,
  signal?: AbortSignal,
): Promise<FlowRecord> {
  assertSfId(flowVersionId);
  return client.rest<FlowRecord>(
    `/services/data/v${TOOLING_API_VERSION}/tooling/sobjects/Flow/${flowVersionId}`,
    { signal, timeoutMs: FLOW_FETCH_TIMEOUT_MS },
  );
}

export async function extractFlow(
  client: SfdcClient,
  route: FlowRoute,
  signal?: AbortSignal,
): Promise<LoadedFlow> {
  if (route.kind === 'unsavedFlow') throw new UnsavedFlowError();
  if (route.kind === 'notOnFlowPage') throw new NotOnFlowPageError();

  if (route.kind === 'flowDefinition') {
    const definition = await queryFlowDefinition(client, route.id, signal);
    if (!definition?.LatestVersionId) throw new UnsavedFlowError();
    const record = await fetchFlowRecord(client, definition.LatestVersionId, signal);
    return { record, definition };
  }

  const record = await fetchFlowRecord(client, route.id, signal);
  const definition = await queryFlowDefinition(client, record.DefinitionId, signal);
  if (!definition) throw new UnsavedFlowError();
  return { record, definition };
}
