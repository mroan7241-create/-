import { createHash } from 'node:crypto';
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { CovenantDocumentService, COVENANT_SOURCE_SHA256, COVENANT_TITLE } from './covenant-document.service';

describe('Covenant PDF preview metadata', () => {
  it('corrects the title while preserving source bytes and page contents', async () => {
    const service = new CovenantDocumentService();
    const source = await PDFDocument.load(service.templateBytes(), { updateMetadata: false });
    const result = await PDFDocument.load(await service.previewBytes(), { updateMetadata: false });
    expect(result.getTitle()).toBe(COVENANT_TITLE);
    expect(result.getPageCount()).toBe(source.getPageCount());
    for (let index = 0; index < source.getPageCount(); index++) {
      const before = source.getPages()[index];
      const after = result.getPages()[index];
      expect(after.getSize()).toEqual(before.getSize());
      expect(after.node.Contents()?.toString()).toBe(before.node.Contents()?.toString());
      const streams = (document: PDFDocument, contents: ReturnType<typeof before.node.Contents>) => {
        const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
        return refs.map((ref) => {
          const stream = document.context.lookup(ref);
          if (!(stream instanceof PDFRawStream)) throw new Error('Expected a PDF content stream');
          return Buffer.from(stream.contents).toString('hex');
        });
      };
      expect(streams(result, after.node.Contents())).toEqual(streams(source, before.node.Contents()));
    }
    expect(createHash('sha256').update(service.templateBytes()).digest('hex').toUpperCase()).toBe(COVENANT_SOURCE_SHA256);
    expect(source.getTitle()).not.toBe(result.getTitle());
  });
});
