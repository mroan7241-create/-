import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSION_CATALOG, hasAdminPermission, normalizeAdminPermissions } from '@alzad/shared';
import { AppModule } from '../../app.module';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';
import { ADMIN_ROUTE_POLICIES, adminRoutePolicy } from './admin-route-permissions';

describe('restricted administrative route contracts', () => {
  it('classifies every non-public ADMIN-capable route in the actual module tree', () => {
    const seen = new Set<unknown>();
    const routes = new Set<string>();
    const missing: string[] = [];
    function visit(module: object) {
      if (seen.has(module)) return;
      seen.add(module);
      for (const imported of Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? []) {
        visit(imported.module ?? imported);
      }
      for (const controller of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) ?? []) {
        const controllerPaths = [Reflect.getMetadata(PATH_METADATA, controller) ?? ''].flat();
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name];
          if (typeof handler !== 'function' || !Reflect.hasMetadata(METHOD_METADATA, handler)) continue;
          const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? Reflect.getMetadata(IS_PUBLIC_KEY, controller);
          const roles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, handler) ?? Reflect.getMetadata(ROLES_KEY, controller);
          if (isPublic || (roles?.length && !roles.includes('ADMIN'))) continue;
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
          for (const root of controllerPaths) for (const path of [Reflect.getMetadata(PATH_METADATA, handler) ?? ''].flat()) {
            const fullPath = `/${[root, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
            const key = `${method} ${fullPath}`;
            routes.add(key);
            if (!adminRoutePolicy(method, `/api/v1${fullPath}`)) missing.push(key);
          }
        }
      }
    }
    visit(AppModule);
    expect(missing).toEqual([]);
    expect(routes.size).toBeGreaterThan(90);
    expect(Object.keys(ADMIN_ROUTE_POLICIES).filter((key) => !routes.has(key))).toEqual([]);
  });

  it('uses exact route templates and denies aliases, unregistered paths and methods', () => {
    expect(adminRoutePolicy('POST', '/api/v1/association-applications/:id/evaluation')).toBe('applications.evaluate');
    expect(adminRoutePolicy('POST', '/api/v1/association-applications/:id/review')).toBe('owner');
    expect(adminRoutePolicy('POST', '/api/v1/association-applications/selection/commit')).toBe('owner');
    expect(adminRoutePolicy('PATCH', '/api/v1/association-applications/:id/evaluation')).toBeUndefined();
    expect(adminRoutePolicy('GET', '/api/v1/unmapped')).toBeUndefined();
    expect(adminRoutePolicy('GET', undefined)).toBeUndefined();
  });

  it('implies same-domain read only and preserves independent application actions', () => {
    expect(normalizeAdminPermissions(['applications.evaluate', 'not-a-grant'])).toEqual(['applications.read', 'applications.evaluate']);
    expect(hasAdminPermission(false, ['applications.evaluate'], 'applications.select')).toBe(false);
    expect(hasAdminPermission(false, ['deliveries.manage'], 'beneficiaries.read')).toBe(false);
    expect(hasAdminPermission(false, ['applications.evaluate'], 'applications.read')).toBe(true);
    expect(hasAdminPermission(true, [], 'settings.manage')).toBe(true);
    expect(new Set(ADMIN_PERMISSION_CATALOG.map((item) => item.key)).size).toBe(ADMIN_PERMISSION_CATALOG.length);
  });
});
