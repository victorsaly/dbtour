-- Everything dbtour needs from SQL Server, in one batch of thirteen result sets, read in this order by map.ts.
-- Reads the catalogue views only: a login with VIEW DEFINITION on the database is enough. That is why the
-- sizes come from sys.partitions and sys.allocation_units, catalogue views, rather than
-- sys.dm_db_partition_stats, which wants VIEW DATABASE STATE and would fail the whole batch without it.
-- What only newer servers keep (temporal 2016, masking and Always Encrypted 2016, sensitivity labels 2019,
-- ledger 2022) is read through text the batch assembles after asking whether it exists, so an older server
-- returns NULL or an empty set there instead of failing. The labels alone want more than VIEW DEFINITION
-- (VIEW ANY SENSITIVITY CLASSIFICATION); set 1 says whether they were read.
SET NOCOUNT ON;

-- 1. The database
SELECT DB_NAME() AS [name],
       CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) AS [version],
       (SELECT TOP (1) CAST([value] AS nvarchar(max)) FROM sys.extended_properties WHERE class = 0 AND [name] = 'MS_Description') AS [description],
       CONVERT(nvarchar(33), SYSUTCDATETIME(), 127) + 'Z' AS [readAt],
       CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) AS [collation],
       CASE WHEN OBJECT_ID('sys.sensitivity_classifications') IS NULL THEN 'absent'
            WHEN HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW ANY SENSITIVITY CLASSIFICATION') = 1 THEN 'read'
            ELSE 'denied' END AS [labels];

-- 2. Tables and views, with each table's rows and bytes as the catalogue counts them (no row is read).
--    Rows are the heap's or the clustered index's (index_id 0 or 1); data bytes are those pages, index bytes
--    every other index's. A page is 8 KB. A view has no partitions, so its three are NULL.
SELECT s.[name] AS [schema],
       o.[name] AS [name],
       CASE o.[type] WHEN 'V' THEN 'view' ELSE 'table' END AS [kind],
       CAST(ep.[value] AS nvarchar(max)) AS [description],
       m.[definition] AS [definition],
       -- The server's clock, which is not always UTC: the date is what a reader wants.
       CONVERT(nvarchar(30), o.create_date, 126) AS [created],
       CONVERT(nvarchar(30), o.modify_date, 126) AS [altered],
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
    SELECT SUM(CASE WHEN u.index_id IN (0, 1) THEN u.used_pages ELSE 0 END) * 8192 AS dataBytes,
           SUM(CASE WHEN u.index_id > 1 THEN u.used_pages ELSE 0 END) * 8192 AS indexBytes
    FROM (
        -- In-row and row-overflow pages belong to the partition's hobt, large-object pages to the partition.
        SELECT p.index_id, au.used_pages
        FROM sys.partitions p
        JOIN sys.allocation_units au ON au.container_id = CASE WHEN au.[type] = 2 THEN p.partition_id ELSE p.hobt_id END
        WHERE p.object_id = o.object_id
        UNION ALL
        -- A columnstore's delta stores, rows not yet compressed, are hobts of their own that sys.partitions
        -- does not list: their pages are counted with the columnstore index they belong to.
        SELECT rg.index_id, au.used_pages
        FROM sys.column_store_row_groups rg
        JOIN sys.allocation_units au ON au.container_id = rg.delta_store_hobt_id
        WHERE rg.object_id = o.object_id AND rg.delta_store_hobt_id IS NOT NULL
    ) u
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
       CAST(ep.[value] AS nvarchar(max)) AS [description],
       c.collation_name AS [collation],
       c.is_sparse AS [sparse],
       -- COLUMNPROPERTY, not sys.columns.is_hidden: before SQL Server 2016 it answers NULL, the column would fail.
       CAST(COLUMNPROPERTY(c.object_id, c.[name], 'IsHidden') AS bit) AS [hidden],
       CAST(idc.seed_value AS nvarchar(40)) AS [identitySeed],
       CAST(idc.increment_value AS nvarchar(40)) AS [identityIncrement]
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id AND o.[type] IN ('U', 'V') AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints d ON d.object_id = c.default_object_id
LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.extended_properties ep ON ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.[name] = 'MS_Description'
LEFT JOIN sys.identity_columns idc ON idc.object_id = c.object_id AND idc.column_id = c.column_id
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
       fk.update_referential_action_desc AS [onUpdate],
       fk.is_disabled AS [disabled],
       fk.is_not_trusted AS [untrusted]
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
       ic.is_included_column AS [included],
       i.type_desc AS [type],
       i.filter_definition AS [filter],
       i.is_disabled AS [disabled]
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
       c.[name] AS [column],
       ck.is_disabled AS [disabled],
       ck.is_not_trusted AS [untrusted]
FROM sys.check_constraints ck
JOIN sys.objects o ON o.object_id = ck.parent_object_id AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.columns c ON c.object_id = ck.parent_object_id AND c.column_id = ck.parent_column_id
ORDER BY s.[name], o.[name], ck.[name];

