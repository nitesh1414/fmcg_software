import { createContext, useContext, useEffect, useRef, useCallback } from 'react';

/**
 * Tally/MARG-style keyboard engine.
 *
 * - Global stack of hotkey maps; the topmost screen/modal wins.
 * - F-keys, letter hotkeys, Esc, Ctrl+A (accept), Ctrl+Q (quit/back) etc.
 * - Enter moves to the next field (like Tally), Tab also works natively.
 */

const KeyCtx = createContext(null);

// Normalise a keyboard event into a string token, e.g. "f5", "ctrl+a", "alt+c", "esc", "enter".
export function keyToken(e) {
  let k = e.key;
  if (k === ' ') k = 'space';
  k = k.toLowerCase();
  // For Alt/Ctrl + number, prefer the physical key code so it works even when
  // the OS maps Alt+digit to a special character (e.g. macOS).
  if ((e.altKey || e.ctrlKey) && /^Digit\d$/.test(e.code || '')) {
    k = e.code.slice(5); // "Digit1" -> "1"
  }
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && k.length > 1) parts.push('shift'); // shift only as modifier for named keys
  parts.push(k);
  return parts.join('+');
}

export function KeyboardProvider({ children }) {
  const stackRef = useRef([]); // array of { id, map } ; last = active

  const push = useCallback((entry) => {
    stackRef.current.push(entry);
    return () => {
      stackRef.current = stackRef.current.filter((e) => e.id !== entry.id);
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const token = keyToken(e);
      const stack = stackRef.current;

      // When the user is typing in a field, only allow "command" shortcuts
      // (Ctrl/Alt combos, function keys, Escape, Enter). Plain letter/number
      // hotkeys must NOT fire, otherwise typing "sale" would trigger menu keys.
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
      if (typing) {
        const isFn = /^f\d{1,2}$/.test(e.key.toLowerCase());
        const isCommand = e.ctrlKey || e.altKey || e.metaKey || isFn || e.key === 'Escape';
        if (!isCommand) return; // let the keystroke reach the field normally
      }
      // When any modal is open, only modal-flagged handlers are eligible so that
      // a child's hotkey map AND its parent <Modal> Esc/Ctrl+A both get a chance,
      // while keys never leak to the screen underneath the modal.
      const modalOpen = stack.some((s) => s.modal);

      // Build the eligible list (top of stack first). Entries flagged `popup`
      // (inline dropdowns / quick-add overlays) are floated to the front so
      // their Esc closes the popup BEFORE a parent <Modal> Esc closes the form.
      const eligible = [];
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack[i];
        if (modalOpen && !entry.modal) continue; // skip screen-level maps under a modal
        eligible.push(entry);
      }
      eligible.sort((a, b) => (b.popup ? 1 : 0) - (a.popup ? 1 : 0)); // stable: popups first

      for (const entry of eligible) {
        const fn = (entry.map || {})[token];
        if (fn) {
          const handled = fn(e);
          if (handled === false) {
            // Handler declined — let the next map get a chance (e.g. a closed
            // popup defers to the <Modal> Esc; TopNav defers to the screen Esc).
            continue;
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  return <KeyCtx.Provider value={{ push }}>{children}</KeyCtx.Provider>;
}

let _id = 0;
/** Register a hotkey map for the lifetime of a component. */
export function useHotkeys(map, deps = [], opts = {}) {
  const ctx = useContext(KeyCtx);
  const idRef = useRef('hk' + ++_id);
  useEffect(() => {
    if (!ctx) return;
    return ctx.push({ id: idRef.current, map, modal: !!opts.modal, popup: !!opts.popup });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Enter-to-next-field behaviour (Tally style).
 * Attach the returned onKeyDown to a wrapping element. Pressing Enter on an
 * input/select advances to the next focusable field. Shift+Enter goes back.
 * Textareas and buttons are left alone.
 */
export function useEnterNav() {
  return useCallback((e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'button') return;
    if (el.dataset && el.dataset.noenter === '1') return;
    e.preventDefault();
    const container = e.currentTarget;
    const focusables = Array.from(
      container.querySelectorAll('input, select, textarea, button[data-enterstop="1"]')
    ).filter((n) => !n.disabled && n.offsetParent !== null);
    const idx = focusables.indexOf(el);
    if (idx === -1) return;
    const next = e.shiftKey ? focusables[idx - 1] : focusables[idx + 1];
    if (next) {
      next.focus();
      if (next.select) try { next.select(); } catch (_) {}
    } else if (!e.shiftKey) {
      // Last field: trigger the form's submit/accept button if present.
      const accept = container.querySelector('[data-accept="1"]');
      if (accept) accept.click();
    }
  }, []);
}
