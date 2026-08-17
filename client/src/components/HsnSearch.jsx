import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * HSN code autocomplete. Type a code or product keyword (e.g. "shampoo" or "3305")
 * to get suggestions from the bundled HSN dataset; selecting one fills the HSN
 * code and reports its GST rate via onPick({ hsn, desc, gst }).
 */
export default function HsnSearch({ value, onChange, onPick, className = 'fld' }) {
  const [text, setText] = useState(value || '');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => { setText(value || ''); }, [value]);

  // Debounced suggest
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.get('/lookup/hsn?q=' + encodeURIComponent(text)).then((r) => { setList(r || []); setHi(0); }).catch(() => setList([]));
    }, 180);
    return () => clearTimeout(t);
  }, [text, open]);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const choose = (row) => {
    setText(row.hsn);
    onChange && onChange(row.hsn);
    onPick && onPick(row);
    setOpen(false);
  };

  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open && list[hi]) { e.preventDefault(); e.stopPropagation(); choose(list[hi]); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="ps-wrap" ref={boxRef}>
      <input
        className={className}
        value={text}
        placeholder="HSN code or product (e.g. shampoo)"
        onChange={(e) => { setText(e.target.value); onChange && onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && list.length > 0 && (
        <div className="ps-pop">
          {list.map((row, i) => (
            <div
              key={row.hsn}
              className={'ps-opt ' + (i === hi ? 'hi' : '')}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(row); }}
            >
              <span className="ps-name"><b>{row.hsn}</b> · {row.desc}</span>
              <span className="ps-stock">{row.gst}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
