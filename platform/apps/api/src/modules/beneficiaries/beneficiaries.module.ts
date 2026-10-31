import { Module } from '@nestjs/common';
import { BeneficiariesController } from './beneficiaries.controller';
import { BeneficiariesService } from './beneficiaries.service';
import { AllocationModule } from '../allocation/allocation.module';
import { BeneficiaryWorkspaceController } from './beneficiary-workspace.controller';
import { BeneficiaryWorkspaceService } from './beneficiary-workspace.service';

/**
 * NODE-3 — المستفيدون + احتياجاتهم + المراجعة الفردية والجماعية.
 *
 * `AllocationModule` مستورَد لأجل بذرة `ALLOCATION_TRIGGER_PORT` وحدها
 * (تنفيذ NO-OP في NODE-3) — لا يستورد هذا الـmodule أي منطق تخصيص أو
 * مخزون، فتلك نطاقات NODE-4/NODE-5 ولم تُبدأ.
 */
@Module({
  imports: [AllocationModule],
  controllers: [BeneficiariesController, BeneficiaryWorkspaceController],
  // PublicCodeService/IdempotencyService يأتيان من CommonModule العالمي (نسخة واحدة مشتركة).
  providers: [BeneficiariesService, BeneficiaryWorkspaceService],
})
export class BeneficiariesModule {}
