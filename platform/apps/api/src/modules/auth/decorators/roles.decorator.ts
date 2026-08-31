import { SetMetadata } from '@nestjs/common';
import { AccountRole } from '@alzad/db';

export const ROLES_KEY = 'roles';

/** الأدوار المعتمدة تُطبَّق مركزيًا عبر الحارس العام. */
export const Roles = (...roles: AccountRole[]) => SetMetadata(ROLES_KEY, roles);
