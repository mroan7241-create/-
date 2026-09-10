'use client';

import { useEffect, useRef, useState } from 'react';
import { primaryButtonStyle, secondaryButtonStyle } from '../lib/ui';

export function SignaturePad({ onReady, label = 'التوقيع اليدوي' }: { onReady: (file: File | null) => void; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const points = useRef<Array<[number, number]>>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('وقّع داخل المساحة باستخدام الفأرة أو اللمس.');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.scale(ratio, ratio); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.3; ctx.strokeStyle = '#241b20'; }
      points.current = []; setConfirmed(false); onReady(null);
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    return () => observer.disconnect();
  }, [onReady]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (confirmed) return;
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
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    points.current = []; setConfirmed(false); setMessage(text); onReady(null); canvas?.focus();
  }

  function confirm() {
    const canvas = canvasRef.current; if (!canvas) return;
    const xs = points.current.map(([x]) => x); const ys = points.current.map(([, y]) => y);
    const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0; const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    if (points.current.length < 8 || width < 24 || height < 10) { setMessage('التوقيع قصير جدًا أو يبدو كنقطة عابرة. يرجى إعادة التوقيع.'); return; }
    canvas.toBlob((blob) => { if (!blob) return; onReady(new File([blob], 'covenant-signature.png', { type: 'image/png' })); setConfirmed(true); setMessage('تم اعتماد صورة التوقيع لهذه العملية.'); }, 'image/png');
  }

  return <section aria-label={label} style={{ display: 'grid', gap: 10 }}>
    <strong>{label}</strong>
    <canvas ref={canvasRef} tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} style={{ width: '100%', height: 180, background: '#fff', border: `2px solid ${confirmed ? '#2f7d4a' : '#d7c8cf'}`, borderRadius: 10, touchAction: 'none', cursor: confirmed ? 'default' : 'crosshair' }} />
    <p role="status" style={{ margin: 0, fontSize: 13, color: confirmed ? '#286b40' : '#6f6269' }}>{message}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" style={secondaryButtonStyle} onClick={() => clear()}>مسح التوقيع</button>
      <button type="button" style={secondaryButtonStyle} onClick={() => clear('المساحة جاهزة لإعادة التوقيع.')}>إعادة التوقيع</button>
      <button type="button" style={primaryButtonStyle} disabled={confirmed} onClick={confirm}>اعتماد التوقيع</button>
    </div>
  </section>;
}
