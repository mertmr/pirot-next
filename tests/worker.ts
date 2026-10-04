import { WorkerEntrypoint } from 'cloudflare:workers';
import { deliverQueuedJob } from '../src/server/delivery';
import { handleApi } from '../src/server/http';
import { queryStats } from '../src/server/d1-store';
import { drainOutboxes, pruneTenantRetention, scheduleStockReports } from '../src/server/jobs';
import { object } from '../src/server/value';
import type { Env } from '../src/server/env';
export { CooperativeTenant } from '../src/server/tenant';

// Mirrors the production cron entrypoint so month-end scheduling is covered by
// the integration suite rather than only by the per-minute trigger in wrangler.
async function scheduled(env: Env, scheduledTime: number): Promise<void> {
  await scheduleStockReports(env, new Date(scheduledTime));
  await drainOutboxes(env);
}

export default {
  scheduled: async (event: ScheduledController, env: Env) => scheduled(env, event.scheduledTime),
  queue: async (batch: MessageBatch, env: Env) => {
    for (const message of batch.messages) {
      try {
        await deliverQueuedJob(object(message.body), env);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
  fetch: async (request: Request, env: Env) => {
    if (new URL(request.url).pathname === '/__test/read-stats') {
      if (request.method === 'POST') {
        queryStats.reads = 0;
        queryStats.writes = 0;
        return new Response(null, { status: 204 });
      }
      return Response.json(queryStats);
    }
    if (new URL(request.url).pathname === '/__test/deliver') {
      await deliverQueuedJob(object(await request.json()), env);
      return new Response(null, { status: 204 });
    }
    if (new URL(request.url).pathname === '/__test/drain') {
      await drainOutboxes(env);
      return new Response(null, { status: 204 });
    }
    if (new URL(request.url).pathname === '/__test/cron') {
      const { scheduledTime } = object(await request.json());
      const at = new Date(String(scheduledTime));
      if (Number.isNaN(at.getTime())) return new Response('invalid scheduledTime', { status: 400 });
      await scheduled(env, at.getTime());
      return new Response(null, { status: 204 });
    }
    if (new URL(request.url).pathname === '/__test/prune') {
      const { now } = object(await request.json());
      const at = new Date(String(now));
      if (Number.isNaN(at.getTime())) return new Response('invalid now', { status: 400 });
      await pruneTenantRetention(env, at.getTime());
      return new Response(null, { status: 204 });
    }
    return handleApi(request, env);
  },
};

export { PasswordHasher } from '../src/server/passwords';

export { JobDelivery } from '../src/server/delivery';

// Synthetic provider boundary used only by persistence/queue tests; it never sends external mail.
export class SyntheticEmailProvider extends WorkerEntrypoint<Env> {
  async send(message: unknown) {
    await this.env.DIRECTORY.prepare('INSERT INTO test_email_attempts(payload) VALUES (?)').bind(JSON.stringify(message)).run();
    const state = await this.env.DIRECTORY.prepare('SELECT enabled FROM test_email_control').first<{ enabled: number }>();
    if (!state?.enabled) throw new Error('Synthetic provider unavailable');
    return { messageId: crypto.randomUUID() };
  }
}
