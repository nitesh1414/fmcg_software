import { useTheme } from '../themeContext';
import { PALETTES, DENSITIES, TEXT_SIZES } from '../theme';
import { useHotkeys } from '../keyboard';
import Icon from './Icon';

export default function ThemePanel({ onClose }) {
  const { prefs, setPalette, setDensity, setTextSize } = useTheme();
  useHotkeys({ escape: () => onClose() }, [onClose], { modal: true });

  return (
    <div className="modal-overlay">
      <div className="modal lg">
        <div className="modal-head">
          <span><Icon name="palette" size={16} style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6 }} /> Appearance &amp; Theme</span>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="entry-sec">Color Scheme</div>
          <div className="theme-grid">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                className={'theme-swatch ' + (prefs.palette === p.id ? 'sel' : '')}
                onClick={() => setPalette(p.id)}
                title={p.desc}
              >
                <span className="ts-row">
                  <span className="ts-dot" style={{ background: p.swatch }} />
                  <span className="ts-mode">{p.dark ? '🌙' : '☀'}</span>
                </span>
                <span className="ts-name">{p.name}</span>
                <span className="ts-desc">{p.desc}</span>
                {prefs.palette === p.id && <span className="ts-check">✓</span>}
              </button>
            ))}
          </div>

          <div className="entry-sec" style={{ marginTop: 16 }}>Text Size <span className="muted" style={{ fontWeight: 400 }}>· readability</span></div>
          <div className="seg">
            {TEXT_SIZES.map((t) => (
              <button key={t.id} className={'seg-btn ' + (prefs.textSize === t.id ? 'sel' : '')} onClick={() => setTextSize(t.id)}>{t.name}</button>
            ))}
          </div>

          <div className="entry-sec" style={{ marginTop: 16 }}>Row Density <span className="muted" style={{ fontWeight: 400 }}>· rows per screen</span></div>
          <div className="seg">
            {DENSITIES.map((d) => (
              <button key={d.id} className={'seg-btn ' + (prefs.density === d.id ? 'sel' : '')} onClick={() => setDensity(d.id)}>{d.name}</button>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
            Tip: Press <span className="kbd">Ctrl+T</span> anytime to open this panel. Dark themes reduce eye strain for long shifts; “High Contrast” maximises readability.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
