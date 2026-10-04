import { ENTITY_SPECS, type EntityKind } from './entity-specs';

/**
 * The largest number of bound parameters one statement may carry.
 *
 * Workerd's SQLite caps bound parameters per statement at about 100, which is far below the 999 that
 * a stock SQLite build allows and below the 32766 of a recent one, so this is measured against the
 * runtime rather than assumed. Both the multi-row upserts and every `IN (...)` list in the store are
 * chunked by it; exceeding it is a SQLITE_ERROR at execution time, not a graceful degradation.
 */
export const MAX_BINDINGS = 100;
export const ENTITY_TABLES: Record<EntityKind, string> = {
  uruns: 'urun',
  ureticis: 'uretici',
  'kdv-kategorisis': 'kdv_kategorisi',
  'urun-fiyats': 'urun_fiyat',
  'urun-fiyat-hesaps': 'urun_fiyat_hesap',
  kisilers: 'kisiler',
  satis: 'satis',
  'satis-stok-hareketleris': 'satis_stok_hareketleri',
  'stok-girisis': 'stok_girisi',
  giders: 'gider',
  virmen: 'virman',
  'borc-alacaks': 'borc_alacak',
  'kasa-hareketleris': 'kasa_hareketleri',
  'nobet-hareketleris': 'nobet_hareketleri',
  'uretici-odemeleris': 'uretici_odemeleri',
  'nobet-duzeltmeler': 'nobet_duzeltmeler',
};
export interface TableSpec {
  columns: string[];
  keys: string[];
  physical: string;
}
export const TABLES: Record<string, TableSpec> = {
  entities: { columns: ['kind', 'id', 'data'], keys: ['kind', 'id'], physical: 'business_entities' },
  tenant_meta: { columns: ['key', 'value'], keys: ['key'], physical: 'business_tenant_meta' },
  sequences: { columns: ['kind', 'value'], keys: ['kind'], physical: 'business_sequences' },
  users_snapshot: { columns: ['id', 'data'], keys: ['id'], physical: 'business_users_snapshot' },
  history: {
    columns: ['id', 'kind', 'entity_id', 'actor', 'operation', 'before_json', 'after_json', 'at'],
    keys: ['id'],
    physical: 'business_history',
  },
  outbox: { columns: ['id', 'payload', 'created_at', 'delivered_at', 'queued_at'], keys: ['id'], physical: 'business_outbox' },
  idempotency: { columns: ['key', 'fingerprint', 'response', 'created_at'], keys: ['key'], physical: 'business_idempotency' },
  backup_runs: { columns: ['id', 'created_at', 'metadata'], keys: ['id'], physical: 'business_backup_runs' },
  backup_records: {
    columns: ['run_id', 'section', 'ordinal', 'data'],
    keys: ['run_id', 'section', 'ordinal'],
    physical: 'business_backup_records',
  },
};
export function businessSchema(): string {
  const statements = [
    `CREATE TABLE business_versions(tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id),version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0));`,
    `CREATE TABLE business_write_guards(token TEXT PRIMARY KEY,matched INTEGER NOT NULL CHECK(matched=1));`,
  ];
  for (const [kind, table] of Object.entries(ENTITY_TABLES)) {
    const fields = Object.entries(ENTITY_SPECS[kind as EntityKind].fields).filter(([field]) => !['id', 'tenantId', 'data'].includes(field));
    const generated = fields.map(([field, spec]) => {
      const relation = spec.type === 'relation';
      const sqlType = ['integer', 'boolean'].includes(spec.type) || relation ? 'INTEGER' : 'TEXT';
      const path = `$.${field}${relation ? '.id' : ''}`;
      return `"${field}${relation ? 'Id' : ''}" ${sqlType} GENERATED ALWAYS AS (json_extract(data,'${path}')) VIRTUAL`;
    });
    statements.push(
      `CREATE TABLE ${table}(tenant_id INTEGER NOT NULL REFERENCES tenants(id),id INTEGER NOT NULL CHECK(id>0),data TEXT NOT NULL CHECK(json_valid(data)) CHECK(json_type(data,'$.id') IS 'integer' AND json_extract(data,'$.id')=id) CHECK(json_type(data,'$.tenantId') IS 'integer' AND json_extract(data,'$.tenantId')=tenant_id),${generated.join(',')},PRIMARY KEY(tenant_id,id));`,
    );
    for (const [name, path] of [
      ['date', '$.tarih'],
      ['user', '$.user.id'],
      ['product', '$.urun.id'],
      ['sale', '$.satis.id'],
    ])
      statements.push(`CREATE INDEX ${table}_${name} ON ${table}(tenant_id,json_extract(data,'${path}'),id);`);
  }
  statements.push(
    `CREATE VIEW business_entities AS ${[0, 4, 8, 12]
      .map(start => Object.entries(ENTITY_TABLES).slice(start, start + 4))
      .map(
        group =>
          `SELECT * FROM (${group.map(([kind, table]) => `SELECT tenant_id,'${kind}' AS kind,id,data FROM ${table}`).join(' UNION ALL ')})`,
      )
      .join(' UNION ALL ')};`,
  );
  for (const [name, spec] of Object.entries(TABLES)) {
    if (name === 'entities') continue;
    const columns = spec.columns.map(
      column =>
        `${column} ${['ordinal', 'entity_id'].includes(column) || (column === 'id' && ['users_snapshot', 'history'].includes(name)) || (name === 'sequences' && column === 'value') ? 'INTEGER' : 'TEXT'}${spec.keys.includes(column) ? ' NOT NULL' : ''}`,
    );
    statements.push(
      `CREATE TABLE ${spec.physical}(tenant_id INTEGER NOT NULL REFERENCES tenants(id),${columns.join(',')},PRIMARY KEY(tenant_id,${spec.keys.join(',')}));`,
    );
  }
  statements.push(`CREATE INDEX business_history_entity ON business_history(tenant_id,kind,entity_id,id);`);
  statements.push(`CREATE INDEX business_outbox_pending ON business_outbox(tenant_id,delivered_at,queued_at,created_at);`);
  statements.push(
    `CREATE TABLE report_files(tenant_id INTEGER NOT NULL REFERENCES tenants(id),key TEXT NOT NULL,uploaded TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>=0),metadata TEXT NOT NULL CHECK(json_valid(metadata)),content_type TEXT NOT NULL,PRIMARY KEY(tenant_id,key));`,
  );
  statements.push(
    `CREATE TABLE report_file_chunks(tenant_id INTEGER NOT NULL,key TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>=0),data BLOB NOT NULL,PRIMARY KEY(tenant_id,key,ordinal),FOREIGN KEY(tenant_id,key) REFERENCES report_files(tenant_id,key) ON DELETE CASCADE);`,
  );
  return statements.join('\n') + '\n';
}
