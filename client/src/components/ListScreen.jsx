import { useEffect, useRef, useState } from 'react';
import { useHotkeys } from '../keyboard';
import { Empty } from './ui';

/**
 * Keyboard-navigable list/table (Tally style).
 *  - ↑/↓ move the highlight, Enter fires onEnter(row), Del/F8 fires onDelete.
 *  - columns: [{ key, label, align, render, width }]
 */
export function ListScreen({
  columns, rows, onEnter, onDelete, getKey = (r, i) => r.id ?? i, filterText = '',
  emptyIcon = '📭', emptyText = 'No records found', extraHotkeys = {}, deps = [],
}) {
  const [idx, setIdx] = useState(0);
  const bodyRef = useRef(null);

  useEffect(() => { if (idx >= rows.length) setIdx(Math.max(0, rows.length - 1)); }, [rows.length]);

  useHotkeys(
    {
      arrowdown: () => setIdx((i) => Math.min(rows.length - 1, i + 1)),
      arrowup: () => setIdx((i) => Math.max(0, i - 1)),
      pagedown: () => setIdx((i) => Math.min(rows.length - 1, i + 10)),
      pageup: () => setIdx((i) => Math.max(0, i - 10)),
      home: () => setIdx(0),
      end: () => setIdx(rows.length - 1),
      enter: () => { if (onEnter && rows[idx]) onEnter(rows[idx], idx); },
      f8: () => { if (onDelete && rows[idx]) onDelete(rows[idx], idx); },
      delete: () => { if (onDelete && rows[idx]) onDelete(rows[idx], idx); },
      ...extraHotkeys,
    },
    [rows, idx, onEnter, onDelete, ...deps]
  );

  // keep active row in view
  useEffect(() => {
    const el = bodyRef.current?.querySelector('tr.row-active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!rows.length) return <Empty icon={emptyIcon} text={emptyText} />;

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align || 'left' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {rows.map((r, i) => (
            <tr
              key={getKey(r, i)}
              className={i === idx ? 'row-active' : ''}
              onClick={() => setIdx(i)}
              onDoubleClick={() => onEnter && onEnter(r, i)}
            >
              <td className="num muted">{i + 1}</td>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'text-right num' : c.align === 'center' ? 'text-center' : ''}>
                  {c.render ? c.render(r) : (r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
