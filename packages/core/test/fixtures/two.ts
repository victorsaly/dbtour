// Two databases that each have a dbo.Customers, as two sources in one dbtour.yaml would: shared by the
// scoping tests in core and the page.
import type { Model, Table } from '../../src/model.ts';

function table(name: string, columns: string[]): Table {
  return { name, kind: 'table', columns: columns.map((c) => ({ name: c, type: 'int', nullable: false })), primaryKey: ['Id'], indexes: [], constraints: [] };
}

export function twoDatabases(): Model {
  return {
    dbtour: 1,
    databases: [
      {
        name: 'Sales',
        driver: 'mssql',
        schemas: [{ name: 'dbo', tables: [table('Customers', ['Id', 'Email']), table('Invoices', ['Id', 'CustomerId'])] }],
        relations: [{ from: { table: 'dbo.Invoices', columns: ['CustomerId'] }, to: { table: 'dbo.Customers', columns: ['Id'] } }],
      },
      {
        name: 'Billing',
        driver: 'mssql',
        schemas: [{ name: 'dbo', tables: [table('Customers', ['Id', 'Email']), table('Payments', ['Id', 'CustomerId'])] }],
        relations: [{ from: { table: 'dbo.Payments', columns: ['CustomerId'] }, to: { table: 'dbo.Customers', columns: ['Id'] } }],
      },
    ],
    apis: [],
    links: [],
    groups: [],
  };
}
