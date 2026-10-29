import ExcelJS from 'exceljs';
import { ALL_BENEFICIARY_IMPORT_FIELDS, SIMPLE_BENEFICIARY_IMPORT_FIELDS } from '@alzad/shared';
import { DeviceType } from '@alzad/db';
import { generateXlsxTemplate, parseXlsxBeneficiaryRows, parseXlsxRowToImportRow } from './xlsx-import.util';

describe('قالب استيراد المستفيدين', () => {
  it('uses the approved association quota in the template and priority validation', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateXlsxTemplate({ region: 'القصيم', limit: 60 }) as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets[0].getRow(61).getCell(3).value).toBe('القصيم');
    expect(workbook.worksheets[0].getCell('A2').dataValidation.formulae).toEqual([1, 60]);
    expect((await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()))).rows).toHaveLength(0);
  });
  it('ينشئ قالبًا بلا مستفيدين تجريبيين ويتجاهل المنطقة المعبأة مسبقًا وحدها', async () => {
    const buffer = await generateXlsxTemplate({ region: 'مكة المكرمة', regions: ['مكة المكرمة'], cities: ['جدة'], socialStatuses: ['أرملة'] });
    const parsed = await parseXlsxBeneficiaryRows(buffer);
    expect(parsed.headers).toEqual(SIMPLE_BENEFICIARY_IMPORT_FIELDS);
    expect(parsed.rows).toHaveLength(0);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets[0].getCell('D2').dataValidation.formulae).toEqual(['ImportCities']);
    expect(workbook.definedNames.getRanges('ImportCities').ranges).toEqual(["'قوائم'!$B$1"]);
  });

  it('يقرأ 50 مستفيدًا والأجهزة الثلاثة والأرقام العربية من القالب الجديد', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateXlsxTemplate({ region: 'مكة المكرمة' }) as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    for (let i = 0; i < 50; i++) sheet.getRow(i + 2).values = [i + 1, `مستفيد ${i}`, 'مكة المكرمة', 'جدة', 'حي تجريبي', `05000000${String(i).padStart(2, '0')}`, '٥', 'أرملة', 'نعم', 'لا', 'نعم'];
    const parsed = await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.rows).toHaveLength(50);
    const rows = parsed.rows.map(row => parseXlsxRowToImportRow(row.raw));
    expect(rows.every(row => row.familyCount === 5 && row.deviceTypes?.join(',') === 'REFRIGERATOR,WASHING_MACHINE')).toBe(true);
    expect(rows.map(row => row.needPriority)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(sheet.getColumn(6).numFmt).toBe('@');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('يرفض نعم/لا غير المعروفة والتعارض بين القالبين', () => {
    expect(() => parseXlsxRowToImportRow({ refrigerator: 'ربما' })).toThrow('نعم أو لا');
    expect(() => parseXlsxRowToImportRow({ refrigerator: 'نعم', oven: 'لا', washingMachine: 'لا', deviceTypes: 'فرن' })).toThrow('تعارض');
  });

  it('يبقي رؤوس القالب الإنجليزي القديم متوافقة', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('legacy');
    sheet.addRow(ALL_BENEFICIARY_IMPORT_FIELDS);
    sheet.addRow(['مستفيد قديم', 'الرياض', 'الرياض', 'النرجس', '0500000001', 4, 'متزوج', 'غسالة', '', 'false', '', '', '', '', 1]);
    const parsed = await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.headers).toEqual(ALL_BENEFICIARY_IMPORT_FIELDS);
    expect(parseXlsxRowToImportRow(parsed.rows[0].raw)).toMatchObject({ name: 'مستفيد قديم', familyCount: 4, deviceTypes: [DeviceType.WASHING_MACHINE] });
  });

  it('requires a reason for three unique devices even when Excel validation was bypassed', () => {
    const row = { needPriority: '١', familyCount: '4', name: 'اختبار', deviceTypes: 'ثلاجة،فرن،غسالة' };
    expect(() => parseXlsxRowToImportRow(row)).toThrow('مبرر');
    expect(() => parseXlsxRowToImportRow({ ...row, threeDeviceReason: '   ...   ' })).toThrow('مبرر');
    expect(parseXlsxRowToImportRow({ ...row, threeDeviceReason: 'لا تتوفر للأسرة أجهزة صالحة للاستخدام' })).toMatchObject({ needPriority: 1, threeDeviceReason: 'لا تتوفر للأسرة أجهزة صالحة للاستخدام' });
  });
});
