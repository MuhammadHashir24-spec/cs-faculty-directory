(function () {
  'use strict';
  var RANKS = ['Professor', 'Associate Professor', 'Assistant Professor', 'Senior Lecturer', 'Lecturer', 'Visiting Faculty', 'Other'];
  var COLS = ['name', 'designation', 'qualification', 'areas', 'email', 'office', 'hours', 'phone', 'courses', 'link', 'bio'];

  var app = document.getElementById('app');
  var state = { meta: { department: 'Department of Computer Science', institution: '' }, faculty: [], updated: '' };
  var ui = { q: '', rank: '', area: '', open: {}, admin: false, moreAreas: false, busy: false, del: null,
    rankBox: null, areaBox: null, resultsBox: null, sheet: null, status: null, loadError: '' };
  var toastTimer = null;

  /* ---------- server calls ---------- */
  function api(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          if (r.status === 401 && ui.admin) { ui.admin = false; }
          throw new Error((data && data.error) || 'Request failed (' + r.status + ').');
        }
        return data;
      });
    }, function () { throw new Error('Could not reach the server. Check your connection.'); });
  }
  function load() {
    return api('GET', '/api/directory').then(function (d) {
      state = { meta: d.meta, faculty: d.faculty, updated: d.updated || '' };
      ui.loadError = '';
    });
  }

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }

  /* ---------- helpers ---------- */
  function rankIndex(r) { var i = RANKS.indexOf(r); return i < 0 ? RANKS.length : i; }
  function cmp(a, b) { return rankIndex(a.designation) - rankIndex(b.designation) || a.name.localeCompare(b.name); }
  function initials(name) {
    var parts = name.split(/\s+/).filter(function (p) { return p && !/^(dr|prof|engr|mr|ms|mrs|ir)\.?$/i.test(p); });
    if (!parts.length) parts = name.split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function splitAreas(t) { return t.split(/[;,|]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function safeUrl(u) { return /^https?:\/\/[^\s]+$/i.test(u); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function allAreas() {
    var m = {};
    state.faculty.forEach(function (f) { f.areas.forEach(function (a) { m[a] = (m[a] || 0) + 1; }); });
    return Object.keys(m).map(function (k) { return { name: k, n: m[k] }; })
      .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  }
  function visible() {
    var terms = ui.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return state.faculty.filter(function (f) {
      if (ui.rank && f.designation !== ui.rank) return false;
      if (ui.area && f.areas.indexOf(ui.area) < 0) return false;
      if (!terms.length) return true;
      var hay = [f.name, f.designation, f.qualification, f.areas.join(' '), f.courses, f.office, f.email].join(' ').toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    }).sort(cmp);
  }
  function copy(text, label) {
    var fail = function () { toast('Copying is blocked here. Press and hold the text to select it: ' + text, true, 6000); };
    try { navigator.clipboard.writeText(text).then(function () { toast(label + ' copied'); }, fail); } catch (e) { fail(); }
  }
  function toast(msg, bad, ms) {
    var old = document.getElementById('toast');
    if (old) old.remove();
    clearTimeout(toastTimer);
    var t = h('div', { id: 'toast', class: 'toast' + (bad ? ' bad' : ''), role: 'status', text: msg });
    document.body.append(t);
    toastTimer = setTimeout(function () { t.remove(); }, ms || 2600);
  }

  /* ---------- actions (each one talks to the server, then refreshes) ---------- */
  function run(work, doneMsg) {
    if (ui.busy) return;
    ui.busy = true;
    sheetStatus('Saving…');
    work().then(load).then(function () {
      ui.busy = false;
      closeSheet();
      renderAll();
      toast(doneMsg || 'Saved');
    }).catch(function (e) {
      ui.busy = false;
      sheetStatus(e.message, true);
      toast(e.message, true, 4500);
      if (!ui.admin) renderAll();
    });
  }

  /* ---------- rendering ---------- */
  function renderAll() {
    app.textContent = '';
    var wrap = h('div', { class: 'wrap' });
    wrap.append(masthead());
    if (ui.admin) wrap.append(adminBar());
    if (ui.loadError) wrap.append(h('div', { class: 'empty' }, h('h2', { text: 'Could not load the directory' }), h('p', { text: ui.loadError }),
      h('button', { class: 'btn', type: 'button', onclick: start }, 'Try again')));
    if (state.faculty.length) wrap.append(controls());
    ui.resultsBox = h('div', { id: 'results' });
    if (!ui.loadError) wrap.append(ui.resultsBox);
    wrap.append(footer());
    app.append(wrap);
    document.title = state.meta.department + ' faculty';
    renderChips();
    if (!ui.loadError) renderResults();
  }

  function masthead() {
    var n = state.faculty.length, k = allAreas().length;
    return h('header', { class: 'mast' },
      h('div', { class: 't' },
        h('p', { class: 'eyebrow', text: 'Faculty directory' }),
        h('h1', { text: state.meta.department }),
        state.meta.institution ? h('p', { class: 'inst', text: state.meta.institution }) : null,
        n ? h('ul', { class: 'stats' },
          h('li', null, h('b', { text: n }), ' faculty'),
          h('li', null, h('b', { text: k }), k === 1 ? ' research area' : ' research areas')) : null),
      h('button', { class: 'ghost', type: 'button', onclick: function () { copy(location.href, 'Link'); } }, 'Copy link'));
  }

  function adminBar() {
    return h('div', { class: 'admin' },
      h('span', { text: 'You are signed in as admin. Visitors see this page read-only.' }),
      h('button', { class: 'btn', type: 'button', onclick: function () { openForm(null); } }, 'Add faculty'),
      h('button', { class: 'ghost', type: 'button', onclick: openImport }, 'Import or export'),
      h('button', { class: 'ghost', type: 'button', onclick: openSettings }, 'Department name'),
      h('button', { class: 'ghost', type: 'button', onclick: signOut }, 'Sign out'));
  }

  function controls() {
    var input = h('input', { id: 'q', type: 'search', placeholder: 'Search name, research area, course or room', autocomplete: 'off', 'aria-label': 'Search faculty', value: ui.q });
    var clear = h('button', { type: 'button', 'aria-label': 'Clear search', hidden: !ui.q, text: 'Clear' });
    input.addEventListener('input', function () { ui.q = input.value; clear.hidden = !ui.q; renderResults(); });
    clear.addEventListener('click', function () { ui.q = ''; input.value = ''; clear.hidden = true; input.focus(); renderResults(); });
    var s = h('div', { class: 'search' });
    s.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';
    s.append(input, clear);
    ui.rankBox = h('div', { class: 'chips' });
    ui.areaBox = h('div', { class: 'chips' });
    return h('div', { class: 'filters' }, h('div', { class: 'bar' }, s), ui.rankBox, ui.areaBox);
  }

  function renderChips() {
    if (!ui.rankBox || !state.faculty.length) return;
    ui.rankBox.textContent = '';
    ui.areaBox.textContent = '';
    var counts = {};
    state.faculty.forEach(function (f) { counts[f.designation] = (counts[f.designation] || 0) + 1; });
    ui.rankBox.append(h('span', { class: 'lbl', text: 'Designation' }));
    RANKS.concat(Object.keys(counts).filter(function (r) { return RANKS.indexOf(r) < 0; })).forEach(function (r) {
      if (!counts[r]) return;
      ui.rankBox.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ui.rank === r),
        onclick: function () { ui.rank = ui.rank === r ? '' : r; renderChips(); renderResults(); } },
        r, h('span', { class: 'n', text: counts[r] })));
    });
    var areas = allAreas();
    if (!areas.length) return;
    ui.areaBox.append(h('span', { class: 'lbl', text: 'Research area' }));
    var shown = ui.moreAreas ? areas : areas.slice(0, 10);
    if (ui.area && shown.every(function (a) { return a.name !== ui.area; })) shown = shown.concat(areas.filter(function (a) { return a.name === ui.area; }));
    shown.forEach(function (a) {
      ui.areaBox.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(ui.area === a.name),
        onclick: function () { ui.area = ui.area === a.name ? '' : a.name; renderChips(); renderResults(); } },
        a.name, h('span', { class: 'n', text: a.n })));
    });
    if (areas.length > 10) {
      ui.areaBox.append(h('button', { class: 'more', type: 'button', onclick: function () { ui.moreAreas = !ui.moreAreas; renderChips(); } },
        ui.moreAreas ? 'Show fewer' : 'Show all ' + areas.length));
    }
  }

  function renderResults() {
    var box = ui.resultsBox;
    box.textContent = '';
    if (!state.faculty.length) { box.append(emptyState()); return; }
    var list = visible();
    var filtered = ui.q.trim() || ui.rank || ui.area;
    box.append(h('p', { class: 'count', 'aria-live': 'polite', text: filtered ? 'Showing ' + list.length + ' of ' + state.faculty.length : 'All ' + state.faculty.length + ' faculty' }));
    if (!list.length) {
      box.append(h('div', { class: 'empty' },
        h('h2', { text: 'No faculty match' }),
        h('p', { text: 'Try a different spelling, or remove a filter.' }),
        h('button', { class: 'ghost', type: 'button', onclick: function () { ui.q = ''; ui.rank = ''; ui.area = ''; renderAll(); } }, 'Clear search and filters')));
      return;
    }
    box.append(h('div', { class: 'grid' }, list.map(card)));
  }

  function emptyState() {
    if (ui.admin) {
      return h('div', { class: 'empty' },
        h('h2', { text: 'No faculty added yet' }),
        h('p', { text: 'Add the first profile, or paste a CSV to import everyone at once. Visitors see each profile as soon as you save.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { openForm(null); } }, 'Add first faculty member'),
          h('button', { class: 'ghost', type: 'button', onclick: openImport }, 'Import from CSV')));
    }
    return h('div', { class: 'empty' },
      h('h2', { text: 'Profiles are being added' }),
      h('p', { text: 'The faculty list for this department is not published yet. Check back soon.' }));
  }

  function row(label, value) { return value ? [h('dt', { text: label }), h('dd', { text: value })] : null; }

  function card(f) {
    var hasMore = f.office || f.hours || f.phone || f.courses || f.bio || f.link;
    var open = !!ui.open[f.id];
    var det = h('div', { class: 'det', hidden: !open },
      (f.office || f.hours || f.phone || f.courses) ? h('dl', null, row('Office', f.office), row('Hours', f.hours), row('Phone', f.phone), row('Courses', f.courses)) : null,
      f.bio ? h('p', { text: f.bio }) : null,
      safeUrl(f.link) ? h('a', { href: f.link, target: '_blank', rel: 'noopener noreferrer', text: host(f.link) + ' ↗' }) : null);
    var tog = hasMore ? h('button', { class: 'tog', type: 'button', 'aria-expanded': String(open), text: open ? 'Hide details' : 'Show details' }) : null;
    if (tog) tog.addEventListener('click', function () {
      ui.open[f.id] = !ui.open[f.id];
      det.hidden = !ui.open[f.id];
      tog.setAttribute('aria-expanded', String(!!ui.open[f.id]));
      tog.textContent = ui.open[f.id] ? 'Hide details' : 'Show details';
    });
    var acts = null;
    if (ui.admin) {
      var del = h('button', { class: 'ghost sm danger', type: 'button', text: 'Delete' });
      var t;
      del.addEventListener('click', function () {
        if (ui.del === f.id) { ui.del = null; run(function () { return api('DELETE', '/api/faculty/' + f.id); }, 'Deleted'); return; }
        ui.del = f.id; del.textContent = 'Tap again to delete';
        clearTimeout(t);
        t = setTimeout(function () { ui.del = null; del.textContent = 'Delete'; }, 4000);
      });
      acts = h('div', { class: 'acts' },
        h('button', { class: 'ghost sm', type: 'button', onclick: function () { openForm(f); } }, 'Edit'), del);
    }
    return h('article', { class: 'card' },
      h('div', { class: 'top' },
        h('div', { class: 'ini', 'aria-hidden': 'true', text: initials(f.name) }),
        h('div', { class: 'who' },
          h('h2', { text: f.name }),
          f.designation ? h('p', { class: 'rank', text: f.designation }) : null,
          f.qualification ? h('p', { class: 'qual', text: f.qualification }) : null)),
      f.areas.length ? h('ul', { class: 'tags' }, f.areas.map(function (a) { return h('li', { text: a }); })) : null,
      f.email ? h('div', { class: 'mail' },
        h('a', { class: 'em', href: 'mailto:' + f.email, text: f.email }),
        h('button', { class: 'ghost sm', type: 'button', onclick: function () { copy(f.email, 'Email'); } }, 'Copy')) : null,
      tog, det, acts);
  }

  function footer() {
    var d = state.updated ? new Date(state.updated) : null;
    var ok = d && !isNaN(d.getTime());
    return h('div', { class: 'foot' },
      h('span', { text: ok ? 'Last updated ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '' }),
      ui.admin ? null : h('button', { class: 'linkbtn', type: 'button', onclick: openLogin }, 'Admin sign in'));
  }

  /* ---------- sheets ---------- */
  function openSheet(title, content) {
    closeSheet();
    var sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', { text: title }), content);
    var scrim = h('div', { class: 'scrim' }, sheet);
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closeSheet(); });
    document.body.append(scrim);
    ui.sheet = scrim;
    var first = sheet.querySelector('input,textarea,select');
    if (first) first.focus();
  }
  function closeSheet() { if (ui.sheet) { ui.sheet.remove(); ui.sheet = null; ui.status = null; } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  function sheetStatus(msg, bad) {
    if (!ui.status) return;
    ui.status.textContent = msg;
    ui.status.className = 'st' + (bad ? ' bad' : '');
  }
  function fld(id, label, attrs, hint, wide) {
    return h('label', { class: 'fld' + (wide ? ' w' : ''), for: id }, h('span', { text: label }), h('input', Object.assign({ id: id, autocomplete: 'off' }, attrs)), hint ? h('small', { text: hint }) : null);
  }
  function buttons(submitLabel) {
    ui.status = h('span', { class: 'st', role: 'status' });
    return h('div', { class: 'sbar' }, ui.status,
      h('button', { class: 'ghost', type: 'button', onclick: closeSheet }, 'Cancel'),
      submitLabel ? h('button', { class: 'btn', type: 'submit' }, submitLabel) : null);
  }

  function openLogin() {
    var form = h('form', { class: 'form', novalidate: true },
      h('label', { class: 'fld full', for: 'l-pw' }, h('span', { text: 'Admin password' }),
        h('input', { id: 'l-pw', type: 'password', autocomplete: 'current-password', required: true })),
      h('div', { class: 'full' }, buttons('Sign in')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = document.getElementById('l-pw').value;
      if (!pw) { sheetStatus('Enter the admin password.', true); return; }
      sheetStatus('Signing in…');
      api('POST', '/api/login', { password: pw }).then(function () {
        ui.admin = true; closeSheet(); renderAll(); toast('Signed in');
      }).catch(function (err) { sheetStatus(err.message, true); });
    });
    openSheet('Admin sign in', form);
  }
  function signOut() {
    api('POST', '/api/logout', {}).then(function () { ui.admin = false; renderAll(); toast('Signed out'); })
      .catch(function (e) { toast(e.message, true); });
  }

  function openForm(f) {
    var g = f || { name: '', designation: 'Assistant Professor', qualification: '', areas: [], email: '', office: '', hours: '', phone: '', courses: '', link: '', bio: '' };
    var sel = h('select', { id: 'f-rank' }, RANKS.map(function (r) { return h('option', { value: r, selected: r === g.designation }, r); }));
    var form = h('form', { class: 'form', novalidate: true },
      fld('f-name', 'Full name', { value: g.name, required: true, maxlength: '100' }, null, true),
      h('label', { class: 'fld', for: 'f-rank' }, h('span', { text: 'Designation' }), sel),
      fld('f-qual', 'Qualification', { value: g.qualification, maxlength: '120' }, 'For example PhD, University name'),
      fld('f-areas', 'Research areas', { value: g.areas.join(', '), maxlength: '300' }, 'Separate with commas', true),
      fld('f-email', 'Email', { type: 'email', value: g.email, maxlength: '120' }),
      fld('f-phone', 'Phone or extension', { value: g.phone, maxlength: '50' }),
      fld('f-office', 'Office', { value: g.office, maxlength: '80' }),
      fld('f-hours', 'Office hours', { value: g.hours, maxlength: '120' }),
      fld('f-courses', 'Courses taught', { value: g.courses, maxlength: '300' }, null, true),
      fld('f-link', 'Profile link', { type: 'url', value: g.link, maxlength: '300' }, 'Google Scholar, personal site or university page', true),
      h('label', { class: 'fld w', for: 'f-bio' }, h('span', { text: 'Short bio' }), h('textarea', { id: 'f-bio', rows: '3', maxlength: '600' }, g.bio)),
      h('div', { class: 'full' }, buttons(f ? 'Save changes' : 'Add to directory')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = function (id) { return document.getElementById(id).value.trim(); };
      if (!v('f-name')) { sheetStatus('Enter the faculty member’s name.', true); return; }
      if (v('f-email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('f-email'))) { sheetStatus('That email address does not look right.', true); return; }
      if (v('f-link') && !safeUrl(v('f-link'))) { sheetStatus('The profile link must start with http:// or https://.', true); return; }
      var rec = { name: v('f-name'), designation: v('f-rank'), qualification: v('f-qual'), areas: splitAreas(v('f-areas')),
        email: v('f-email'), office: v('f-office'), hours: v('f-hours'), phone: v('f-phone'), courses: v('f-courses'), link: v('f-link'), bio: v('f-bio') };
      run(function () { return f ? api('PUT', '/api/faculty/' + f.id, rec) : api('POST', '/api/faculty', rec); }, f ? 'Changes saved' : 'Added to the directory');
    });
    openSheet(f ? 'Edit faculty member' : 'Add faculty member', form);
  }

  function openSettings() {
    var form = h('form', { class: 'form', novalidate: true },
      fld('s-dept', 'Department name', { value: state.meta.department, required: true, maxlength: '90' }, null, true),
      fld('s-inst', 'University or institute', { value: state.meta.institution, maxlength: '90' }, 'Shown under the department name. Leave empty to hide it.', true),
      h('div', { class: 'full' }, buttons('Save')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = document.getElementById('s-dept').value.trim();
      if (!d) { sheetStatus('Enter a department name.', true); return; }
      run(function () { return api('PUT', '/api/settings', { department: d, institution: document.getElementById('s-inst').value.trim() }); });
    });
    openSheet('Department name', form);
  }

  function parseCSV(t) {
    var rows = [], r = [], cur = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { r.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(cur); rows.push(r); r = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || r.length) { r.push(cur); rows.push(r); }
    return rows.filter(function (x) { return x.some(function (y) { return y.trim(); }); });
  }
  function toCSV() {
    var q = function (s) { return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [COLS.join(',')].concat(state.faculty.slice().sort(cmp).map(function (f) {
      return COLS.map(function (c) { return q(c === 'areas' ? f.areas.join('; ') : f[c]); }).join(',');
    })).join('\n');
  }

  function openImport() {
    var ta = h('textarea', { id: 'i-csv', rows: '8', class: 'mono-area', placeholder: 'Paste CSV rows here' });
    var form = h('form', { class: 'form', novalidate: true },
      h('p', { class: 'help full', text: 'Paste rows from a spreadsheet saved as CSV. Put several research areas in one cell separated by semicolons. Rows whose name or email is already listed are skipped.' }),
      h('div', { class: 'code full', text: COLS.join(',') }),
      h('label', { class: 'fld full', for: 'i-csv' }, h('span', { text: 'CSV' }), ta),
      h('div', { class: 'full' },
        h('div', { class: 'sbar' },
          h('button', { class: 'ghost', type: 'button', onclick: function () { ta.value = toCSV(); ta.focus(); ta.select(); sheetStatus(state.faculty.length ? 'Current list shown. Copy it from the box.' : 'Nothing to export yet.'); } }, 'Show current list as CSV')),
        buttons('Import rows')));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var rows = parseCSV(ta.value);
      if (!rows.length) { sheetStatus('Paste at least one row.', true); return; }
      var head = rows[0].map(function (x) { return x.trim().toLowerCase(); });
      var hasHead = head.indexOf('name') >= 0;
      var idx = {};
      COLS.forEach(function (c, i) { idx[c] = hasHead ? head.indexOf(c) : i; });
      if (hasHead) rows = rows.slice(1);
      var out = rows.map(function (r) {
        var get = function (c) { return idx[c] >= 0 && r[idx[c]] != null ? r[idx[c]].trim() : ''; };
        var d = get('designation'), match = RANKS.filter(function (x) { return x.toLowerCase() === d.toLowerCase(); })[0];
        var link = get('link');
        return { name: get('name'), designation: match || d || 'Other', qualification: get('qualification'), areas: splitAreas(get('areas')),
          email: get('email'), office: get('office'), hours: get('hours'), phone: get('phone'), courses: get('courses'), link: safeUrl(link) ? link : '', bio: get('bio') };
      });
      if (ui.busy) return;
      ui.busy = true;
      sheetStatus('Importing…');
      api('POST', '/api/import', { rows: out }).then(function (res) {
        return load().then(function () {
          ui.busy = false; closeSheet(); renderAll();
          toast('Added ' + res.added + ', skipped ' + res.skipped, res.added === 0, 4000);
        });
      }).catch(function (err) { ui.busy = false; sheetStatus(err.message, true); });
    });
    openSheet('Import or export', form);
  }

  /* ---------- start ---------- */
  function start() {
    var session = api('GET', '/api/session').then(function (s) { ui.admin = !!s.admin; }).catch(function () {});
    Promise.all([load(), session]).then(renderAll).catch(function (e) {
      ui.loadError = e.message;
      renderAll();
    });
  }
  start();
})();
