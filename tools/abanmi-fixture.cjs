// Local visual test fixture ONLY. Synthetic records, no database or credentials.
// Bind to loopback; never deploy or run alongside a real API on the same port.
const http = require('node:http');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const at = '2026-10-19T18:00:00.000Z';
const associations = Array.from({ length: 8 }, (_, i) => ({ id: id(i + 1), publicCode: `ASC-${i + 1}`, name: `جمعية اختبار العرض ${i + 1}`, region: i % 2 ? 'القصيم' : 'الرياض', city: i % 2 ? 'بريدة' : 'الرياض', status: 'ACTIVE' }));
const activities = Array.from({ length: 9 }, (_, i) => ({ id: id(500 + i), phaseOrder: 1, phaseName: 'مرحلة تنفيذ المشروع', mainActivityOrder: Math.floor(i / 3), mainActivityName: ['التهيئة والقبول', 'التوريد والاستلام', 'التوزيع والتسليم'][Math.floor(i / 3)], subActivityName: i % 3 ? ['تجهيز المستفيدين', 'تأكيد محاضر الاستلام'][i % 3 - 1] : null, status: ['COMPLETED', 'IN_PROGRESS', 'NOT_STARTED'][Math.floor(i / 3)], completionPercent: ['100', '40', '0'][Math.floor(i / 3)], startDate: '2026-10-01', endDate: '2026-11-01', evidenceUrl: 'https://example.org/project-evidence', evidence: [] }));
const applications = Array.from({ length: 80 }, (_, i) => ({ id: id(100 + i), publicCode: `APP-${i + 1}`, name: `جمعية اختبار الطلبات ذات الاسم الطويل ${i + 1}`, region: i % 2 ? 'القصيم' : 'الرياض', status: 'UNDER_REVIEW', eligibilityStatus: 'PASSED', selectionList: i % 3 ? 'MAIN' : 'RESERVE', processingStarted: true, submittedAt: at }));
const grouped = (rows, statusKey, statuses) => rows.flatMap(a => statuses.map(status => ({ associationId: a.id, [statusKey]: status, _count: { _all: 2 } })));
function report(q) {
  const rows = associations.filter(a => (!q.get('region') || a.region === q.get('region')) && (!q.get('associationId') || a.id === q.get('associationId')));
  return { generatedAt: at, filters: Object.fromEntries(['from', 'to', 'region', 'associationId'].map(k => [k, q.get(k)])),
    overall: { associations: rows.length, beneficiaries: rows.length * 4, approvedNeeds: rows.length * 2, devices: rows.length * 4, deliveries: rows.length * 4 }, associations: rows,
    byRegion: [...new Set(rows.map(a => a.region))].map(region => ({ region, associations: rows.filter(a => a.region === region).length })),
    applications: applications.filter(a => !q.get('region') || a.region === q.get('region')), beneficiariesAndNeeds: { beneficiaries: grouped(rows, 'reviewStatus', ['APPROVED', 'UNDER_REVIEW']), needs: grouped(rows, 'decisionStatus', ['APPROVED']).map(r => ({ ...r, deviceType: 'OVEN', fulfillmentStatus: 'DEVICE_READY' })) },
    devicesAndInventory: grouped(rows, 'status', ['DELIVERED', 'WAREHOUSE']).map(r => ({ ...r, deviceType: 'OVEN' })), deliveryAndExecution: grouped(rows, 'status', ['DELIVERY_CLOSED', 'PENDING_DELIVERY_APPROVAL']), participation: grouped(rows, 'status', ['ACTIVE']), associationClosure: [], projectClosure: null, activities,
    procurement: { receipts: grouped(rows, 'status', ['RECEIVED_COMPLETE']), shipments: grouped(rows, 'status', ['DISPATCHED']), purchaseOrders: grouped(rows, 'status', ['APPROVED']) }, allocations: grouped(rows, 'status', ['ACTIVE']), privacy: { beneficiaryPiiIncluded: false } };
}
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3180'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.writeHead(405); return res.end('{}'); }
  const url = new URL(req.url, 'http://localhost');
  let data;
  if (url.pathname.endsWith('/auth/me')) data = { id: id(999), publicCode: 'TEST-ABN', name: 'حساب اختبار بصري', role: 'ABANMI', associationId: null, mustChangePassword: false };
  else if (url.pathname.endsWith('/reports/abanmi')) data = report(url.searchParams);
  else if (url.pathname.endsWith('/reports/abanmi/activities')) data = activities;
  else if (url.pathname.endsWith('/reports/abanmi/explore')) data = { items: [{ id: id(800), publicCode: 'TEST-001', status: 'APPROVED', createdAt: at, association: associations[0], needs: [{ decisionStatus: 'APPROVED', deviceType: 'OVEN', fulfillmentStatus: 'DEVICE_READY' }] }], total: 1, page: 1, pageSize: 20 };
  else if (url.pathname.includes('/records/associations/')) data = { association: associations[0], participation: { status: 'ACTIVE', activatedAt: at, agreements: [{ status: 'SIGNED', signedByOrgAt: at, signedByZaadAt: at, fullyExecutedAt: at }] }, beneficiaries: grouped([associations[0]], 'reviewStatus', ['APPROVED']), inventory: grouped([associations[0]], 'status', ['DELIVERED', 'WAREHOUSE']), received: { goodQty: 4, damagedQty: 0, missingQty: 0 }, shipments: [] };
  else if (url.pathname.includes('/records/beneficiaries/')) data = { publicCode: 'BEN-TEST-001', reviewStatus: 'APPROVED', association: associations[0], needs: [{ publicCode: 'NEED-TEST-1', decisionStatus: 'APPROVED', deviceType: 'OVEN', fulfillmentStatus: 'DELIVERED' }], deviceAllocations: [{ device: { publicCode: 'DEVICE-TEST-1', deviceType: 'OVEN', status: 'DELIVERED' } }], deliveryMissions: [{ id: id(801), publicCode: 'DEL-TEST-1', status: 'DELIVERY_CLOSED', assignedAt: at }], _count: { deliveryMissions: 1 } };
  else if (url.pathname.includes('/records/deliveries/')) data = { publicCode: 'DEL-TEST-1', status: 'DELIVERY_CLOSED', association: associations[0], assignedAt: at, attempts: [{ id: id(802), publicCode: 'ATT-TEST-1', status: 'DELIVERED', attemptedAt: at, hasProof: true, hasSignature: true }], _count: { attempts: 1 } };
  else { res.writeHead(404); return res.end('{}'); }
  res.end(JSON.stringify(data));
}).listen(3001, '127.0.0.1', () => console.log('Synthetic ABANMI fixture ready at 127.0.0.1:3001'));
