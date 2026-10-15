import React, { useState, useRef, useEffect, useCallback } from 'react';
import { toPng } from 'html-to-image';
import {
  Award, Download, Share2, ExternalLink, CheckCircle2,
  Loader2, AlertCircle, ShieldCheck, RotateCcw
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { getCertificates, updateCertificatePdfUrl } from '../../lib/api';
import { supabase } from '../../lib/supabase';

const QRCodeImg = ({ value, size = 80 }) => (
  <img
    src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=F8F4EE&color=1A1A2E&qzone=1`}
    alt="QR Code"
    width={size}
    height={size}
    crossOrigin="anonymous"
  />
);

const CertificateCanvas = React.forwardRef(({ cert, lang }, ref) => {
  const isRtl = lang === 'ar';
  const programName = (isRtl && cert.programs?.name_ar) || cert.programs?.name || 'Athar Alumni Program';
  const founderName = (isRtl && cert.founders?.name_ar) || cert.founders?.name_en || cert.founders?.name_ar || 'Graduate';
  const verifyUrl = `${window.location.origin}/#/verify-certificate/${cert.verification_code || ''}`;

  return (
    <div
      ref={ref}
      dir="ltr"
      style={{
        width: 960,
        minHeight: 620,
        background: 'linear-gradient(135deg, #F8F4EE 0%, #EDE8E0 100%)',
        fontFamily: '"Georgia", "Times New Roman", serif',
        position: 'relative',
        padding: '60px 80px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'linear-gradient(90deg, #C4973B, #E8C66A, #C4973B)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, background: 'linear-gradient(90deg, #C4973B, #E8C66A, #C4973B)' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 8, background: 'linear-gradient(180deg, #C4973B, #E8C66A, #C4973B)' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 8, background: 'linear-gradient(180deg, #C4973B, #E8C66A, #C4973B)' }} />
      <div style={{ position: 'absolute', top: 20, left: 20, right: 20, bottom: 20, border: '1px solid rgba(196,151,59,0.4)', borderRadius: 4, pointerEvents: 'none' }} />

      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 11, letterSpacing: 6, color: '#C4973B', textTransform: 'uppercase', marginBottom: 8 }}>
          Athar Entrepreneurship Platform
        </div>
        <div style={{ fontSize: 13, letterSpacing: 4, color: '#555', textTransform: 'uppercase', fontFamily: 'sans-serif' }}>
          Certificate of Completion
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, #C4973B)' }} />
        <span style={{ color: '#C4973B', fontSize: 20 }}>★</span>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, #C4973B, transparent)' }} />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12, fontFamily: 'sans-serif', letterSpacing: 1 }}>This is to certify that</p>
        <h1 style={{ fontSize: 38, color: '#1A1A2E', margin: '0 0 8px', fontStyle: 'italic', fontWeight: 700 }}>{founderName}</h1>
        <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px', fontFamily: 'sans-serif', letterSpacing: 1 }}>has successfully completed</p>
        <h2 style={{ fontSize: 22, color: '#C4973B', margin: '0 0 8px', fontWeight: 700, letterSpacing: 1 }}>{programName}</h2>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 160, height: 1, background: '#888', marginBottom: 6 }} />
          <div style={{ fontSize: 11, color: '#666', fontFamily: 'sans-serif', letterSpacing: 1 }}>{cert.issued_by || 'Athar'}</div>
          <div style={{ fontSize: 10, color: '#999', fontFamily: 'sans-serif' }}>Authorized Signatory</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <QRCodeImg value={verifyUrl} size={72} />
          <div style={{ fontSize: 9, color: '#999', fontFamily: 'monospace', marginTop: 4 }}>{cert.verification_code}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 160, height: 1, background: '#888', marginBottom: 6 }} />
          <div style={{ fontSize: 11, color: '#666', fontFamily: 'sans-serif', letterSpacing: 1 }}>
            {cert.issue_date ? new Date(cert.issue_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '--'}
          </div>
          <div style={{ fontSize: 10, color: '#999', fontFamily: 'sans-serif' }}>Date of Issue</div>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{ fontSize: 9, color: '#aaa', fontFamily: 'sans-serif', letterSpacing: 1 }}>Verify at {verifyUrl}</div>
      </div>
    </div>
  );
});
CertificateCanvas.displayName = 'CertificateCanvas';

