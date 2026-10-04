import { files } from './files';
import { outboundEmailEnabled } from './email-policy';
import type { Env } from './env';
import { boundRequestBody } from './request-body';
import { authenticate, authRoute, admin, principal, type UserRow } from './auth';
import { drainTenantOutbox, drainOutboxes } from './jobs';
import { errorResponse } from './errors';
import { BusinessError, object, text } from './value';
export async function handleApi(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    request = await boundRequestBody(request);
    const path = new URL(request.url).pathname;
    if (path === '/management/health') {
      const row = await env.DIRECTORY.prepare('SELECT 1 AS ok').first();
      return secure(Response.json({ status: row ? 'UP' : 'DOWN' }, { status: row ? 200 : 503 }));
    }
    if (path === '/management/info')
      return Response.json({
        activeProfiles: [env.ENVIRONMENT === 'development' ? 'dev' : 'prod'],
        'display-ribbon-on-profiles': env.ENVIRONMENT === 'development' ? 'dev' : '',
        features: { outboundEmail: outboundEmailEnabled(env) },
        git: { branch: 'cloudflare' },
        build: { name: 'Pirot', version: '2.0.0' },
      });
    const publicPaths = [
      '/api/authenticate',
      '/api/activate',
      '/api/account/reset-password/init',
      '/api/account/reset-password/finish',
      '/api/internal/bootstrap',
    ];
    if (publicPaths.includes(path)) {
      const result = await authRoute(request, env);
      if (result) return secure(result);
    }
    const user = await authenticate(request, env);
    const auth = await authRoute(request, env, user);
    if (auth) {
      if (ctx && request.method !== 'GET') ctx.waitUntil(drainOutboxes(env));
      return secure(auth);
    }
    if (path.startsWith('/management/')) {
      admin(user);
      return secure(await management(request, env, user));
    }
    if (!path.startsWith('/api/')) throw new BusinessError('notfound', 404);
    if (path.startsWith('/api/_internal/')) throw new BusinessError('notfound', 404);
    if (path.startsWith('/api/admin/tenant-')) {
      admin(user);
      const body = object(await request.json());
      const tid = Number(body.tenantId);
      if (!Number.isSafeInteger(tid) || tid <= 0 || !(await env.DIRECTORY.prepare('SELECT id FROM tenants WHERE id=?').bind(tid).first()))
        throw new BusinessError('notfound', 404);
      const actor = { id: 0, login: 'migration-operator:' + user.login, tenantId: tid, authorities: ['ROLE_ADMIN'] };
      const action = path.slice('/api/admin/tenant-import/'.length);
      const endpoint =
        path.startsWith('/api/admin/tenant-import/') && ['begin', 'batch', 'history', 'finish', 'abort', 'status'].includes(action)
          ? `_internal/import/${action}`
          : path.startsWith('/api/admin/tenant-backup/') && ['begin', 'page', 'release'].includes(path.split('/').at(-1)!)
            ? `_internal/backup/${path.split('/').at(-1)}`
            : path === '/api/admin/tenant-export'
              ? '_internal/snapshot'
              : path === '/api/admin/tenant-reconciliation'
                ? '_internal/reconciliation'
                : null;
      if (!endpoint) throw new BusinessError('notfound', 404);
      const members = await env.DIRECTORY.prepare(
        'SELECT id,login,first_name AS firstName,last_name AS lastName,email,tenant_id AS tenantId FROM users WHERE tenant_id=?',
      )
        .bind(tid)
        .all();
      const response = await env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tid}`)).fetch(`https://tenant/api/${endpoint}`, {
        method: endpoint.endsWith('snapshot') ? 'GET' : 'POST',
        headers: {
          'x-pirot-principal': JSON.stringify(actor),
          'x-pirot-members': JSON.stringify(members.results),
          'idempotency-key': request.headers.get('idempotency-key') ?? '',
          'content-type': 'application/json',
        },
        body: endpoint.endsWith('snapshot') ? undefined : JSON.stringify(body),
      });
      return secure(response);
    }
    if (path === '/api/report-files' && request.method === 'GET') {
      const actor = principal(user),
        result = await files(env).list({ prefix: `tenant/${actor.tenantId}/reports/stock/`, include: ['customMetadata'], limit: 1000 });
      return Response.json(
        result.objects.map(file => ({
          id: file.key
            .split('/')
            .at(-1)!
            .replace(/\.xlsx$/, ''),
          uploaded: file.uploaded.toISOString(),
          size: file.size,
          month: file.customMetadata?.month ?? '',
        })),
      );
    }
    if (path.startsWith('/api/report-files/') && request.method === 'GET') {
      const actor = principal(user),
        id = path.split('/')[3];
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new BusinessError('notfound', 404);
      const file = await files(env).get(`tenant/${actor.tenantId}/reports/stock/${id}.xlsx`);
      if (!file) throw new BusinessError('notfound', 404);
      return new Response(file.body, {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="stok-raporu-${id}.xlsx"`,
          'cache-control': 'no-store',
        },
      });
    }
    const actor = principal(user),
      headers = new Headers(request.headers);
    headers.set('x-pirot-principal', JSON.stringify(actor));
    // Snapshots allow assigned cooperative users to be resolved without trusting browser ownership.
    const members = await env.DIRECTORY.prepare(
      'SELECT id,login,first_name AS firstName,last_name AS lastName,email,lang_key AS langKey,tenant_id AS tenantId FROM users WHERE tenant_id=?',
    )
      .bind(actor.tenantId)
      .all();
    headers.set('x-pirot-members', JSON.stringify(members.results));
    const forwarded = new Request(request, { headers });
    const result = await env.TENANTS.get(env.TENANTS.idFromName(`tenant:${actor.tenantId}`)).fetch(forwarded);
    if (ctx && result.ok && request.method !== 'GET') ctx.waitUntil(drainTenantOutbox(env, actor.tenantId));
    return secure(result);
  } catch (error) {
    return secure(errorResponse(error, request));
  }
}
function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'same-origin');
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}
async function management(request: Request, env: Env, user: UserRow): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === '/management/health' || path === '/management/health/readiness' || path === '/management/health/liveness') {
    const row = await env.DIRECTORY.prepare('SELECT 1 AS ok').first();
    return Response.json({ status: row ? 'UP' : 'DOWN', components: { directory: { status: row ? 'UP' : 'DOWN' } } });
  }
  if (path === '/management/jhiopenapigroups') return Response.json([]);
  if (path === '/management/audits' || path.startsWith('/management/audits/')) {
    const id = path.split('/')[3];
    if (id) {
      const result = await env.DIRECTORY.prepare(
        'SELECT id,principal,event_type AS auditEventType,event_date AS auditEventDate,data FROM auth_audit WHERE id=? AND tenant_id=?',
      )
        .bind(Number(id), user.tenant_id)
        .first();
      if (!result) throw new BusinessError('notfound', 404);
      return Response.json(result);
    }
    const page = Number(url.searchParams.get('page') ?? 0),
      size = Math.min(1000, Number(url.searchParams.get('size') ?? 20));
    if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1) throw new BusinessError('invalidrequest');
    const from = url.searchParams.get('fromDate') ?? '0000',
      to = url.searchParams.get('toDate') ? url.searchParams.get('toDate') + 'T23:59:59.999Z' : '9999';
    const [rows, count] = await Promise.all([
      env.DIRECTORY.prepare(
        'SELECT id,principal,event_type AS auditEventType,event_date AS auditEventDate,data FROM auth_audit WHERE tenant_id=? AND event_date>=? AND event_date<=? ORDER BY id DESC LIMIT ? OFFSET ?',
      )
        .bind(user.tenant_id, from, to, size, page * size)
        .all(),
      env.DIRECTORY.prepare('SELECT count(*) AS n FROM auth_audit WHERE tenant_id=? AND event_date>=? AND event_date<=?')
        .bind(user.tenant_id, from, to)
        .first<{ n: number }>(),
    ]);
    return Response.json(
      rows.results.map(r => ({ ...r, data: JSON.parse(text(r.data)) })),
      { headers: { 'x-total-count': String(count?.n ?? 0) } },
    );
  }
  throw new BusinessError('notfound', 404);
}
