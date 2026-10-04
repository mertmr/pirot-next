import { createReadStream } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parse as losslessParse, isLosslessNumber } from 'lossless-json';
import { ENTITY_SPECS, type EntityKind } from '../src/server/entity-specs';
import { buildManifest } from '../src/server/reconciliation-contract';
import { decimal, integer, date, object, type Entity, type JsonObject } from '../src/server/value';
export function normalize(kind: EntityKind, input: JsonObject): Entity {
  const row = { ...input, id: integer(input.id, true), tenantId: integer(input.tenantId, true) } as Entity;
  for (const [field, spec] of Object.entries(ENTITY_SPECS[kind].fields)) {
    if (row[field] == null) continue;
    if (spec.type === 'integer') row[field] = integer(row[field]);
    if (spec.type === 'decimal') row[field] = decimal(row[field]).toString();
    if (spec.type === 'date') row[field] = date(row[field]);
    if (spec.type === 'relation') row[field] = { id: integer(object(row[field]).id, true) };
  }
  return row;
}
export function manifest(
  tenantId: number,
  entities: Record<EntityKind, Entity[]>,
  historyCount: number,
  history: JsonObject[] = [],
): JsonObject {
  // The shape is defined once, in src/server/reconciliation-contract, so this
  // script and the running server cannot disagree about a financial digest.
  if (historyCount !== history.length) throw new Error(`History count ${historyCount} does not match the ${history.length} supplied rows`);
  return buildManifest(tenantId, entities, history);
}
function cleanLossless(value: unknown): unknown {
  if (isLosslessNumber(value)) return value.value;
  if (Array.isArray(value)) return value.map(cleanLossless);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanLossless(v)]));
  return value;
}
const sql = (value: unknown) =>
  value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`;
export async function prepare(source: string, destination: string, mappingPath?: string) {
  const output = resolve(destination);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const tenants = new Map<number, JsonObject>(),
    users: JsonObject[] = [],
    javers: JsonObject[] = [],
    audits: JsonObject[] = [],
    bundles = new Map<number, { entities: Record<EntityKind, Entity[]>; history: JsonObject[] }>();
  const mapping = mappingPath ? object(JSON.parse(await readFile(mappingPath, 'utf8'))) : {};
  const bundle = (tid: number) => {
    if (!bundles.has(tid))
      bundles.set(tid, {
        entities: Object.fromEntries(Object.keys(ENTITY_SPECS).map(k => [k, [] as Entity[]])) as Record<EntityKind, Entity[]>,
        history: [],
      });
    return bundles.get(tid)!;
  };
  let lineNumber = 0;
  for await (const line of createInterface({ input: createReadStream(source), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    lineNumber++;
    const input = object(JSON.parse(line)),
      data = object(input.data);
    if (input._type === 'entity') {
      const kind = String(input.kind) as EntityKind;
      if (!Object.hasOwn(ENTITY_SPECS, kind)) throw new Error(`Unknown entity kind on line ${lineNumber}`);
      const row = normalize(kind, data);
      bundle(row.tenantId).entities[kind].push(row);
    } else if (input._type === 'tenant') tenants.set(integer(data.id, true), { id: integer(data.id, true), tenantName: data.tenantName });
    else if (input._type === 'user') users.push(data);
    else if (input._type === 'javers') javers.push(data);
    else if (input._type === 'audit') audits.push(data);
    else throw new Error(`Unknown record type on line ${lineNumber}`);
  }
  const index = new Map<string, number>();
  for (const [tid, b] of bundles) {
    if (!tenants.has(tid)) throw new Error(`Missing tenant ${tid}`);
    for (const [kind, rows] of Object.entries(b.entities))
      for (const row of rows) {
        const key = `${kind}:${row.id}`;
        if (index.has(key)) throw new Error(`Duplicate legacy ID ${key}`);
        index.set(key, tid);
      }
  }
  const previous = new Map<string, JsonObject>();
  for (const entry of javers) {
    const name = String(entry.className).split('.').at(-1),
      kind = Object.keys(ENTITY_SPECS).find(k => ENTITY_SPECS[k as EntityKind].name === name) as EntityKind | undefined;
    if (!kind) continue;
    const id = integer(cleanLossless(losslessParse(String(entry.entityId))), true),
      key = `${kind}:${id}`,
      state = object(cleanLossless(losslessParse(String(entry.state || '{}'))));
    const tid = integer(state.tenantId ?? index.get(key) ?? mapping[key], true);
    if (!tenants.has(tid)) throw new Error(`Unknown history tenant for ${key}`);
    if (state.tenantId != null && index.has(key) && index.get(key) !== tid) throw new Error(`Historical tenant changed for ${key}`);
    if (!entry.at) throw new Error(`History timestamp lacks an instant: snapshot ${entry.id}; resolve explicitly before importing`);
    const normalized: JsonObject = { ...state, id, tenantId: tid };
    if (state.stok != null) normalized.stok = decimal(state.stok).toString();
    const before = previous.get(key) ?? null,
      after = entry.operation === 'TERMINAL' ? null : normalized;
    bundle(tid).history.push({
      tenantId: tid,
      kind,
      entity_id: id,
      actor: entry.author ?? 'legacy',
      operation: `LEGACY_${entry.operation}`,
      before_json: before ? JSON.stringify(before) : null,
      after_json: after ? JSON.stringify(after) : null,
      at: date(entry.at),
    });
    if (after) previous.set(key, after);
    else previous.delete(key);
  }
  const statements = ['-- Imported identities retain legacy BCrypt hashes; JWT sessions deliberately restart.', 'PRAGMA foreign_keys=ON;'];
  for (const [tid, t] of tenants) {
    bundle(tid);
    statements.push(`INSERT INTO tenants(id,tenant_name) VALUES (${tid},${sql(t.tenantName)});`);
  }
  const userTenants = new Map<string, number | null>();
  for (const u of users) {
    const id = integer(u.id, true),
      tid = u.tenant_id == null ? null : integer(u.tenant_id, true);
    if (tid && !tenants.has(tid)) throw new Error(`Missing tenant for user ID ${id}`);
    if (
      !/^[_.@a-z0-9-]{1,50}$/.test(String(u.login)) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(u.email)) ||
      !/^\$2[aby]\$\d\d\$/.test(String(u.password_hash))
    )
      throw new Error(`Identity needs repair before import: user ID ${id}`);
    const authorities = u.authorities as string[];
    if (!Array.isArray(authorities) || authorities.some(a => !['ROLE_USER', 'ROLE_ADMIN'].includes(a)))
      throw new Error(`Unknown authority for user ID ${id}`);
    userTenants.set(String(u.login), tid);
    const fields = [
      'id',
      'login',
      'email',
      'password_hash',
      'first_name',
      'last_name',
      'lang_key',
      'activated',
      'tenant_id',
      'authorities',
      'activation_key',
      'reset_key',
      'reset_date',
      'created_by',
      'created_date',
      'last_modified_by',
      'last_modified_date',
    ];
    const values = [
      id,
      u.login,
      u.email,
      u.password_hash,
      u.first_name,
      u.last_name,
      u.lang_key ?? 'tr',
      u.activated ? 1 : 0,
      tid,
      JSON.stringify(authorities),
      u.activation_key,
      u.reset_key,
      u.reset_date,
      u.created_by ?? 'legacy',
      u.created_date ?? new Date().toISOString(),
      u.last_modified_by,
      u.last_modified_date,
    ];
    statements.push(`INSERT INTO users(${fields.join(',')}) VALUES (${values.map(sql).join(',')});`);
  }
  for (const a of audits)
    statements.push(
      `INSERT INTO auth_audit(id,principal,tenant_id,event_type,event_date,data) VALUES (${integer(a.id, true)},${sql(a.principal)},${sql(userTenants.get(String(a.principal)) ?? null)},${sql(a.event_type)},${sql(a.event_date)},${sql(JSON.stringify(a.data ?? {}))});`,
    );
  await writeFile(resolve(output, 'directory.sql'), statements.join('\n') + '\n', { mode: 0o600 });
  await writeFile(resolve(output, 'legacy-audit-archive.ndjson'), javers.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  for (const [tid, b] of bundles) {
    const data = {
      schemaVersion: 1,
      tenantId: tid,
      session: crypto.randomUUID(),
      entities: b.entities,
      history: b.history,
      expected: manifest(tid, b.entities, b.history.length, b.history),
    };
    await writeFile(resolve(output, `tenant-${tid}.json`), JSON.stringify(data), { mode: 0o600 });
  }
  console.log(`Prepared ${bundles.size} tenant bundles and ${users.length} identities in ${output}. No database was modified.`);
}
if (process.argv[1]?.endsWith('prepare-migration.ts')) {
  const [source, destination, mapping] = process.argv.slice(2);
  if (!source || !destination)
    throw new Error('Usage: bun scripts/prepare-migration.ts /secure/export.ndjson /secure/bundles [explicit-history-ownership.json]');
  await prepare(source, destination, mapping);
}
