import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('shipment action sends a route accepted by the API database enum', () => {
  const workflow = readFileSync(new URL('./WorkflowHub.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../../../../packages/db/prisma/schema.prisma', import.meta.url), 'utf8');
  const routes = schema.match(/enum ShipmentRoute\s*\{([^}]*)\}/)?.[1].match(/^\s*[A-Z_]+\s*$/gm)?.map((route) => route.trim());
  const selectedRoute = workflow.match(/createShipment\(\{ purchaseOrderId: row!\.id, route: '([^']+)'/)?.[1];

  assert.ok(routes?.length, 'ShipmentRoute enum must exist');
  assert.ok(selectedRoute, 'shipment action must specify a route');
  assert.ok(routes.includes(selectedRoute), `shipment route ${selectedRoute} is not accepted by the API`);
  assert.match(api, new RegExp(`route: [^;]*'${selectedRoute}'`));
});
