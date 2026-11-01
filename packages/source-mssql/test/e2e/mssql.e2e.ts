// Against a real SQL Server. Set DBTOUR_E2E_MSSQL to a connection string for a database the login may create
// a schema in (`npm run e2e:mssql` starts one in Docker and sets it); without it, this test is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { extract } from '../../src/index.ts';

const connection = process.env.DBTOUR_E2E_MSSQL;

const setup = `
CREATE SCHEMA dbtour_e2e;
GO
CREATE TABLE dbtour_e2e.Customers (
  Id int IDENTITY PRIMARY KEY,
  Email nvarchar(320) NOT NULL CONSTRAINT UQ_e2e_Customers_Email UNIQUE,
  Notes varchar(max) NULL
);
CREATE TABLE dbtour_e2e.Orders (
  Id int IDENTITY CONSTRAINT PK_e2e_Orders PRIMARY KEY,
  CustomerId int NOT NULL CONSTRAINT FK_e2e_Orders_Customers REFERENCES dbtour_e2e.Customers (Id),
  Status tinyint NOT NULL CONSTRAINT DF_e2e_Orders_Status DEFAULT 0,
  Net decimal(18,2) NOT NULL,
  Total AS (Net * 1.2),
  CONSTRAINT CK_e2e_Orders_Status CHECK (Status <= 9)
);
CREATE INDEX IX_e2e_Orders_CustomerId ON dbtour_e2e.Orders (CustomerId) INCLUDE (Status);
CREATE TABLE dbtour_e2e.OrderLines (
  OrderId int NOT NULL CONSTRAINT FK_e2e_OrderLines_Orders REFERENCES dbtour_e2e.Orders (Id) ON DELETE CASCADE,
  LineNo smallint NOT NULL,
  Quantity int NOT NULL,
  CONSTRAINT PK_e2e_OrderLines PRIMARY KEY (OrderId, LineNo)
);
CREATE TABLE dbtour_e2e.Shipments (
  Id uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
  OrderId int NOT NULL,
  LineNo smallint NOT NULL,
  CONSTRAINT FK_e2e_Shipments_OrderLines FOREIGN KEY (OrderId, LineNo) REFERENCES dbtour_e2e.OrderLines (OrderId, LineNo)
);
GO
CREATE VIEW dbtour_e2e.vOrderTotals AS SELECT OrderId, SUM(Quantity) AS Total FROM dbtour_e2e.OrderLines GROUP BY OrderId;
GO
EXEC sys.sp_addextendedproperty @name = 'MS_Description', @value = 'One row per account.', @level0type = 'SCHEMA', @level0name = 'dbtour_e2e', @level1type = 'TABLE', @level1name = 'Customers';
EXEC sys.sp_addextendedproperty @name = 'MS_Description', @value = 'Login address.', @level0type = 'SCHEMA', @level0name = 'dbtour_e2e', @level1type = 'TABLE', @level1name = 'Customers', @level2type = 'COLUMN', @level2name = 'Email';
`;

const teardown = `
DROP VIEW IF EXISTS dbtour_e2e.vOrderTotals;
DROP TABLE IF EXISTS dbtour_e2e.Shipments, dbtour_e2e.OrderLines, dbtour_e2e.Orders, dbtour_e2e.Customers;
DROP SCHEMA IF EXISTS dbtour_e2e;
`;

async function run(batch: string): Promise<void> {
  const pool = await new sql.ConnectionPool(connection!).connect();
  try {
    for (const statement of batch.split(/^GO$/m)) {
      if (statement.trim()) await pool.request().batch(statement);
    }
  } finally {
    await pool.close();
  }
}

test('extract reads a real SQL Server', { skip: connection ? false : 'DBTOUR_E2E_MSSQL is not set' }, async () => {
  await run(teardown);
  await run(setup);
  try {
    const database = await extract({ type: 'mssql', name: 'E2E', connection });
    const schema = database.schemas.find((s) => s.name === 'dbtour_e2e');
    assert.ok(schema, 'the dbtour_e2e schema is in the model');
    assert.deepEqual(schema.tables.map((t) => `${t.name}:${t.kind}`), ['Customers:table', 'OrderLines:table', 'Orders:table', 'Shipments:table', 'vOrderTotals:view']);
    const customers = schema.tables[0];
    assert.equal(customers.description, 'One row per account.');
    assert.deepEqual(customers.columns.map((c) => c.type), ['int', 'nvarchar(320)', 'varchar(max)']);
    assert.equal(customers.columns[1].description, 'Login address.');
    assert.equal(customers.columns[0].identity, true);
    const orders = schema.tables[2];
    assert.equal(orders.columns.find((c) => c.name === 'Total')!.computed, '([Net]*(1.2))');
    assert.equal(orders.columns.find((c) => c.name === 'Status')!.default, '((0))');
    assert.deepEqual(orders.indexes, [{ name: 'IX_e2e_Orders_CustomerId', columns: ['CustomerId'], unique: false, included: ['Status'] }]);
    assert.deepEqual(schema.tables[1].primaryKey, ['OrderId', 'LineNo']);
    const shipments = database.relations.find((r) => r.name === 'FK_e2e_Shipments_OrderLines')!;
    assert.deepEqual(shipments.from.columns, ['OrderId', 'LineNo']);
    assert.equal(database.relations.find((r) => r.name === 'FK_e2e_OrderLines_Orders')!.onDelete, 'CASCADE');
  } finally {
    await run(teardown);
  }
});
