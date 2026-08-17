// Central navigation map: main groups for the dashboard + top menu.
// Top-level groups (as requested): Billing, Accounting, GST, Report.
// Each group expands to its related screens.

// ---------------------------------------------------------------------------
// GLOBAL "Go To" shortcuts — work from ANY screen or sub-tab (registered once
// in TallyFrame). They use Alt+<letter> mnemonics which are conflict-free:
//  - Alt combos fire even while typing in a search box.
//  - No page uses Alt+<letter> at screen level, so they never get shadowed
//    (unlike F-keys, which mean different things on different screens).
// While a modal/voucher form is open these intentionally do NOT fire, so you
// can't accidentally navigate away mid-entry.
// ---------------------------------------------------------------------------
export const GOTO = [
  { keys: 'alt+h', label: 'Alt+H', to: '/',                        name: 'Dashboard (Home)' },
  { keys: 'alt+s', label: 'Alt+S', to: '/sales',                  name: 'Sales Voucher', mod: 'sales' },
  { keys: 'alt+q', label: 'Alt+Q', to: '/quotations',            name: 'Quotations', mod: 'sales' },
  { keys: 'alt+p', label: 'Alt+P', to: '/purchases',             name: 'Purchase Voucher', mod: 'purchase' },
  { keys: 'alt+r', label: 'Alt+R', to: '/payments',              name: 'Receipts & Payments', mod: 'payments' },
  { keys: 'alt+a', label: 'Alt+A', to: '/parties',               name: 'Parties (Accounts)', mod: 'parties' },
  { keys: 'alt+i', label: 'Alt+I', to: '/items',                 name: 'Items / Stock Master', mod: 'items' },
  { keys: 'alt+b', label: 'Alt+B', to: '/inventory',             name: 'Batch / Serial Inventory', mod: 'items' },
  { keys: 'alt+g', label: 'Alt+G', to: '/reports?r=gst-return',  name: 'GST Return', mod: 'gst' },
  { keys: 'alt+o', label: 'Alt+O', to: '/reports',               name: 'Reports', mod: 'reports' },
];

// Each item carries `mod` = the permission module it needs (read access to show).
// Items with no `mod` are always visible. `adminItem: true` = admin only.
export const SECTIONS = [
  {
    id: 'billing', label: 'Billing', icon: 'invoice', key: 'Alt+1', cls: 'sc-billing',
    desc: 'Sales, purchase & inventory', mods: ['sales', 'purchase', 'items'],
    items: [
      { to: '/sales', label: 'Sales Voucher', icon: 'sales', key: 'Alt+S', mod: 'sales' },
      { to: '/quotations', label: 'Quotations', icon: 'invoice', key: 'Alt+Q', mod: 'sales' },
      { to: '/sales?new=credit', label: 'Credit Note', icon: 'receipt', mod: 'sales' },
      { to: '/sales?new=debit', label: 'Debit Note', icon: 'receipt', mod: 'sales' },
      { to: '/purchases', label: 'Purchase Voucher', icon: 'purchase', key: 'Alt+P', mod: 'purchase' },
      { sep: true },
      { to: '/items', label: 'Items / Stock Master', icon: 'box', key: 'Alt+I', mod: 'items' },
      { to: '/inventory', label: 'Batch / Serial Inventory', icon: 'tag', key: 'Alt+B', mod: 'items' },
      { to: '/serials', label: 'Serial / Batch Lookup', icon: 'search', mod: 'items' },
      { to: '/reports?r=stock', label: 'Stock Report', icon: 'chart', mod: 'reports' },
    ],
  },
  {
    id: 'accounting', label: 'Accounting', icon: 'ledger', key: 'Alt+2', cls: 'sc-accounts',
    desc: 'Parties, cash & ledgers', mods: ['parties', 'payments'],
    items: [
      { to: '/parties', label: 'Parties (All)', icon: 'people', key: 'Alt+A', mod: 'parties' },
      { to: '/parties?type=customer', label: 'Customers', icon: 'person', mod: 'parties' },
      { to: '/parties?type=supplier', label: 'Suppliers', icon: 'factory', mod: 'parties' },
      { to: '/payments', label: 'Receipts & Payments', icon: 'cash', key: 'Alt+R', mod: 'payments' },
      { to: '/eway', label: 'E-Way Bills', icon: 'purchase', mod: 'payments' },
      { sep: true },
      { to: '/reports?r=outstanding', label: 'Outstanding', icon: 'pin', mod: 'reports' },
      { to: '/reports?r=fy-balance', label: 'Financial Year Balance', icon: 'calendar', mod: 'reports' },
    ],
  },
  {
    id: 'gst', label: 'GST', icon: 'gst', key: 'Alt+3', cls: 'sc-gst',
    desc: 'Returns & compliance', mods: ['gst'],
    items: [
      { to: '/reports?r=gst-return', label: 'GST Return (GSTR-1/3B)', icon: 'invoice', key: 'Alt+G', mod: 'gst' },
      { to: '/reports?r=gstr1-json', label: 'GSTR-1 JSON Export', icon: 'download', mod: 'gst' },
      { to: '/reports?r=hsn', label: 'HSN Summary', icon: 'hash', mod: 'gst' },
      { to: '/reports?r=gst-sale', label: 'GST Summary (Sales)', icon: 'trend', mod: 'gst' },
      { to: '/reports?r=gst-purchase', label: 'GST Summary (Purchase)', icon: 'chart', mod: 'gst' },
    ],
  },
  {
    id: 'report', label: 'Report', icon: 'report', key: 'Alt+4', cls: 'sc-inventory',
    desc: 'Analytics & insights', mods: ['reports'],
    items: [
      { to: '/reports', label: 'All Reports', icon: 'report', key: 'Alt+O', mod: 'reports' },
      { to: '/reports?r=sales', label: 'Sales Register', icon: 'sales', mod: 'reports' },
      { to: '/reports?r=purchase', label: 'Purchase Register', icon: 'purchase', mod: 'reports' },
      { to: '/reports?r=trace', label: 'Batch/Serial Trace', icon: 'search', mod: 'reports' },
      { to: '/reports?r=duplicates', label: 'Duplicate Serial Alerts', icon: 'alert', mod: 'reports' },
    ],
  },
  {
    id: 'system', label: 'System', icon: 'settings', key: 'Alt+5', cls: 'sc-system',
    desc: 'Settings, data & help', adminSection: true,
    items: [
      { to: '/businesses', label: 'Business Profiles', icon: 'factory', adminItem: true },
      { to: '/whatsapp', label: 'WhatsApp Connect', icon: 'chat' },
      { to: '/users', label: 'User Management', icon: 'people', adminItem: true },
      { to: '/migrate', label: 'Import / Migrate Data', icon: 'upload', adminItem: true },
      { to: '/settings', label: 'App Settings', icon: 'settings', key: 'F11', adminItem: true },
      { to: '/license', label: 'License & Activation', icon: 'shield', adminItem: true },
      { sep: true },
      { to: '/support', label: 'Help & Support', icon: 'help', key: 'F1' },
    ],
  },
];

