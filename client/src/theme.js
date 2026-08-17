// ---------------------------------------------------------------------------
// Theme engine: multiple colour palettes + density, persisted to localStorage.
// Each palette sets CSS custom properties on <html> so the whole UI re-skins.
// Palettes are tuned for billing readability and long-session eye comfort.
// ---------------------------------------------------------------------------

export const PALETTES = [
  {
    id: 'teal', name: 'Teal Fresh', dark: false, swatch: '#14796a',
    desc: 'Default · crisp & calm',
    vars: {
      primary: '#14796a', primaryDark: '#0d5749', primaryDarker: '#0a4035', primaryLight: '#1c9c86',
      soft: '#e7f3f0', softer: '#f2f8f7', accent: '#c0392b', green: '#1e8e3e', amber: '#b06f00', gold: '#f5b301',
      bg: '#eef1f3', surface: '#ffffff', ink: '#1f2b34', muted: '#6b7b85', border: '#d4dde0', borderDark: '#b9c6ca',
      rowAlt: '#f6f9f9', fieldBg: '#ffffff', fieldFocus: '#fffbe6',
    },
  },
  {
    id: 'indigo', name: 'Indigo Pro', dark: false, swatch: '#3949ab',
    desc: 'Classic ERP blue',
    vars: {
      primary: '#3949ab', primaryDark: '#283593', primaryDarker: '#1a237e', primaryLight: '#5c6bc0',
      soft: '#e8eaf6', softer: '#f3f4fb', accent: '#d32f2f', green: '#2e7d32', amber: '#b06f00', gold: '#f5b301',
      bg: '#eef0f6', surface: '#ffffff', ink: '#1c2333', muted: '#69708a', border: '#d3d8e8', borderDark: '#b7bedb',
      rowAlt: '#f5f6fc', fieldBg: '#ffffff', fieldFocus: '#fffbe6',
    },
  },
  {
    id: 'royal', name: 'Ocean Blue', dark: false, swatch: '#1565c0',
    desc: 'Bright & vivid',
    vars: {
      primary: '#1565c0', primaryDark: '#0d47a1', primaryDarker: '#0a3576', primaryLight: '#1e88e5',
      soft: '#e3f2fd', softer: '#f1f8fe', accent: '#e53935', green: '#2e7d32', amber: '#b06f00', gold: '#fbc02d',
      bg: '#eef2f7', surface: '#ffffff', ink: '#16263a', muted: '#5f7187', border: '#d2dce8', borderDark: '#b4c4d6',
      rowAlt: '#f4f8fc', fieldBg: '#ffffff', fieldFocus: '#fffbe6',
    },
  },
  {
    id: 'emerald', name: 'Emerald', dark: false, swatch: '#1e8e5a',
    desc: 'Vibrant green',
    vars: {
      primary: '#1e8e5a', primaryDark: '#15703f', primaryDarker: '#0f5630', primaryLight: '#2cb673',
      soft: '#e4f5ec', softer: '#f1faf5', accent: '#d84315', green: '#1e8e3e', amber: '#b06f00', gold: '#f5b301',
      bg: '#eef3f0', surface: '#ffffff', ink: '#1c2b24', muted: '#647a6e', border: '#d2e0d8', borderDark: '#b6ccbf',
      rowAlt: '#f4faf6', fieldBg: '#ffffff', fieldFocus: '#fffbe6',
    },
  },
  {
    id: 'warm', name: 'Warm Sand', dark: false, swatch: '#b9772e',
    desc: 'Low blue-light · easy on eyes',
    vars: {
      primary: '#b06f24', primaryDark: '#8a5616', primaryDarker: '#6b4210', primaryLight: '#d08a3a',
      soft: '#f6ecdd', softer: '#faf4ea', accent: '#bf360c', green: '#2e7d32', amber: '#9a6100', gold: '#e0a000',
      bg: '#f4ece0', surface: '#fffaf2', ink: '#3a2e20', muted: '#8a7a66', border: '#e3d4bf', borderDark: '#cdb894',
      rowAlt: '#faf4e9', fieldBg: '#fffaf2', fieldFocus: '#fff3d6',
    },
  },
  {
    id: 'midnight', name: 'Midnight', dark: true, swatch: '#1f6feb',
    desc: 'Dark · minimal eye strain',
    vars: {
      primary: '#2f81f7', primaryDark: '#1f6feb', primaryDarker: '#16335c', primaryLight: '#58a6ff',
      soft: '#1b2333', softer: '#171e2b', accent: '#f85149', green: '#3fb950', amber: '#d29922', gold: '#e3b341',
      bg: '#0d1117', surface: '#161b22', ink: '#e6edf3', muted: '#8b98a8', border: '#2a3340', borderDark: '#3a4654',
      rowAlt: '#1a212c', fieldBg: '#0d1117', fieldFocus: '#1c2738',
    },
  },
  {
    id: 'carbon', name: 'Carbon Teal', dark: true, swatch: '#2dd4bf',
    desc: 'Dark neutral · teal accent',
    vars: {
      primary: '#14b8a6', primaryDark: '#0d9488', primaryDarker: '#10302d', primaryLight: '#2dd4bf',
      soft: '#1c2526', softer: '#181f20', accent: '#f87171', green: '#34d399', amber: '#fbbf24', gold: '#fbbf24',
      bg: '#0f1415', surface: '#191f20', ink: '#e3e9e8', muted: '#8b9a98', border: '#2b3433', borderDark: '#3b4645',
      rowAlt: '#1b2222', fieldBg: '#0f1415', fieldFocus: '#1f2c2a',
    },
  },
  {
    id: 'contrast', name: 'High Contrast', dark: true, swatch: '#ffd400',
    desc: 'Max readability',
    vars: {
      primary: '#ffd400', primaryDark: '#e6bf00', primaryDarker: '#3a3000', primaryLight: '#ffe24d',
      soft: '#1a1a1a', softer: '#141414', accent: '#ff5252', green: '#4caf50', amber: '#ffb300', gold: '#ffd400',
      bg: '#000000', surface: '#121212', ink: '#ffffff', muted: '#cfcfcf', border: '#3a3a3a', borderDark: '#555555',
      rowAlt: '#1a1a1a', fieldBg: '#000000', fieldFocus: '#2a2600',
    },
  },
];