-- 8. Extended properties, every name, on the database, schemas, tables, columns, constraints and indexes.
--    MS_Description comes along too; map.ts keeps it apart where it is already the description.
SELECT CAST('database' AS varchar(10)) AS [on], CAST(NULL AS sysname) AS [schema], CAST(NULL AS sysname) AS [table],
       CAST(NULL AS sysname) AS [item], ep.[name] AS [name], CAST(ep.[value] AS nvarchar(max)) AS [value]
FROM sys.extended_properties ep
WHERE ep.class = 0
UNION ALL
SELECT 'schema', s.[name], NULL, NULL, ep.[name], CAST(ep.[value] AS nvarchar(max))
FROM sys.extended_properties ep
JOIN sys.schemas s ON s.schema_id = ep.major_id
WHERE ep.class = 3
UNION ALL
SELECT CASE WHEN ep.minor_id = 0 THEN 'table' ELSE 'column' END, s.[name], o.[name], c.[name], ep.[name], CAST(ep.[value] AS nvarchar(max))
FROM sys.extended_properties ep
JOIN sys.objects o ON o.object_id = ep.major_id AND o.[type] IN ('U', 'V') AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
LEFT JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id
WHERE ep.class = 1
UNION ALL
SELECT 'constraint', s.[name], t.[name], k.[name], ep.[name], CAST(ep.[value] AS nvarchar(max))
FROM sys.extended_properties ep
JOIN sys.objects k ON k.object_id = ep.major_id AND k.[type] IN ('PK', 'UQ', 'F', 'C')
JOIN sys.objects t ON t.object_id = k.parent_object_id AND t.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE ep.class = 1 AND ep.minor_id = 0
UNION ALL
SELECT 'index', s.[name], o.[name], i.[name], ep.[name], CAST(ep.[value] AS nvarchar(max))
FROM sys.extended_properties ep
JOIN sys.indexes i ON i.object_id = ep.major_id AND i.index_id = ep.minor_id
JOIN sys.objects o ON o.object_id = i.object_id AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE ep.class = 7;

