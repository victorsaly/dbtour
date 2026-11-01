// Everything the catalogue can say, filled in on the shop fixture's dbo.Orders and its columns: shared by
// the model, Markdown and page tests.
import type { Model } from '../../src/model.ts';

export function describe(model: Model): Model {
  const database = model.databases[0];
  database.collation = 'Latin1_General_CI_AS';
  database.properties = { Owner: 'Data team' };
  database.unread = ['sensitivity labels: the login lacks VIEW ANY SENSITIVITY CLASSIFICATION'];
  database.schemas[0].properties = { Purpose: 'Trading' };
  const orders = database.schemas[0].tables[1];
  Object.assign(orders, {
    properties: { Retention: '7 years' },
    created: '2024-01-02T09:00:00Z',
    altered: '2026-10-30T17:00:00Z',
    temporal: { history: 'dbo.OrdersHistory', start: 'ValidFrom', end: 'ValidTo' },
    memoryOptimised: 'schema and data',
    ledger: 'updatable',
    partitioning: { scheme: 'psByYear', function: 'pfByYear', column: 'CreatedAt', partitions: 12 },
    compression: 'page',
    changeTracking: true,
    cdc: true,
    triggers: [{ name: 'trOrdersAudit', timing: 'after', events: ['insert', 'update'], enabled: true, definition: 'CREATE TRIGGER trOrdersAudit ...' }],
    security: [{ policy: 'rls.Tenants', kind: 'filter', predicate: '([rls].[fnTenant]([TenantId]))', enabled: true }],
  });
  Object.assign(orders.columns[0], { identitySeed: '1', identityIncrement: '1', properties: { Source: 'checkout' } });
  Object.assign(orders.columns[2], { collation: 'Latin1_General_BIN2', sparse: true, masked: 'default()' });
  Object.assign(orders.columns[3], {
    encrypted: { type: 'deterministic', key: 'CEK_Auto1' },
    sensitivity: { label: 'Confidential', informationType: 'Financial', rank: 'medium' },
  });
  Object.assign(orders.indexes[0], { type: 'nonclustered', filter: '([Status]<(9))', disabled: true, properties: { Why: 'checkout lookups' } });
  Object.assign(orders.constraints[0], { properties: { Note: 'from 2019' } });
  const check = orders.constraints.find((c) => c.kind === 'check')!;
  Object.assign(check, { disabled: true, untrusted: true });
  Object.assign(database.relations[0], { untrusted: true });
  return model;
}

