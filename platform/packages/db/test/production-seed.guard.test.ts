import { assertSeedNotTargetingProduction } from '../src/production-seed.guard';
describe('seed production guard', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  test.each([['NODE_ENV', 'production'], ['DATABASE_URL', 'postgres://ojaqtsjpcjjhnmavjuue'], ['OBJECT_STORAGE_BUCKET', 'alzad-platform-prod'], ['NEXT_PUBLIC_API_BASE_URL', 'https://greenyellow-hawk-333467.hostingersite.com']])('fails closed for %s', (key, value) => { process.env = { ...original, NODE_ENV: 'test', [key]: value }; expect(() => assertSeedNotTargetingProduction()).toThrow(/SAFETY STOP/); });
});
