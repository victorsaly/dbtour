-- A small shop, as SQLite keeps it: the comments inside each CREATE are what dbtour reads as descriptions.
CREATE TABLE customers ( -- Everyone who has bought from the shop.
  id INTEGER PRIMARY KEY, -- Given by SQLite.
  email TEXT NOT NULL UNIQUE COLLATE NOCASE, -- Where receipts go.
  name TEXT
);

CREATE TABLE orders ( -- One row per order a customer placed.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE, -- Who placed it.
  placed_at TEXT NOT NULL DEFAULT (datetime('now')),
  total REAL NOT NULL DEFAULT 0 CHECK (total >= 0), -- In pounds, VAT included.
  total_pence INTEGER GENERATED ALWAYS AS (CAST(round(total * 100) AS INTEGER)) VIRTUAL
) STRICT;

CREATE TABLE order_lines (
  order_id INTEGER NOT NULL REFERENCES orders,
  line INTEGER NOT NULL,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  CONSTRAINT pk_order_lines PRIMARY KEY (order_id, line),
  CONSTRAINT qty_positive CHECK (qty > 0)
) WITHOUT ROWID;

CREATE INDEX ix_orders_customer ON orders (customer_id, placed_at DESC);
CREATE INDEX ix_orders_open ON orders (placed_at) WHERE total = 0;
CREATE UNIQUE INDEX ix_customers_lower ON customers (lower(name));

CREATE VIEW big_orders AS SELECT id, total FROM orders WHERE total > 100;

CREATE TRIGGER orders_placed AFTER INSERT ON orders BEGIN SELECT 1; END;

INSERT INTO customers (email, name) VALUES ('ada@example.com', 'Ada'), ('alan@example.com', 'Alan');
INSERT INTO orders (customer_id, total) VALUES (1, 120), (1, 30), (2, 0);
INSERT INTO order_lines VALUES (1, 1, 'TEA', 2), (1, 2, 'CUP', 1), (2, 1, 'TEA', 1);
