import { AccountRole } from '@alzad/db';
import { ROLES_KEY } from '../modules/auth/decorators/roles.decorator';
import { BeneficiariesController } from '../modules/beneficiaries/beneficiaries.controller';
import { DeliveriesController } from '../modules/deliveries/deliveries.controller';
import { ReportsController } from '../modules/reports/reports.controller';
import { ProcurementController } from '../modules/procurement/procurement.controller';
describe('locked workflow RBAC metadata', () => {
  it('allows only ADMIN to promote reserves', () => expect(Reflect.getMetadata(ROLES_KEY, BeneficiariesController.prototype.promote)).toEqual([AccountRole.ADMIN]));
  it('separates association and Zaad final delivery approvals', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DeliveriesController.prototype.associationApproval)).toEqual([AccountRole.ASSOCIATION]);
    expect(Reflect.getMetadata(ROLES_KEY, DeliveriesController.prototype.zaadApproval)).toEqual([AccountRole.ADMIN]);
  });
  it('allows only the association to confirm a normal physical return', () => expect(Reflect.getMetadata(ROLES_KEY, DeliveriesController.prototype.confirmReturn)).toEqual([AccountRole.ASSOCIATION]));
  it('limits organization closure reopen and administrative review to ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReportsController.prototype.reopen)).toEqual([AccountRole.ADMIN]);
    expect(Reflect.getMetadata(ROLES_KEY, ReportsController.prototype.orgTransition)).toEqual([AccountRole.ADMIN, AccountRole.ASSOCIATION]);
  });
  it('permits association shipment receipt transitions through the protected endpoint only', () => expect(Reflect.getMetadata(ROLES_KEY, ProcurementController.prototype.shipmentTransition)).toEqual([AccountRole.ADMIN, AccountRole.ASSOCIATION]));
});
