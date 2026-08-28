import { assertE2eNotTargetingProduction } from '../../test/utils/production-target.guard';
describe('destructive e2e production guard', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  test.each([
    ['NODE_ENV', 'production'], ['DATABASE_URL', 'postgres://x@db.ojaqtsjpcjjhnmavjuue.supabase.co/x'],
    ['OBJECT_STORAGE_BUCKET', 'alzad-platform-prod'], ['API_BASE_URL', 'https://floralwhite-tapir-393693.hostingersite.com/api/v1'],
  ])('fails closed for %s', (key, value) => { process.env = { ...original, NODE_ENV: 'test', [key]: value }; expect(() => assertE2eNotTargetingProduction()).toThrow(/SAFETY STOP/); });
});
