import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';

import { AuthModule } from './modules/auth/auth.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AssociationsModule } from './modules/associations/associations.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { BeneficiariesModule } from './modules/beneficiaries/beneficiaries.module';
import { BeneficiaryNeedsModule } from './modules/beneficiary-needs/beneficiary-needs.module';
import { ReferenceDataModule } from './modules/reference-data/reference-data.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AllocationModule } from './modules/allocation/allocation.module';
import { DelegatesModule } from './modules/delegates/delegates.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { FilesModule } from './modules/files/files.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    AccountsModule,
    AssociationsModule,
    ApplicationsModule,
    BeneficiariesModule,
    BeneficiaryNeedsModule,
    ReferenceDataModule,
    ReceiptsModule,
    InventoryModule,
    AllocationModule,
    DelegatesModule,
    DeliveriesModule,
    ActivitiesModule,
    FilesModule,
    AuditModule,
    SettingsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
