import { BusinessError } from './value';
const CHUNK_SIZE = 500000;
interface FileOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}
interface FileRow {
  key: string;
  uploaded: string;
  size: number;
  metadata: string;
}
function owner(key: string): number {
  const match = /^tenant\/(\d+)\/reports\/stock\/[a-f0-9-]{36}\.xlsx$/.exec(key);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) throw new BusinessError('invalidrequest');
  return Number(match[1]);
}
// Files are ordinary SQLite BLOB chunks, included in the same portable D1 export.
export class D1Files {
  constructor(readonly db: D1Database) {}
  async put(key: string, value: Uint8Array, options: FileOptions = {}) {
    const tenant = owner(key),
      uploaded = new Date().toISOString();
    const queries = [
      this.db
        .prepare(
          'INSERT INTO report_files(tenant_id,key,uploaded,size,metadata,content_type) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET size=excluded.size,metadata=excluded.metadata,content_type=excluded.content_type',
        )
        .bind(
          tenant,
          key,
          uploaded,
          value.byteLength,
          JSON.stringify(options.customMetadata ?? {}),
          options.httpMetadata?.contentType ?? 'application/octet-stream',
        ),
      this.db.prepare('DELETE FROM report_file_chunks WHERE tenant_id=? AND key=?').bind(tenant, key),
    ];
    for (let offset = 0; offset < value.byteLength; offset += CHUNK_SIZE)
      queries.push(
        this.db
          .prepare('INSERT INTO report_file_chunks(tenant_id,key,ordinal,data) VALUES (?,?,?,?)')
          .bind(tenant, key, offset / CHUNK_SIZE, value.slice(offset, offset + CHUNK_SIZE).buffer),
      );
    await this.db.batch(queries);
  }
  async get(key: string) {
    const tenant = owner(key);
    const results = await this.db.batch([
      this.db.prepare('SELECT key,uploaded,size,metadata FROM report_files WHERE tenant_id=? AND key=?').bind(tenant, key),
      this.db.prepare('SELECT data FROM report_file_chunks WHERE tenant_id=? AND key=? ORDER BY ordinal').bind(tenant, key),
    ]);
    const row = results[0].results[0] as unknown as FileRow | undefined;
    if (!row) return null;
    const pieces = results[1].results.map(r => {
      const data = (r as { data: unknown }).data;
      if (Array.isArray(data)) return Uint8Array.from(data as number[]);
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      throw new Error('Invalid persisted file chunk');
    });
    const bytes = new Uint8Array(row.size);
    let offset = 0;
    for (const piece of pieces) {
      bytes.set(piece, offset);
      offset += piece.byteLength;
    }
    if (offset !== row.size) throw new Error('Incomplete persisted report file');
    return {
      body: bytes,
      arrayBuffer: async () => bytes.buffer,
      size: row.size,
      uploaded: new Date(row.uploaded),
      customMetadata: JSON.parse(row.metadata) as Record<string, string>,
    };
  }
  async list(options: { prefix: string; include?: string[]; limit?: number }) {
    const match = /^tenant\/(\d+)\/reports\/stock\/$/.exec(options.prefix);
    if (!match) throw new BusinessError('invalidrequest');
    const rows = await this.db
      .prepare('SELECT key,uploaded,size,metadata FROM report_files WHERE tenant_id=? ORDER BY uploaded DESC,key LIMIT ?')
      .bind(Number(match[1]), Math.min(options.limit ?? 1000, 1000))
      .all<FileRow>();
    return {
      objects: rows.results.map(r => ({
        key: r.key,
        uploaded: new Date(r.uploaded),
        size: r.size,
        customMetadata: JSON.parse(r.metadata) as Record<string, string>,
      })),
    };
  }
}
export function files(env: { DIRECTORY: D1Database }): D1Files {
  return new D1Files(env.DIRECTORY);
}