export const DENSITIES = [
  { id: 'comfortable', name: 'Comfortable', scale: 1, pad: 1 },
  { id: 'cozy', name: 'Cozy', scale: 0.96, pad: 0.85 },
  { id: 'compact', name: 'Compact (more rows)', scale: 0.92, pad: 0.7 },
];

export const TEXT_SIZES = [
  { id: 'normal', name: 'Normal', px: 14 },
  { id: 'large', name: 'Large', px: 15.5 },
  { id: 'xl', name: 'Extra Large', px: 17 },
];

const STORE_KEY = 'stockveda_theme';            // pre-login / last-used (fast first paint)
const userKey = (uid) => `stockveda_theme_u${uid}`; // per-user cache

const DEFAULTS = { palette: 'teal', density: 'comfortable', textSize: 'normal' };

function normalize(p) {
  p = p || {};
  return {
    palette: p.palette || DEFAULTS.palette,
    density: p.density || DEFAULTS.density,
    textSize: p.textSize || DEFAULTS.textSize,
  };
}

// Load a theme. With a userId, ONLY that user's cache is used (no cross-user
// leakage) — falling back to defaults if they have none yet. Without a userId
// (pre-login), the shared "last used" key is used just to avoid a flash.
export function loadThemePrefs(userId) {
  try {
    if (userId != null) {
      const raw = localStorage.getItem(userKey(userId));
      return raw ? normalize(JSON.parse(raw)) : { ...DEFAULTS };
    }
    return normalize(JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
  } catch (_) {
    return { ...DEFAULTS };
  }
}

// Persist to the shared key and (when known) the per-user key.
export function saveThemePrefs(prefs, userId) {
  const v = JSON.stringify(normalize(prefs));
  localStorage.setItem(STORE_KEY, v);
  if (userId != null) localStorage.setItem(userKey(userId), v);
}

// On-the-fly: derive a soft "on-primary readable" + ensure on dark themes contrasts.
export function applyTheme(prefs) {
  const pal = PALETTES.find((p) => p.id === prefs.palette) || PALETTES[0];
  const dens = DENSITIES.find((d) => d.id === prefs.density) || DENSITIES[0];
  const ts = TEXT_SIZES.find((t) => t.id === prefs.textSize) || TEXT_SIZES[0];
  const v = pal.vars;
  const root = document.documentElement;
  const set = (k, val) => root.style.setProperty(k, val);

  // Core palette → CSS variables (and legacy aliases used across the app)
  set('--primary', v.primary); set('--teal', v.primary); set('--navy', v.primary); set('--sel', v.primary);
  set('--teal-dark', v.primaryDark); set('--navy2', v.primaryDark);
  set('--teal-darker', v.primaryDarker);
  set('--teal-light', v.primaryLight);
  set('--teal-soft', v.soft); set('--panel', v.soft);
  set('--teal-softer', v.softer);
  set('--accent', v.accent);
  set('--green', v.green); set('--amber', v.amber); set('--gold', v.gold);
  set('--bg', v.bg);
  set('--surface', v.surface); set('--cream', v.surface);
  set('--ink', v.ink);
  set('--muted', v.muted);
  set('--border', v.border);
  set('--border-dark', v.borderDark);
  set('--row-alt', v.rowAlt);
  set('--field-bg', v.fieldBg);
  set('--field-focus', v.fieldFocus);
  set('--sel-text', '#ffffff');

  // Text on the header / primary surfaces (yellow theme needs dark text)
  const onPrimary = pal.id === 'contrast' ? '#1a1a1a' : '#ffffff';
  set('--on-primary', onPrimary);

  // Work-area panel header: readable in both light & dark themes.
  // Light → tinted brand text on soft tint; Dark → light ink on a subtle surface.
  set('--head-text', pal.dark ? v.ink : v.primaryDark);
  set('--sel-text', pal.id === 'contrast' ? '#1a1a1a' : '#ffffff');

  // Density + text size
  set('--ui-scale', String(dens.scale));
  set('--pad-scale', String(dens.pad));
  root.style.fontSize = ts.px + 'px';

  root.setAttribute('data-theme', pal.id);
  root.setAttribute('data-mode', pal.dark ? 'dark' : 'light');
}
