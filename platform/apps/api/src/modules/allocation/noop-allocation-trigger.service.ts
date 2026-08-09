import { Injectable, Logger } from '@nestjs/common';
import type { AllocationTriggerPort } from './allocation-trigger.port';

/**
 * التنفيذ الافتراضي في NODE-3: **لا يفعل شيئًا على الإطلاق**.
 *
 * لا كتابة، لا قراءة، لا نداء خارجي، ولا أي أثر يمكن ملاحظته عدا سطر
 * تشخيصي على مستوى debug. هذا مقصود حرفيًا — NODE-3 ينقل *توقيت* نداء
 * التخصيص وتجميعه لكل جمعية، لا التخصيص نفسه.
 *
 * NODE-5 يستبدل هذا الصنف عبر مزوّد `ALLOCATION_TRIGGER_PORT` وحده، بلا
 * تعديل سطر واحد في `BeneficiariesService` — وهذا بالضبط ما تتحقق منه
 * اختبارات التجميع عبر تنفيذ تجسّس (spy) بديل لنفس الـport.
 */
@Injectable()
export class NoopAllocationTriggerService implements AllocationTriggerPort {
  private readonly logger = new Logger('NoopAllocationTrigger');

  async triggerForAssociation(associationId: string): Promise<void> {
    this.logger.debug(
      `تجاهُل مقصود لإشارة تخصيص للجمعية ${associationId} — محرّك التخصيص التلقائي غير مُنقَل بعد (NODE-5).`,
    );
  }
}
