import Image from 'next/image';

export function OfficialReportHeader({ title, audience, generatedAt, period }: { title: string; audience: string; generatedAt: string; period?: string }) {
  return <>
    <header className="official-report-header">
      <div className="official-report-logos"><Image src="/brand/zadLogo.png" alt="جمعية الزاد" width={86} height={62} /><span /><Image src="/brand/partnerLogo.png" alt="مؤسسة سليمان أبانمي الأهلية" width={170} height={62} /></div>
      <div><p>مشروع الأجهزة الكهربائية</p><h1>{title}</h1><p>{audience}</p></div>
      <dl><div><dt>تاريخ ووقت الإنشاء</dt><dd>{new Date(generatedAt).toLocaleString('ar-SA')}</dd></div>{period && <div><dt>الفترة</dt><dd>{period}</dd></div>}</dl>
    </header>
    <footer className="official-report-footer"><span>جمعية الزاد بالشراكة مع مؤسسة سليمان أبانمي الأهلية</span><span className="official-report-page">تقرير صادر من منصة الزاد</span></footer>
  </>;
}
