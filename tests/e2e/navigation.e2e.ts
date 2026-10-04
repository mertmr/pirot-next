import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { SYNTHETIC_PRODUCT } from './support';

test('restores the authenticated developer session', { tags: ['smoke'], session: 'developer' }, async ({ app, browser, screen }) => {
  await app.open('/');
  // The entities menu renders only when authenticated; the account menu renders
  // either way, so it cannot prove the session was restored.
  await expect(screen.getByTestId('entity')).toBeVisible();
  await app.open('/urun');
  await expect(screen.getByTestId('UrunHeading')).toBeVisible();
  await expect(browser.locator(`td:has-text("${SYNTHETIC_PRODUCT}")`)).toBeVisible();
});

test('agent navigates to product management', { tags: ['agentic'], session: 'developer' }, async ({ app, agent, browser }) => {
  await app.open('/');
  await agent.act('Open the Ürün product list from the Varlıklar menu.');
  await expect(browser).toHaveURL('/urun');
});
