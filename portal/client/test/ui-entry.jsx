// Browser-side half of the portal UI test. Vite bundles this (SSR target) into
// dist-test/ui-entry.js; test/ui.test.mjs loads it inside jsdom and drives the
// real React app against the real portal API.
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../src/auth';
import App from '../src/App';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let root = null;

// Flush pending work: real I/O (fetch) resolves on plain timers, then act()
// pushes the resulting state updates through React.
export async function settle(ms = 80) {
  await sleep(ms);
  await act(async () => {});
  await sleep(ms);
  await act(async () => {});
}

export async function mount(path = '/') {
  if (root) await unmount();
  window.history.pushState({}, '', path);
  const container = document.getElementById('root');
  await act(async () => {
    root = createRoot(container);
    root.render(
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );
  });
  await settle();
}

export async function unmount() {
  if (!root) return;
  await act(async () => { root.unmount(); });
  root = null;
}

export const text = () => document.body.textContent.replace(/\s+/g, ' ').trim();
export const html = () => document.body.innerHTML;
export const all = (sel) => Array.from(document.querySelectorAll(sel));
export const count = (sel) => all(sel).length;

function findClickable(label) {
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const exact = nodes.find((n) => (n.textContent || '').replace(/\s+/g, ' ').trim() === label);
  if (exact) return exact;
  return nodes.find((n) => (n.textContent || '').replace(/\s+/g, ' ').trim().includes(label));
}

export async function clickText(label) {
  const el = findClickable(label);
  if (!el) throw new Error(`No clickable element with text "${label}" on the page`);
  await act(async () => { el.click(); });
  await settle();
  return el;
}

export async function clickRowButton(rowText, buttonLabel) {
  const rows = Array.from(document.querySelectorAll('tr'));
  const firstCellHas = (r) => {
    const td = r.querySelector('td');
    return td && (td.textContent || '').trim().startsWith(rowText);
  };
  // Prefer the row that STARTS with the text (an add-on row also mentions its
  // parent license id, so a plain "contains" match can pick the wrong row).
  const row = rows.find(firstCellHas) || rows.find((r) => (r.textContent || '').includes(rowText));
  if (!row) throw new Error(`No table row containing "${rowText}"`);
  const btn = Array.from(row.querySelectorAll('button'))
    .find((b) => (b.textContent || '').trim().includes(buttonLabel));
  if (!btn) throw new Error(`No "${buttonLabel}" button in row "${rowText}"`);
  await act(async () => { btn.click(); });
  await settle();
  return btn;
}

// Set an input/select/textarea by its <label> text (the portal always labels fields).
export async function typeInField(labelText, value) {
  const label = Array.from(document.querySelectorAll('label'))
    .find((l) => (l.textContent || '').replace(/\s+/g, ' ').trim().startsWith(labelText));
  if (!label) throw new Error(`No field labelled "${labelText}"`);
  const field = label.parentElement.querySelector('input, select, textarea');
  if (!field) throw new Error(`No input inside the "${labelText}" field`);
  const proto = field.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
    : field.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(field, String(value));
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    field.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
  return field;
}

export const checked = (labelText) => {
  const label = Array.from(document.querySelectorAll('label'))
    .find((l) => (l.textContent || '').includes(labelText));
  const box = label && label.parentElement.querySelector('input[type="checkbox"]');
  return box ? box.checked : null;
};

// The top-most (last mounted) modal — forms open on top of the detail sheet.
export const modalTitle = () => {
  const heads = document.querySelectorAll('.modal-head span');
  return heads.length ? heads[heads.length - 1].textContent.trim() : '';
};

// Text of the top-most modal only (so a stacked form isn't confused with what
// is behind it).
export const modalText = () => {
  const m = document.querySelectorAll('.modal');
  return m.length ? (m[m.length - 1].textContent || '').replace(/\s+/g, ' ').trim() : '';
};

export async function clickSelector(sel) {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`No element matching "${sel}"`);
  await act(async () => { el.click(); });
  await settle();
  return el;
}

export const attr = (sel, name) => {
  const el = document.querySelector(sel);
  return el ? el.getAttribute(name) : null;
};

// Responsive tables label every cell so the stacked mobile view can show
// "Expiry  2027-09-03" instead of a bare value.
export const cellsMissingLabel = () =>
  Array.from(document.querySelectorAll('.tbl td')).filter((td) => !td.hasAttribute('data-label')).length;
