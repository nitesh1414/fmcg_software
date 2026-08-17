// Lightweight inline SVG icon set (stroke-based, inherits currentColor).
// Crisp at any DPI — desktop-first, 4K friendly.
const P = {
  dashboard: 'M3 3h8v8H3V3zm10 0h8v5h-8V3zM3 13h8v8H3v-8zm10 3h8v5h-8v-5z',
  sales: 'M4 4h12l4 4v12H4V4zm12 0v4h4M8 12h8M8 16h8',
  invoice: 'M6 2h9l5 5v15H6V2zm9 0v5h5M9 12h6M9 16h6M9 8h3',
  purchase: 'M3 4h4l2.5 12h9L21 7H7M9 20a1 1 0 100 2 1 1 0 000-2zm8 0a1 1 0 100 2 1 1 0 000-2z',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  tag: 'M20 12l-8 8-9-9V3h8l9 9zM7 7h.01',
  account: 'M4 5h16v14H4V5zm0 4h16M9 13h6',
  ledger: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3zm3 5h8M8 12h8M8 16h5',
  gst: 'M4 4h16v16H4V4zm4 4l8 8m0-8l-8 8',
  report: 'M4 20V4m0 16h16M8 16V9m4 7V5m4 11v-4',
  chart: 'M4 20V4m0 16h16M8 16l3-4 3 2 4-6',
  settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zM2 12h2m16 0h2M12 2v2m0 16v2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  cash: 'M2 6h20v12H2V6zm0 4h20M6 14h2',
  people: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 0112 0v1M17 13a6 6 0 015 6v2',
  chat: 'M21 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h13a2 2 0 012 2v10z',
  person: 'M12 7a4 4 0 100 8 4 4 0 000-8zM4 21v-1a8 8 0 0116 0v1',
  factory: 'M3 21V9l6 4V9l6 4V5l6 0v16H3zM7 21v-4m4 4v-4m4 4v-4',
  check: 'M4 12l5 5L20 6',
  receipt: 'M5 3h14v18l-2-1.5L15 21l-2-1.5L11 21 9 19.5 7 21 5 19.5V3zm3 5h8M8 11h8M8 14h5',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zm6 12l4 4',
  alert: 'M12 3l9 16H3L12 3zm0 6v5m0 3h.01',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  upload: 'M12 21V9m0 0l-4 4m4-4l4 4M4 5h16',
  hash: 'M9 3L7 21M17 3l-2 18M4 8h16M3 16h16',
  trend: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
  help: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 15h.01M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5',
  calendar: 'M4 5h16v16H4V5zm0 5h16M8 3v4m8-4v4',
  pin: 'M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 5a2 2 0 100 4 2 2 0 000-4z',
  palette: 'M12 3a9 9 0 100 18c1.5 0 2-1 2-2 0-1.5-1-1.5-1-3 0-1 1-2 2-2h1a4 4 0 004-4c0-3.5-3.6-7-9-7zM7.5 11.5a1 1 0 100-2 1 1 0 000 2zm4-3a1 1 0 100-2 1 1 0 000 2zm5 2a1 1 0 100-2 1 1 0 000 2z',
  logout: 'M15 12H4m0 0l4-4m-4 4l4 4M14 4h5v16h-5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  shield: 'M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3zm-1.5 9.5l-2-2M10.5 13.5l4-4',
};

const FILL = { dashboard: true, gst: false };

export default function Icon({ name, size = 18, stroke = 2, style, className }) {
  const d = P[name] || P.box;
  const filled = name === 'dashboard';
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={filled ? 0 : stroke}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
