import { Injectable } from '@nestjs/common'; import { prisma, DeviceMovementLocationType, DeviceStatus } from '@alzad/db';
export interface ReconciliationViolation { code:string; count:number; entityIds:string[]; }
@Injectable() export class ReconciliationService{
 async reconcile(associationId:string){
  const quantity=await prisma.$queryRaw<{id:string}[]>`SELECT ri.id FROM receipt_items ri JOIN receipt_batches rb ON rb.id=ri.receipt_batch_id LEFT JOIN device_units du ON du.receipt_item_id=ri.id WHERE rb.association_id=${associationId}::uuid GROUP BY ri.id,ri.good_qty HAVING count(du.id)<>ri.good_qty`;
  const invalidLocation=await prisma.deviceUnit.findMany({where:{associationId,OR:[{currentLocationType:{in:[DeviceMovementLocationType.WAREHOUSE,DeviceMovementLocationType.DAMAGED_HOLDING]},currentLocationRef:{not:null}},{currentLocationType:{in:[DeviceMovementLocationType.DELEGATE,DeviceMovementLocationType.BENEFICIARY]},currentLocationRef:null}]},select:{id:true}});
  const movement=await prisma.$queryRaw<{id:string}[]>`SELECT du.id FROM device_units du LEFT JOIN device_movements dm ON dm.device_id=du.id WHERE du.association_id=${associationId}::uuid AND du.status<>'WAREHOUSE'::"DeviceStatus" GROUP BY du.id HAVING count(dm.id)=0`;
  const duplicateDevice=await prisma.$queryRaw<{id:string}[]>`SELECT device_id id FROM device_allocations WHERE association_id=${associationId}::uuid AND status='ACTIVE'::"DeviceAllocationStatus" GROUP BY device_id HAVING count(*)>1`;
  const duplicateNeed=await prisma.$queryRaw<{id:string}[]>`SELECT beneficiary_need_id id FROM device_allocations WHERE association_id=${associationId}::uuid AND status='ACTIVE'::"DeviceAllocationStatus" GROUP BY beneficiary_need_id HAVING count(*)>1`;
  const damagedFree=await prisma.deviceUnit.findMany({where:{associationId,status:DeviceStatus.DAMAGED,allocations:{some:{status:'ACTIVE'}}},select:{id:true}});
  const openIssues=await prisma.shipmentReconciliationIssue.findMany({where:{associationId,status:{not:'CLOSED'}},select:{id:true}});
  const violations:ReconciliationViolation[]=[['RECEIPT_DEVICE_QUANTITY_VARIANCE',quantity],['INVALID_DEVICE_LOCATION',invalidLocation],['MISSING_DEVICE_MOVEMENT',movement],['DUPLICATE_ACTIVE_DEVICE_ALLOCATION',duplicateDevice],['DUPLICATE_ACTIVE_NEED_ALLOCATION',duplicateNeed],['DAMAGED_DEVICE_ALLOCATED',damagedFree],['OPEN_SHIPMENT_RECONCILIATION',openIssues]].map(([code,rows])=>({code:code as string,count:(rows as{id:string}[]).length,entityIds:(rows as{id:string}[]).slice(0,100).map(r=>r.id)})).filter(v=>v.count>0);
  return{ok:violations.length===0,associationId,violations,generatedAt:new Date()};
 }
}
