import { SetMetadata } from '@nestjs/common';
import { AccountRole } from '@alzad/db';

export const ROLES_KEY = 'roles';

/** الأدوار الثلاثة الحالية فقط — ADMIN/ASSOCIATION/DELEGATE. ممنوع إضافة دور رابع. */
export const Roles = (...roles: AccountRole[]) => SetMetadata(ROLES_KEY, roles);
