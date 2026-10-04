import { deliverQueuedJob } from './server/delivery';
import handler from '@tanstack/react-start/server-entry';
import { handleApi } from './server/http';
import { drainOutboxes, pruneTenantRetention, scheduleStockReports } from './server/jobs';
import { object } from './server/value';
import type { Env } from './server/env';
export { CooperativeTenant } from './server/tenant';
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/management/')) return handleApi(request, env, ctx);
    return handler.fetch(request);
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await scheduleStockReports(env);
    await drainOutboxes(env);
    await pruneTenantRetention(env);
  },
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      try {
        await deliverQueuedJob(object(message.body), env);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

export { PasswordHasher } from './server/passwords';

export { JobDelivery } from './server/delivery';
