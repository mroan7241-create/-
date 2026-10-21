'use client';

import { useEffect, useRef, useState } from 'react';
import { primaryButtonStyle, secondaryButtonStyle } from '../lib/ui';

export function SignaturePad({ onReady, label = 'التوقيع' }: { onReady: (file: File | null) => void; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const points = useRef<Array<[number, number]>>([]);
  const uploadedImage = useRef<ImageBitmap | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('ارسم توقيعك بالفأرة أو اللمس، ثم اضغط «اعتماد التوقيع».');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      if (canvas.width === Math.round(rect.width * ratio) && canvas.height === Math.round(rect.height * ratio)) return;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.scale(ratio, ratio); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.3; ctx.strokeStyle = '#241b20'; }
      if (uploadedImage.current) paintImage(canvas, uploadedImage.current);
      generation.current += 1;
      points.current = []; setConfirmed(false); onReady(null);
      setMessage(uploadedImage.current ? 'تغير حجم المعاينة؛ راجع الصورة ثم اعتمد التوقيع مجددًا.' : 'ارسم توقيعك أو ارفع صورته، ثم اضغط «اعتماد التوقيع».');
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    return () => { observer.disconnect(); generation.current += 1; uploadedImage.current?.close(); uploadedImage.current = null; };
  }, [onReady]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (confirmed || uploadedImage.current) return;
    generation.current += 1;
    event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true;
    const [x, y] = point(event); points.current.push([x, y]);
    const ctx = event.currentTarget.getContext('2d'); ctx?.beginPath(); ctx?.moveTo(x, y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || confirmed) return;
    const [x, y] = point(event); points.current.push([x, y]);
    const ctx = event.currentTarget.getContext('2d'); ctx?.lineTo(x, y); ctx?.stroke();
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) { drawing.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }

  function clear(text = 'تم مسح التوقيع. وقّع من جديد داخل المساحة.') {
    generation.current += 1; drawing.current = false;
    uploadedImage.current?.close(); uploadedImage.current = null;
    if (fileInput.current) fileInput.current.value = '';
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    points.current = []; setConfirmed(false); setMessage(text); onReady(null); canvas?.focus();
  }

  function confirm() {
    const canvas = canvasRef.current; if (!canvas) return;
    const xs = points.current.map(([x]) => x); const ys = points.current.map(([, y]) => y);
    const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0; const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    if (!uploadedImage.current && (points.current.length < 8 || width < 24 || height < 10)) { setMessage('التوقيع قصير جدًا أو يبدو كنقطة عابرة. يرجى إعادة التوقيع.'); return; }
    const stamp = generation.current;
    canvas.toBlob((blob) => { if (!blob || stamp !== generation.current) return; onReady(new File([blob], 'covenant-signature.png', { type: 'image/png' })); setConfirmed(true); setMessage('تم اعتماد صورة التوقيع لهذه العملية.'); }, 'image/png');
  }

  async function upload(file?: File) {
    clear('جارٍ فحص صورة التوقيع…');
    if (!file) { setMessage('لم يتم اختيار صورة.'); return; }
    const stamp = generation.current;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) { setMessage('اختر صورة PNG أو JPG بحجم لا يتجاوز 5 ميجابايت.'); return; }
    let image: ImageBitmap | null = null;
    try {
      image = await createImageBitmap(file);
      if (stamp !== generation.current) { image.close(); return; }
      if (!image.width || !image.height || image.width > 4096 || image.height > 4096) throw new Error('dimensions');
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('canvas');
      paintImage(canvas, image);
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) if (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2] < 220) ink += 1;
      if (ink < 40) throw new Error('empty');
      uploadedImage.current = image;
      setMessage('راجع صورة التوقيع، ثم اضغط «اعتماد التوقيع». لاستبدالها اختر صورة أخرى أو امسح التوقيع.');
    } catch {
      image?.close();
      if (stamp === generation.current) clear('تعذر قبول الصورة: تأكد أنها واضحة وغير فارغة وأبعادها لا تتجاوز 4096 × 4096.');
    }
  }

  return <section aria-label={label} style={{ display: 'grid', gap: 10 }}>
    <strong>{label}</strong>
    <label style={{ display: 'grid', gap: 6 }}>رسم التوقيع أدناه أو رفع صورة التوقيع (PNG / JPG — حتى 5 ميجابايت)
      <input ref={fileInput} type="file" accept="image/png,image/jpeg" aria-label="رفع صورة التوقيع" onChange={event => void upload(event.target.files?.[0])} />
    </label>
    <canvas ref={canvasRef} tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} style={{ width: '100%', height: 180, background: '#fff', border: `2px solid ${confirmed ? '#2f7d4a' : '#d7c8cf'}`, borderRadius: 10, touchAction: 'none', cursor: confirmed ? 'default' : 'crosshair' }} />
    <p role="status" style={{ margin: 0, fontSize: 13, color: confirmed ? '#286b40' : '#6f6269' }}>{message}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" style={secondaryButtonStyle} onClick={() => clear()}>مسح التوقيع</button>
      <button type="button" style={secondaryButtonStyle} onClick={() => clear('المساحة جاهزة لإعادة التوقيع.')}>إعادة التوقيع</button>
      <button type="button" style={primaryButtonStyle} disabled={confirmed} onClick={confirm}>اعتماد التوقيع</button>
    </div>
  </section>;
}

function paintImage(canvas: HTMLCanvasElement, image: ImageBitmap) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((canvas.width - 24) / image.width, (canvas.height - 24) / image.height);
  const width = image.width * scale, height = image.height * scale;
  ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  ctx.restore();
}
