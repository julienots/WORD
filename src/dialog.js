// Small Word-like dialog / dropdown helpers (no dependencies).

const host = () => document.getElementById('dialog-host');

/**
 * Open a modal form.
 * fields: [{ name, label, type: 'text'|'number'|'select'|'color'|'checkbox'|'textarea'|'info', value, options:[[value,label]], step, min, max }]
 * Resolves with an object of values, or null when cancelled.
 */
export function formDialog({ title, fields = [], ok = 'OK', cancel = 'Annuler', extraButtons = [] }) {
  return new Promise((resolve) => {
    host().innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'dlg-backdrop';
    const box = document.createElement('form');
    box.className = 'dlg';
    box.noValidate = true;
    box.innerHTML = `<h3></h3><div class="dlg-body"></div><div class="dlg-actions"></div>`;
    box.querySelector('h3').textContent = title;
    const body = box.querySelector('.dlg-body');
    for (const f of fields) {
      const row = document.createElement('label');
      row.className = `dlg-row dlg-${f.type || 'text'}`;
      if (f.type === 'info') {
        row.innerHTML = '<div class="dlg-info"></div>';
        row.querySelector('div').innerHTML = f.html ?? '';
        if (!f.html) row.querySelector('div').textContent = f.value ?? '';
        body.appendChild(row);
        continue;
      }
      const span = document.createElement('span');
      span.textContent = f.label;
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const [v, l] of f.options) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = l;
          input.appendChild(o);
        }
        if (f.value != null) input.value = f.value;
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 3;
        input.value = f.value ?? '';
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
        if (f.type === 'checkbox') input.checked = !!f.value;
        else input.value = f.value ?? '';
        for (const k of ['min', 'max', 'placeholder']) if (f[k] != null) input[k] = f[k];
        if (f.type === 'number') {
          input.step = 'any';
          input.inputMode = 'decimal';
        }
      }
      input.name = f.name;
      if (f.type === 'checkbox') {
        row.append(input, span);
      } else {
        row.append(span, input);
      }
      body.appendChild(row);
    }
    const actions = box.querySelector('.dlg-actions');
    const close = (val) => {
      wrap.remove();
      resolve(val);
    };
    const collect = () => {
      const out = {};
      for (const f of fields) {
        if (!f.name) continue;
        const el = box.elements[f.name];
        if (!el) continue;
        out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? parseFloat(String(el.value).replace(',', '.')) : el.value;
      }
      return out;
    };
    for (const b of extraButtons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.className = 'dlg-extra';
      btn.onclick = () => close({ ...collect(), __action: b.action });
      actions.appendChild(btn);
    }
    if (cancel) {
      const c = document.createElement('button');
      c.type = 'button';
      c.textContent = cancel;
      c.onclick = () => close(null);
      actions.appendChild(c);
    }
    const okBtn = document.createElement('button');
    okBtn.type = 'submit';
    okBtn.className = 'primary';
    okBtn.textContent = ok;
    actions.appendChild(okBtn);
    box.onsubmit = (e) => {
      e.preventDefault();
      close(collect());
    };
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) close(null);
    });
    wrap.appendChild(box);
    host().appendChild(wrap);
    setTimeout(() => box.querySelector('input:not([type=checkbox]),select,textarea')?.focus(), 30);
  });
}

export const infoDialog = (title, html) => formDialog({ title, fields: [{ type: 'info', html }], cancel: null, ok: 'Fermer' });

/**
 * Show a dropdown menu anchored to an element.
 * items: [{ label, html, action, separator, title }]
 */
let openMenu = null;
export function dropdown(anchor, items, { className = '' } = {}) {
  closeDropdown();
  const menu = document.createElement('div');
  menu.className = `rb-menu ${className}`;
  for (const it of items) {
    if (it.separator) {
      const hr = document.createElement('div');
      hr.className = 'rb-sep-h';
      menu.appendChild(hr);
      continue;
    }
    if (it.heading) {
      const h = document.createElement('div');
      h.className = 'rb-menu-head';
      h.textContent = it.heading;
      menu.appendChild(h);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    if (it.html) b.innerHTML = it.html;
    else b.textContent = it.label;
    if (it.title) b.title = it.title;
    if (it.style) b.setAttribute('style', it.style);
    b.onmousedown = (e) => e.preventDefault(); // keep the editor selection
    b.onclick = () => {
      closeDropdown();
      it.action?.();
    };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - mw - 6);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 6) top = Math.max(6, window.innerHeight - mh - 6);
  menu.style.left = `${Math.max(6, left)}px`;
  menu.style.top = `${top}px`;
  openMenu = menu;
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
}
function outside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeDropdown();
}
export function closeDropdown() {
  openMenu?.remove();
  openMenu = null;
  document.removeEventListener('mousedown', outside, true);
}
