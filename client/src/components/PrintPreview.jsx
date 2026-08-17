import { useEffect, useRef, useState } from 'react';
import { fetchPdfUrl, openPdf } from '../api/client';
import { useHotkeys } from '../keyboard';

/**
 * In-app voucher print preview. Loads the invoice PDF (with auth) into an
 * iframe so the user can review and print without leaving the app window.
 *
 *  - P / Ctrl+P : print
 *  - O          : open in new tab
 *  - Esc        : close
 */
export default function PrintPreview({ path, title = 'Print Preview', onClose }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  const frameRef = useRef(null);

  useEffect(() => {
    let active = true;
    let made = null;
    fetchPdfUrl(path)
      .then((u) => { if (active) { made = u; setUrl(u); } else { URL.revokeObjectURL(u); } })
      .catch((e) => active && setErr(e.message));
    return () => { active = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);

  const doPrint = () => {
    const f = frameRef.current;
    try {
      if (f && f.contentWindow) { f.contentWindow.focus(); f.contentWindow.print(); }
    } catch (_) { openPdf(path); }
  };

  useHotkeys(
    {
      escape: () => onClose && onClose(),
      p: () => doPrint(),
      'ctrl+p': () => doPrint(),
      o: () => openPdf(path),
    },
    [path, url],
    { modal: true }
  );

  return (
    <div className="modal-overlay">
      <div className="modal lg">
        <div className="modal-head">
          <span>🖨 {title}</span>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: '#5a5a5a' }}>
          {err ? (
            <div className="alert alert-danger" style={{ margin: 16 }}>{err}</div>
          ) : !url ? (
            <div style={{ color: '#fff', textAlign: 'center', paddingTop: 60 }}>Rendering PDF…</div>
          ) : (
            <iframe ref={frameRef} title="pdf" src={url + '#toolbar=0'} style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>P = Print · O = Open in tab · Esc = Close</span>
          <button className="btn" onClick={() => openPdf(path)}>Open in Tab (O)</button>
          <button className="btn btn-primary" onClick={doPrint} data-accept="1">Print (P)</button>
        </div>
      </div>
    </div>
  );
}
