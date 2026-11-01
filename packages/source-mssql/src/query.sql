-- Everything dbtour needs from SQL Server, in one batch of seven result sets, read in this order by map.ts.
-- Reads the catalogue views only: a login with VIEW DEFINITION on the database is enough. That is why the
-- sizes come from sys.partitions and sys.allocation_units, catalogue views, rather than
-- sys.dm_db_partition_stats, which wants VIEW DATABASE STATE and would fail the whole batch without it.
SET NOCOUNT ON;

-- 1. The database
SELECT DB_NAME() AS [name],
       CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) AS [version],
       (SELECT TOP (1) CAST([value] AS nvarchar(max)) FROM sys.extended_properties WHERE class = 0 AND [name] = 'MS_Description') AS [description],
       CONVERT(nvarchar(33), SYSUTCDATETIME(), 127) + 'Z' AS [readAt];

-- 2. Tables and views, with each table's rows and bytes as the catalogue counts them (no row is read).
--    Rows are the heap's or the clustered index's (index_id 0 or 1); data bytes are those pages, index bytes
--    every other index's. A page is 8 KB. A view has no partitions, so its three are NULL.
SELECT s.[name] AS [schema],
       o.[name] AS [name],
       CASE o.[type] WHEN 'V' THEN 'view' ELSE 'table' END AS [kind],
       CAST(ep.[value] AS nvarchar(max)) AS [description],
       m.[definition] AS [definition],
       r.[rows] AS [rows],
       b.dataBytes AS [dataBytes],
       b.indexBytes AS [indexBytes]
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.extended_properties ep ON ep.class = 1 AND ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.[name] = 'MS_Description'
LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
-- Counted apart: joining the allocation units to the partitions repeats each partition's rows.
OUTER APPLY (SELECT SUM(p.[rows]) AS [rows] FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) r
OUTER APPLY (
    SELECT SUM(CASE WHEN p.index_id IN (0, 1) THEN au.used_pages ELSE 0 END) * 8192 AS dataBytes,
           SUM(CASE WHEN p.index_id > 1 THEN au.used_pages ELSE 0 END) * 8192 AS indexBytes
    FROM sys.partitions p
    -- In-row and row-overflow pages belong to the partition's hobt, large-object pages to the partition.
    JOIN sys.allocation_units au ON au.container_id = CASE WHEN au.[type] = 2 THEN p.partition_id ELSE p.hobt_id END
    WHERE p.object_id = o.object_id
) b
WHERE o.[type] IN ('U', 'V') AND o.is_ms_shipped = 0
ORDER BY s.[name], o.[name];

-- 3. Columns
SELECT s.[name] AS [schema],
       o.[name] AS [table],
       c.[name] AS [name],
       c.column_id AS [position],
       t.[name] AS [type],
       c.max_length AS [maxLength],
       c.[precision] AS [precision],
       c.scale AS [scale],
       c.is_nullable AS [nullable],
       c.is_identity AS [identity],
       d.[definition] AS [default],
       cc.[definition] AS [computed],
       CAST(ep.[value] AS nvarchar(max)) AS [description]
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id AND o.[type] IN ('U', 'V') AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints d ON d.object_id = c.default_object_id
LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.extended_properties ep ON ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.[name] = 'MS_Description'
ORDER BY s.[name], o.[name], c.column_id;

-- 4. Primary keys and unique constraints, one row per column
SELECT s.[name] AS [schema],
       o.[name] AS [table],
       kc.[name] AS [name],
       kc.[type] AS [kind],
       c.[name] AS [column],
       ic.key_ordinal AS [ordinal]
FROM sys.key_constraints kc
JOIN sys.objects o ON o.object_id = kc.parent_object_id AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id AND ic.key_ordinal > 0
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
ORDER BY s.[name], o.[name], kc.[name], ic.key_ordinal;

-- 5. Foreign keys, one row per column pair
SELECT fk.[name] AS [name],
       ps.[name] AS [schema],
       po.[name] AS [table],
       pc.[name] AS [column],
       rs.[name] AS [toSchema],
       ro.[name] AS [toTable],
       rc.[name] AS [toColumn],
       fkc.constraint_column_id AS [ordinal],
       fk.delete_referential_action_desc AS [onDelete],
       fk.update_referential_action_desc AS [onUpdate]
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.objects po ON po.object_id = fk.parent_object_id
JOIN sys.schemas ps ON ps.schema_id = po.schema_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.objects ro ON ro.object_id = fk.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = ro.schema_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
ORDER BY fk.[name], fkc.constraint_column_id;

-- 6. Indexes, one row per column, key columns then included ones
SELECT s.[name] AS [schema],
       o.[name] AS [table],
       i.[name] AS [name],
       i.is_unique AS [unique],
       i.is_primary_key AS [primary],
       c.[name] AS [column],
       ic.key_ordinal AS [ordinal],
       ic.is_included_column AS [included]
FROM sys.indexes i
JOIN sys.objects o ON o.object_id = i.object_id AND o.[type] IN ('U', 'V') AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.[name] IS NOT NULL AND i.[type] > 0
ORDER BY s.[name], o.[name], i.[name], ic.is_included_column, ic.key_ordinal, ic.index_column_id;

-- 7. Check constraints
SELECT s.[name] AS [schema],
       o.[name] AS [table],
       ck.[name] AS [name],
       ck.[definition] AS [definition],
       c.[name] AS [column]
FROM sys.check_constraints ck
JOIN sys.objects o ON o.object_id = ck.parent_object_id AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.columns c ON c.object_id = ck.parent_object_id AND c.column_id = ck.parent_column_id
ORDER BY s.[name], o.[name], ck.[name];
