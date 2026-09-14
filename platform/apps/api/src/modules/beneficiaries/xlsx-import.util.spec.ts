import ExcelJS from 'exceljs';
import { ALL_BENEFICIARY_IMPORT_FIELDS } from '@alzad/shared';
import { DeviceType } from '@alzad/db';
import { generateXlsxTemplate, parseXlsxBeneficiaryRows, parseXlsxRowToImportRow } from './xlsx-import.util';

describe('قالب استيراد المستفيدين', () => {
  it('ينشئ قالبًا عربيًا صالحًا ويحوّل صف المثال إلى العقد الداخلي', async () => {
    const parsed = await parseXlsxBeneficiaryRows(await generateXlsxTemplate());
    expect(parsed.headers).toEqual(ALL_BENEFICIARY_IMPORT_FIELDS);
    expect(parsed.rows).toHaveLength(1);
    expect(parseXlsxRowToImportRow(parsed.rows[0].raw)).toMatchObject({
      name: 'اسم تجريبي', familyCount: 5, socialStatus: 'أرملة',
      deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN], socialSecurity: true,
    });
  });

  it('يبقي رؤوس القالب الإنجليزي القديم متوافقة', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('legacy');
    sheet.addRow(ALL_BENEFICIARY_IMPORT_FIELDS);
    sheet.addRow(['مستفيد قديم', 'الرياض', 'الرياض', 'النرجس', '0500000001', 4, 'متزوج', 'غسالة', '', 'false', '', '', '', '']);
    const parsed = await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.headers).toEqual(ALL_BENEFICIARY_IMPORT_FIELDS);
    expect(parseXlsxRowToImportRow(parsed.rows[0].raw)).toMatchObject({ name: 'مستفيد قديم', familyCount: 4, deviceTypes: [DeviceType.WASHING_MACHINE] });
  });
});
