import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationV2Service } from './application-v2.service';
import { APPLICANT_SESSION_COOKIE, APPLICANT_SESSION_TTL_SECONDS, ApplicationAccessService } from './application-access.service';

describe('applicant session cookie persistence', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;
  const draftCode = 'DRF-000001';
  const sessionToken = 'test-applicant-session';
  const draftExpiresAt = new Date('2027-01-01T00:00:00.000Z');
  let sessionExpiresAt: Date;
  const applications = {
    submitApplication: jest.fn<() => Promise<object>>(),
    getApplicationStatus: jest.fn<() => Promise<object>>(),
  };
  const applicationV2 = {
    createDraft: jest.fn<() => Promise<object>>(),
    loadDraft: jest.fn<() => Promise<object>>(),
  };
  const applicationAccess = {
    upgradeResumeToken: jest.fn<() => Promise<object>>(),
    exchange: jest.fn<() => Promise<object>>(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ApplicationsController],
      providers: [
        { provide: ApplicationsService, useValue: applications },
        { provide: ApplicationV2Service, useValue: applicationV2 },
        { provide: ApplicationAccessService, useValue: applicationAccess },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    // Include issuance delay: cookie lifetime must use the stored deadline,
    // rather than restart a fresh TTL when the controller responds.
    sessionExpiresAt = new Date(Date.now() + APPLICANT_SESSION_TTL_SECONDS * 1000 - 15_000);
    applicationV2.createDraft.mockResolvedValue({ ok: true, draftCode, resumeToken: 'legacy-resume-token', revision: 0, expiresAt: draftExpiresAt, sessionToken, sessionExpiresAt });
    applicationV2.loadDraft.mockResolvedValue({ ok: true, draftCode, revision: 1, payload: { organization: { name: 'Saved name' } } });
    applicationAccess.upgradeResumeToken.mockResolvedValue({ ok: true, draftCode, sessionToken, expiresAt: sessionExpiresAt });
    applicationAccess.exchange.mockResolvedValue({ ok: true, draftCode, destination: '/apply', sessionToken, expiresAt: sessionExpiresAt });
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });
  afterAll(async () => { await app.close(); });

  it('disables only legacy public submission and keeps historical status readable', async () => {
    const retired = await request(app.getHttpServer()).post('/association-applications').send({ name: 'legacy new request' }).expect(410);
    expect(retired.body.message).toContain('/apply');
    expect(applications.submitApplication).not.toHaveBeenCalled();
    applications.getApplicationStatus.mockResolvedValue({ ok: true, found: true, id: 'APP-000001', status: 'UNDER_REVIEW' });
    await request(app.getHttpServer()).get('/association-applications/status/legacy-client-request').expect(200).expect(({ body }) => expect(body.id).toBe('APP-000001'));
    expect(applications.getApplicationStatus).toHaveBeenCalledWith('legacy-client-request');
  });

  it.each([
    ['new draft', '/association-applications/drafts', 201],
    ['legacy resume upgrade', `/association-applications/drafts/${draftCode}/session`, 200],
    ['email link exchange', '/association-applications/access/exchange', 200],
  ])('persists %s credentials only until the existing server expiry', async (_name, route, status) => {
    const response = await request(app.getHttpServer()).post(route).send({ token: 'email-link-token' }).expect(status);
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain(`${APPLICANT_SESSION_COOKIE}=${sessionToken}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    const expires = new Date(/Expires=([^;]+)/i.exec(cookie)![1]);
    expect(expires.getTime()).toBeGreaterThan(Date.now());
    expect(expires.getTime()).toBeLessThanOrEqual(sessionExpiresAt.getTime());
    expect(sessionExpiresAt.getTime() - expires.getTime()).toBeLessThan(1000);
    expect(response.body.sessionToken).toBeUndefined();
    expect(response.body.sessionExpiresAt).toBeUndefined();

    // A new HTTP client can restore the cookie persisted by the browser.
    await request(app.getHttpServer()).get(`/association-applications/drafts/${draftCode}`)
      .set('Cookie', cookie.split(';')[0]).expect(200);
    expect(applicationV2.loadDraft).toHaveBeenCalledWith(draftCode, '', sessionToken);
  });

  it('does not extend a session already expired while issuing the response', async () => {
    const expiresAt = new Date(Date.now() - 1000);
    applicationAccess.exchange.mockResolvedValue({ ok: true, draftCode, destination: '/apply', sessionToken, expiresAt });
    const response = await request(app.getHttpServer()).post('/association-applications/access/exchange').send({ token: 'email-link-token' }).expect(200);
    const cookieExpiry = new Date(/Expires=([^;]+)/i.exec(response.headers['set-cookie'][0])![1]);
    expect(cookieExpiry.getTime()).toBeLessThanOrEqual(expiresAt.getTime());
  });

  it('keeps local HTTP development usable and does not issue a honeypot session', async () => {
    process.env.NODE_ENV = 'development';
    const created = await request(app.getHttpServer()).post('/association-applications/drafts').send({}).expect(201);
    expect(created.headers['set-cookie'][0]).not.toContain('Secure');
    expect(created.body.expiresAt).toBe(draftExpiresAt.toISOString());
    applicationV2.createDraft.mockResolvedValue({ ok: true, draftCode: '', resumeToken: '', revision: 0 });
    const honeypot = await request(app.getHttpServer()).post('/association-applications/drafts').send({ website: 'spam' }).expect(201);
    expect(honeypot.headers['set-cookie']).toBeUndefined();
  });
});
