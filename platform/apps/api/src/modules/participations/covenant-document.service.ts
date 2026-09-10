import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFPage, PDFFont, rgb } from 'pdf-lib';
import reshaper from 'arabic-persian-reshaper';

export const COVENANT_VERSION = '1.0';
export const COVENANT_SOURCE_SHA256 = '66A8B13E96F07CF98E64B082C137E8B47C9A89065987C544B2D899A648A857D3';
export const PARTY_ONE_NAME = 'الأستاذ/ موسى بن عبد الله اليحيى';
export const PARTY_ONE_TITLE = 'المدير التنفيذي';

interface FinalCovenantInput {
  associationName: string;
  associationRepresentative: string;
  associationRepresentativeTitle: string;
  associationSignature: Buffer;
  associationSignatureMime: string;
  associationSignedAt: Date;
  partyOneSignature: Buffer;
  partyOneSignatureMime: string;
  partyOneSignedAt: Date;
  reference: string;
}

@Injectable()
export class CovenantDocumentService {
  private readonly templatePath = covenantAssetPath('covenant-v1.pdf');
  private readonly fontPath = covenantAssetPath('NotoSansArabic-Regular.ttf');

  templateBytes(): Buffer {
    const bytes = readFileSync(this.templatePath);
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    if (actual !== COVENANT_SOURCE_SHA256) throw new Error('Covenant V1 template integrity check failed');
    return bytes;
  }

  async generateFinal(input: FinalCovenantInput): Promise<Buffer> {
    const pdf = await PDFDocument.load(this.templateBytes(), { updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(readFileSync(this.fontPath), { subset: true });
    const page = pdf.getPages()[pdf.getPageCount() - 1];

    const associationSignature = await this.embedImage(pdf, input.associationSignature, input.associationSignatureMime);
    const partyOneSignature = await this.embedImage(pdf, input.partyOneSignature, input.partyOneSignatureMime);
    page.drawImage(associationSignature, fit(associationSignature.width, associationSignature.height, 65, 350, 214, 72));
    page.drawImage(partyOneSignature, fit(partyOneSignature.width, partyOneSignature.height, 317, 393, 213, 73));

    drawRtl(page, font, input.associationName, 210, 500, 9, 145);
    drawRtl(page, font, input.associationRepresentative, 210, 474, 9, 145);
    drawRtl(page, font, input.associationRepresentativeTitle, 210, 448, 9, 145);
    drawRtl(page, font, formatTimestamp(input.associationSignedAt), 210, 324, 7.5, 145);
    drawRtl(page, font, formatTimestamp(input.partyOneSignedAt), 470, 358, 7.5, 145);

    drawRtl(page, font, input.reference, 470, 236, 7.2, 155);
    drawRtl(page, font, COVENANT_VERSION, 268, 236, 7.2, 135);
    drawRtl(page, font, input.associationName, 470, 216, 7.2, 155);
    drawRtl(page, font, input.associationRepresentative, 470, 196, 7.2, 155);
    drawRtl(page, font, formatTimestamp(input.partyOneSignedAt), 470, 176, 7.2, 155);
    drawRtl(page, font, COVENANT_SOURCE_SHA256, 470, 156, 5.4, 155);
    drawRtl(page, font, 'مكتمل ومعتمد', 268, 156, 7.2, 135);

    pdf.setTitle(`Covenant ${input.reference}`);
    pdf.setSubject(`Covenant V${COVENANT_VERSION} - ${input.associationName}`);
    pdf.setProducer('Alzad Platform');
    pdf.setCreationDate(input.partyOneSignedAt);
    pdf.setModificationDate(input.partyOneSignedAt);
    return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false }));
  }

  private async embedImage(pdf: PDFDocument, bytes: Buffer, mime: string) {
    return mime === 'image/png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
  }
}

function covenantAssetPath(filename: string) {
  const roots = [
    join(process.cwd(), 'apps', 'api', 'dist', 'assets'),
    join(process.cwd(), 'dist', 'assets'),
    join(process.cwd(), 'apps', 'api', 'src', 'assets'),
    join(process.cwd(), 'src', 'assets'),
  ];
  const match = roots.map((root) => join(root, 'covenant', 'v1', filename)).find(existsSync);
  if (!match) throw new Error(`Covenant asset not found: ${filename}`);
  return match;
}

function drawRtl(page: PDFPage, font: PDFFont, value: string, right: number, y: number, size: number, maxWidth: number) {
  // `convertArabic` returns presentation-form glyphs in logical RTL order.
  // Reversing that output makes PDF renderers apply bidi to an already reversed
  // run, producing broken word order and incorrect joining.
  const rendered = /[\u0600-\u06ff]/.test(value) ? reshaper.ArabicShaper.convertArabic(value) : value;
  const widthAtRequestedSize = font.widthOfTextAtSize(rendered, size);
  const fittedSize = widthAtRequestedSize > maxWidth ? Math.max(3.5, size * maxWidth / widthAtRequestedSize) : size;
  page.drawText(rendered, { x: right - font.widthOfTextAtSize(rendered, fittedSize), y, size: fittedSize, font, color: rgb(0.18, 0.18, 0.2) });
}

function fit(sourceWidth: number, sourceHeight: number, x: number, y: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: x + (maxWidth - width) / 2, y: y + (maxHeight - height) / 2, width, height };
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
}