export default function CertificateGenerator({ founderId, onClose }) {
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
  const isRtl = lang === 'ar';

  const [certificates, setCertificates] = useState([]);
  const [selectedCert, setSelectedCert] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [pngDataUrl, setPngDataUrl] = useState('');

  const canvasRef = useRef(null);

  useEffect(() => {
    if (!founderId) return;
    getCertificates(founderId)
      .then(certs => {
        setCertificates(certs || []);
        if (certs?.length > 0) setSelectedCert(certs[0]);
      })
      .catch(console.error);
  }, [founderId]);

  const handleGenerate = useCallback(async () => {
    if (!canvasRef.current || !selectedCert) return;
    try {
      setGenerating(true);
      setError('');
      setDone(false);
      await new Promise(r => setTimeout(r, 200));
      const dataUrl = await toPng(canvasRef.current, { quality: 1, pixelRatio: 2, backgroundColor: '#F8F4EE' });
      setPngDataUrl(dataUrl);

      const blob = await (await fetch(dataUrl)).blob();
      const filePath = `certificates/${selectedCert.certificate_id}.png`;
      const { error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, blob, { contentType: 'image/png', upsert: true });

      if (!uploadErr) {
        const { data: publicData } = supabase.storage.from('event-assets').getPublicUrl(filePath);
        if (publicData?.publicUrl) {
          await updateCertificatePdfUrl(selectedCert.certificate_id, publicData.publicUrl).catch(() => {});
          setSelectedCert(prev => ({ ...prev, pdf_url: publicData.publicUrl }));
        }
      }
      setDone(true);
    } catch (err) {
      console.error('Certificate generation error:', err);
      setError(isRtl ? 'فشل توليد الشهادة، حاول مرة أخرى' : 'Failed to generate certificate. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [canvasRef, selectedCert, isRtl]);

  const handleDownload = () => {
    if (!pngDataUrl) return;
    const a = document.createElement('a');
    a.href = pngDataUrl;
    a.download = `certificate-${selectedCert?.certificate_id || 'athar'}.png`;
    a.click();
  };

  const handleShareLinkedIn = () => {
    if (!selectedCert) return;
    const certUrl = selectedCert.pdf_url || `${window.location.origin}/#/verify-certificate/${selectedCert.verification_code}`;
    const programName = selectedCert.programs?.name || 'Athar Alumni Program';
    const params = new URLSearchParams({
      mini: 'true',
      url: certUrl,
      title: `Certificate of Completion - ${programName}`,
      summary: `I completed the ${programName} by Athar. #Athar #Entrepreneurship`,
      source: 'Athar Platform'
    });
    window.open(`https://www.linkedin.com/shareArticle?${params.toString()}`, '_blank', 'width=600,height=500');
  };

  if (!founderId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <Award size={22} className="text-athar-yellow" />
            <h2 className="font-black text-base">{isRtl ? 'توليد الشهادة' : 'Generate Certificate'}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted text-muted-foreground transition-colors">✕</button>
        </div>

        <div className="p-6 space-y-6">
          {certificates.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {isRtl ? 'لا توجد شهادات مرتبطة بهذا المؤسس' : 'No certificates found for this founder.'}
            </div>
          ) : (
            <>
              {certificates.length > 1 && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground">{isRtl ? 'اختر الشهادة' : 'Select Certificate'}</label>
                  <select
                    value={selectedCert?.certificate_id || ''}
                    onChange={e => { const c = certificates.find(x => x.certificate_id === e.target.value); setSelectedCert(c || null); setPngDataUrl(''); setDone(false); }}
                    className="w-full bg-muted/60 border border-border rounded-xl px-3 py-2 text-sm font-bold"
                  >
                    {certificates.map(c => (
                      <option key={c.certificate_id} value={c.certificate_id}>{c.programs?.name || 'Certificate'} — {c.issue_date}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', zIndex: -1 }}>
                {selectedCert && <CertificateCanvas ref={canvasRef} cert={selectedCert} lang={lang} />}
              </div>

              {pngDataUrl && (
                <div className="rounded-2xl overflow-hidden border border-border shadow-md">
                  <img src={pngDataUrl} alt="Certificate Preview" className="w-full" />
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-red-500 text-xs font-bold bg-red-50 rounded-xl p-3">
                  <AlertCircle size={16} /><span>{error}</span>
                </div>
              )}

              {done && !error && (
                <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold bg-emerald-50 rounded-xl p-3">
                  <CheckCircle2 size={16} /><span>{isRtl ? 'تم توليد الشهادة وحفظها بنجاح!' : 'Certificate generated and saved!'}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-athar-blue hover:bg-athar-blue/90 text-white rounded-xl text-sm font-black shadow transition-all disabled:opacity-60"
                >
                  {generating ? <Loader2 size={16} className="animate-spin" /> : done ? <RotateCcw size={16} /> : <Award size={16} />}
                  <span>{generating ? (isRtl ? 'جاري التوليد...' : 'Generating...') : done ? (isRtl ? 'إعادة التوليد' : 'Regenerate') : (isRtl ? 'توليد الشهادة' : 'Generate Certificate')}</span>
                </button>

                {done && pngDataUrl && (
                  <>
                    <button onClick={handleDownload} className="flex items-center gap-2 px-4 py-3 bg-muted hover:bg-muted/80 rounded-xl text-sm font-black border border-border transition-all">
                      <Download size={15} /><span>{isRtl ? 'تحميل' : 'Download'}</span>
                    </button>
                    <button onClick={handleShareLinkedIn} className="flex items-center gap-2 px-4 py-3 bg-[#0A66C2] hover:bg-[#0A66C2]/90 text-white rounded-xl text-sm font-black transition-all">
                      <Share2 size={15} /><span>LinkedIn</span>
                    </button>
                  </>
                )}

                {selectedCert?.verification_code && (
                  <a href={`/#/verify-certificate/${selectedCert.verification_code}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-3 bg-muted hover:bg-muted/80 rounded-xl text-sm font-bold border border-border transition-all">
                    <ShieldCheck size={15} className="text-emerald-500" /><span>{isRtl ? 'تحقق' : 'Verify'}</span><ExternalLink size={12} />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
