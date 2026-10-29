import ExcelJS from 'exceljs';
import { ALL_BENEFICIARY_IMPORT_FIELDS, BENEFICIARY_IMPORT_HEADER_LABELS, SIMPLE_BENEFICIARY_IMPORT_FIELDS } from '@alzad/shared';
import { DeviceType } from '@alzad/db';
import { generateXlsxTemplate, parseXlsxBeneficiaryRows, parseXlsxRowToImportRow } from './xlsx-import.util';

describe('قالب استيراد المستفيدين', () => {
  it('uses the approved association quota in the template and priority validation', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateXlsxTemplate({ region: 'القصيم', limit: 60 }) as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets[0].getRow(61).getCell(3).value).toBe('القصيم');
    expect(workbook.worksheets[0].getCell('A2').dataValidation.formulae).toEqual([1, 60]);
    expect(workbook.worksheets[0].getCell('A2').value).toBe(1);
    expect(workbook.worksheets[0].getCell('A61').value).toBe(60);
    expect((await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()))).rows).toHaveLength(0);
  });

  it('shows self-contained questions and optional location labels without changing field positions', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateXlsxTemplate({ region: 'القصيم' }) as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('A1').value).toBe('ترتيب الحاجة (1 = الأشد حاجة)');
    expect(sheet.getCell('B1').value).toBe('اسم المستفيد كاملًا');
    expect(sheet.getCell('I1').value).toBe('هل يحتاج إلى ثلاجة؟ (نعم/لا)');
    expect(sheet.getCell('L1').value).toContain('إلزامي عند طلبها');
    for (const cell of ['M1', 'P1', 'Q1', 'R1']) expect(sheet.getCell(cell).value).toContain('اختياري');
    expect(sheet.getCell('N1').value).toBe('هل يستفيد من الضمان الاجتماعي؟ (نعم/لا)');
    expect(sheet.getCell('O1').value).toBe('كم دخل المستفيد؟ (ريال)');
    expect(sheet.getCell('N2').dataValidation.allowBlank).toBeFalsy();
    expect(sheet.getCell('O2').dataValidation).toMatchObject({ type: 'whole', formulae: [0, 1000000] });
    expect(sheet.getColumn(14).outlineLevel).toBe(0);
    expect(sheet.getColumn(15).outlineLevel).toBe(0);
    expect(sheet.getCell('Q1').value).toContain('موقع منزل المستفيد');
    expect(sheet.getCell('R1').value).toContain('موقع منزل المستفيد');
    expect(sheet.getCell('A2').numFmt).toContain('الأشد حاجة');
    sheet.getCell('B2').value = 'اسم أسرة';
    const parsed = await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].raw.needPriority).toBe('1');
    expect(parsed.rows[0].raw.name).toBe('اسم أسرة');
    expect(parsed.rows[0].raw.region).toBe('القصيم');
  });

  it('reads previously downloaded Arabic headers after the label change', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('قديم');
    sheet.addRow(['ترتيب الحاجة', 'الاسم', 'المنطقة', 'المدينة', 'الحي', 'رقم الجوال', 'عدد أفراد الأسرة', 'الحالة الاجتماعية', 'ثلاجة؟', 'فرن؟', 'غسالة؟', 'مبرر طلب ثلاثة أجهزة', 'جوال إضافي', 'الضمان الاجتماعي', 'الدخل', 'ملاحظات', 'خط العرض', 'خط الطول']);
    sheet.addRow([1, 'اسم قديم', 'القصيم', 'بريدة', 'حي', '0500000001', 5, 'أرملة', 'نعم', 'لا', 'لا', '', '', 'لا', 0]);
    const parsed = await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.headers).toEqual(SIMPLE_BENEFICIARY_IMPORT_FIELDS);
    expect(parseXlsxRowToImportRow(parsed.rows[0].raw)).toMatchObject({ name: 'اسم قديم', needPriority: 1, deviceTypes: [DeviceType.REFRIGERATOR] });
    sheet.getCell('C1').value = BENEFICIARY_IMPORT_HEADER_LABELS.region;
    expect((await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()))).rows).toHaveLength(1);
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
    for (let i = 0; i < 50; i++) sheet.getRow(i + 2).values = [i + 1, `مستفيد ${i}`, 'مكة المكرمة', 'جدة', 'حي تجريبي', `05000000${String(i).padStart(2, '0')}`, '٥', 'أرملة', 'نعم', 'لا', 'نعم', '', '', 'لا', 0];
    const parsed = await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.rows).toHaveLength(50);
    const rows = parsed.rows.map(row => parseXlsxRowToImportRow(row.raw));
    expect(rows.every(row => row.familyCount === 5 && row.deviceTypes?.join(',') === 'REFRIGERATOR,WASHING_MACHINE')).toBe(true);
    expect(rows.map(row => row.needPriority)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(sheet.getColumn(6).numFmt).toBe('@');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('يرفض نعم/لا غير المعروفة والتعارض بين القالبين', () => {
    expect(() => parseXlsxRowToImportRow({ socialSecurity: 'لا', income: '0', refrigerator: 'ربما' })).toThrow('نعم أو لا');
    expect(() => parseXlsxRowToImportRow({ socialSecurity: 'لا', income: '0', refrigerator: 'نعم', oven: 'لا', washingMachine: 'لا', deviceTypes: 'فرن' })).toThrow('تعارض');
  });

  it('يبقي رؤوس القالب الإنجليزي القديم متوافقة', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('legacy');
    sheet.addRow(ALL_BENEFICIARY_IMPORT_FIELDS);
    sheet.addRow(['مستفيد قديم', 'الرياض', 'الرياض', 'النرجس', '0500000001', 4, 'متزوج', 'غسالة', '', 'false', 0, '', '', '', 1]);
    const parsed = await parseXlsxBeneficiaryRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.headers).toEqual(ALL_BENEFICIARY_IMPORT_FIELDS);
    expect(parseXlsxRowToImportRow(parsed.rows[0].raw)).toMatchObject({ name: 'مستفيد قديم', familyCount: 4, deviceTypes: [DeviceType.WASHING_MACHINE] });
  });

  it('requires a reason for three unique devices even when Excel validation was bypassed', () => {
    const row = { needPriority: '١', familyCount: '4', name: 'اختبار', socialSecurity: 'لا', income: '0', deviceTypes: 'ثلاجة،فرن،غسالة' };
    expect(() => parseXlsxRowToImportRow(row)).toThrow('مبرر');
    expect(() => parseXlsxRowToImportRow({ ...row, threeDeviceReason: '   ...   ' })).toThrow('مبرر');
    expect(parseXlsxRowToImportRow({ ...row, threeDeviceReason: 'لا تتوفر للأسرة أجهزة صالحة للاستخدام' })).toMatchObject({ needPriority: 1, threeDeviceReason: 'لا تتوفر للأسرة أجهزة صالحة للاستخدام' });
  });
  it('rejects blank financial answers and accepts an explicit no with zero income', () => {
    const row = { needPriority: '1', familyCount: '4', name: 'اختبار', socialSecurity: 'لا', income: '٠', deviceTypes: 'ثلاجة' };
    expect(() => parseXlsxRowToImportRow({ ...row, socialSecurity: '' })).toThrow('الضمان');
    expect(() => parseXlsxRowToImportRow({ ...row, income: ' ' })).toThrow('دخل');
    expect(parseXlsxRowToImportRow(row)).toMatchObject({ socialSecurity: false, income: 0 });
  });
});