-- 9. What else the catalogue says about each table: temporal, memory-optimised, ledger, partitioned,
--    compressed, change tracking, change data capture. Assembled as text: a column the server is too old
--    to have is read as NULL. The literal starts as nvarchar(max) so the text is never cut at 4,000.
DECLARE @temporal bit = CASE WHEN COL_LENGTH('sys.tables', 'temporal_type') IS NOT NULL THEN 1 ELSE 0 END;
DECLARE @features nvarchar(max) = CAST(N'' AS nvarchar(max)) + N'
SELECT s.[name] AS [schema],
       t.[name] AS [table],
       ' + CASE WHEN @temporal = 1 THEN N't.temporal_type' ELSE N'CAST(NULL AS tinyint)' END + N' AS [temporalType],
       ' + CASE WHEN @temporal = 1 THEN N'OBJECT_SCHEMA_NAME(t.history_table_id)' ELSE N'CAST(NULL AS sysname)' END + N' AS [historySchema],
       ' + CASE WHEN @temporal = 1 THEN N'OBJECT_NAME(t.history_table_id)' ELSE N'CAST(NULL AS sysname)' END + N' AS [historyTable],
       ' + CASE WHEN @temporal = 1
                THEN N'(SELECT c.[name] FROM sys.periods p JOIN sys.columns c ON c.object_id = p.object_id AND c.column_id = p.start_column_id WHERE p.object_id = t.object_id)'
                ELSE N'CAST(NULL AS sysname)' END + N' AS [periodStart],
       ' + CASE WHEN @temporal = 1
                THEN N'(SELECT c.[name] FROM sys.periods p JOIN sys.columns c ON c.object_id = p.object_id AND c.column_id = p.end_column_id WHERE p.object_id = t.object_id)'
                ELSE N'CAST(NULL AS sysname)' END + N' AS [periodEnd],
       ' + CASE WHEN COL_LENGTH('sys.tables', 'is_memory_optimized') IS NOT NULL THEN N't.is_memory_optimized' ELSE N'CAST(0 AS bit)' END + N' AS [memoryOptimised],
       ' + CASE WHEN COL_LENGTH('sys.tables', 'durability_desc') IS NOT NULL THEN N't.durability_desc' ELSE N'CAST(NULL AS nvarchar(60))' END + N' AS [durability],
       ' + CASE WHEN COL_LENGTH('sys.tables', 'ledger_type_desc') IS NOT NULL THEN N't.ledger_type_desc' ELSE N'CAST(NULL AS nvarchar(60))' END + N' AS [ledger],
       t.is_tracked_by_cdc AS [cdc],
       CASE WHEN ct.object_id IS NULL THEN 0 ELSE 1 END AS [changeTracking],
       ps.[name] AS [scheme],
       pf.[name] AS [function],
       pc.[name] AS [partitionColumn],
       (SELECT COUNT(*) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS [partitions],
       -- The compression of every partition, comma-separated, since partitions may differ.
       STUFF((SELECT DISTINCT N'','' + p.data_compression_desc FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1) FOR XML PATH(N'''')), 1, 1, N'''') AS [compression]
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
LEFT JOIN sys.indexes i ON i.object_id = t.object_id AND i.index_id IN (0, 1)
LEFT JOIN sys.partition_schemes ps ON ps.data_space_id = i.data_space_id
LEFT JOIN sys.partition_functions pf ON pf.function_id = ps.function_id
LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.partition_ordinal = 1
LEFT JOIN sys.columns pc ON pc.object_id = ic.object_id AND pc.column_id = ic.column_id
LEFT JOIN sys.change_tracking_tables ct ON ct.object_id = t.object_id
WHERE t.is_ms_shipped = 0
ORDER BY s.[name], t.[name];';
EXEC sys.sp_executesql @features;

-- 10. Triggers on tables and views, one row per trigger and event. A trigger created WITH ENCRYPTION has no
--     definition to read.
SELECT s.[name] AS [schema],
       o.[name] AS [table],
       tr.[name] AS [name],
       tr.is_instead_of_trigger AS [insteadOf],
       tr.is_disabled AS [disabled],
       te.type_desc AS [event],
       m.[definition] AS [definition]
FROM sys.triggers tr
JOIN sys.objects o ON o.object_id = tr.parent_id AND o.[type] IN ('U', 'V') AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.trigger_events te ON te.object_id = tr.object_id
LEFT JOIN sys.sql_modules m ON m.object_id = tr.object_id
WHERE tr.parent_class = 1
ORDER BY s.[name], o.[name], tr.[name], te.[type];

-- 11. Row-level security predicates on each table (SQL Server 2016 on).
IF OBJECT_ID('sys.security_predicates') IS NOT NULL
    EXEC sys.sp_executesql N'
    SELECT s.[name] AS [schema],
           o.[name] AS [table],
           ps.[name] AS [policySchema],
           p.[name] AS [policy],
           p.is_enabled AS [enabled],
           sp.predicate_type_desc AS [kind],
           sp.operation_desc AS [operation],
           sp.predicate_definition AS [predicate]
    FROM sys.security_predicates sp
    JOIN sys.security_policies p ON p.object_id = sp.object_id
    JOIN sys.schemas ps ON ps.schema_id = p.schema_id
    JOIN sys.objects o ON o.object_id = sp.target_object_id
    JOIN sys.schemas s ON s.schema_id = o.schema_id
    ORDER BY s.[name], o.[name], p.[name], sp.security_predicate_id;';
ELSE
    SELECT TOP (0) CAST(NULL AS sysname) AS [schema];

-- 12. Masked and Always Encrypted columns (SQL Server 2016 on).
IF COL_LENGTH('sys.columns', 'encryption_type') IS NOT NULL AND OBJECT_ID('sys.masked_columns') IS NOT NULL
    EXEC sys.sp_executesql N'
    SELECT s.[name] AS [schema],
           o.[name] AS [table],
           c.[name] AS [column],
           mc.masking_function AS [masked],
           c.encryption_type_desc AS [encryption],
           k.[name] AS [key]
    FROM sys.columns c
    JOIN sys.objects o ON o.object_id = c.object_id AND o.[type] IN (''U'', ''V'') AND o.is_ms_shipped = 0
    JOIN sys.schemas s ON s.schema_id = o.schema_id
    LEFT JOIN sys.masked_columns mc ON mc.object_id = c.object_id AND mc.column_id = c.column_id AND mc.is_masked = 1
    LEFT JOIN sys.column_encryption_keys k ON k.column_encryption_key_id = c.column_encryption_key_id
    WHERE mc.object_id IS NOT NULL OR c.encryption_type IS NOT NULL;';
ELSE
    SELECT TOP (0) CAST(NULL AS sysname) AS [schema];

-- 13. Sensitivity labels on columns (SQL Server 2019 on, and Azure SQL, which fills them in from data
--     discovery), only when the login may read them. The nested IF keeps the permission's name, unknown to
--     an older server, from being asked about there.
DECLARE @labelsRead bit = 0;
IF OBJECT_ID('sys.sensitivity_classifications') IS NOT NULL
    IF HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW ANY SENSITIVITY CLASSIFICATION') = 1 SET @labelsRead = 1;
IF @labelsRead = 1
BEGIN
    DECLARE @labels nvarchar(max) = CAST(N'' AS nvarchar(max)) + N'
    SELECT s.[name] AS [schema],
           o.[name] AS [table],
           c.[name] AS [column],
           CAST(sc.label AS nvarchar(256)) AS [label],
           CAST(sc.information_type AS nvarchar(256)) AS [informationType],
           ' + CASE WHEN COL_LENGTH('sys.sensitivity_classifications', 'rank_desc') IS NOT NULL THEN N'sc.rank_desc' ELSE N'CAST(NULL AS nvarchar(60))' END + N' AS [rank]
    FROM sys.sensitivity_classifications sc
    JOIN sys.objects o ON o.object_id = sc.major_id AND o.is_ms_shipped = 0
    JOIN sys.schemas s ON s.schema_id = o.schema_id
    JOIN sys.columns c ON c.object_id = sc.major_id AND c.column_id = sc.minor_id
    WHERE sc.class = 1;';
    EXEC sys.sp_executesql @labels;
END
ELSE
    SELECT TOP (0) CAST(NULL AS sysname) AS [schema];
