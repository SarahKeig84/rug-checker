(function () {
  'use strict';
  const E = window.RugEngine;
  const STORE_KEY = 'rugchecker.v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);

  const PRESETS = {
    outDay: [{ type: 'out', from: '08:00', to: '16:00' }, { type: 'in', from: '16:00', to: '08:00' }],
    inDay:  [{ type: 'in', from: '08:00', to: '17:00' }, { type: 'out', from: '17:00', to: '08:00' }],
    out247: [{ type: 'out', from: '00:00', to: '00:00' }],
    in247:  [{ type: 'in', from: '00:00', to: '00:00' }],
  };

  function newHorse(name = 'My horse') {
    return {
      id: uid(), name, age: 12, breed: 'other', clip: 'none', condition: 'ideal', temperament: 'normal',
      shelter: 'natural', location: null, periods: structuredClone(PRESETS.outDay), rugs: [],
      health: [], precise: false, vetNotes: '',
    };
  }

  // ---------- storage ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.horses) && s.horses.length) return s;
    } catch (e) { /* ignore */ }
    const h = newHorse();
    return { horses: [h], activeId: h.id };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  let state = load();
  const horse = () => state.horses.find(h => h.id === state.activeId) || state.horses[0];
  let day = 0;

  // ---------- helpers ----------
  function fillSelect(sel, map) {
    sel.innerHTML = Object.entries(map).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  }
  fillSelect($('#horseForm [name=breed]'), E.BREEDS);
  fillSelect($('#horseForm [name=clip]'), E.CLIPS);
  fillSelect($('#horseForm [name=condition]'), E.CONDITION);
  fillSelect($('#horseForm [name=temperament]'), E.TEMPERAMENT);
  fillSelect($('#horseForm [name=shelter]'), E.SHELTER);
  fillSelect($('#rugForm [name=type]'), E.RUG_TYPES);
  $('#healthList').innerHTML = Object.entries(E.HEALTH).map(([k, v]) =>
    `<label class="check"><input type="checkbox" name="health" value="${k}" id="health-${k}"><span>${esc(v.label)}</span></label>`).join('');

  // ---------- tabs ----------
  function showTab(name) {
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'today') renderToday();
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- horse picker ----------
  function renderPicker() {
    $('#horseSelect').innerHTML = state.horses.map(h =>
      `<option value="${h.id}" ${h.id === state.activeId ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
  }
  $('#horseSelect').addEventListener('change', e => {
    state.activeId = e.target.value; save(); renderAll();
  });
  $('#addHorse').addEventListener('click', () => {
    const h = newHorse('New horse');
    const cur = horse();
    if (cur && cur.location) { h.location = cur.location; h.shelter = cur.shelter; }
    state.horses.push(h); state.activeId = h.id; save(); renderAll(); showTab('horse');
    $('#horseForm [name=name]').select();
  });

  // ---------- horse form ----------
  let draftPeriods = [];
  let draftLocation = null;

  function renderHorseForm() {
    const h = horse(), f = $('#horseForm');
    ['name', 'age', 'breed', 'clip', 'condition', 'temperament', 'shelter'].forEach(k => { f[k].value = h[k] ?? ''; });
    const health = h.health || [];
    $$('#healthList input').forEach(i => { i.checked = health.includes(i.value); });
    f.precise.checked = !!h.precise;
    f.vetNotes.value = h.vetNotes || '';
    syncPrecise();
    draftPeriods = structuredClone(h.periods);
    draftLocation = h.location;
    renderPeriods();
    renderLocation();
    $('#locResults').innerHTML = '';
    $('#deleteHorse').hidden = state.horses.length < 2;
  }

  // Some conditions always mean "keep closely matched"; show that by ticking and locking the box.
  let preciseByChoice = false;
  function syncPrecise() {
    const box = $('#horseForm [name=precise]');
    const implied = $$('#healthList input:checked').some(i => E.HEALTH[i.value] && E.HEALTH[i.value].precise);
    if (!box.disabled) preciseByChoice = box.checked;
    box.disabled = implied;
    box.checked = implied || preciseByChoice;
  }
  $('#healthList').addEventListener('change', syncPrecise);

  function renderLocation() {
    $('#locCurrent').innerHTML = draftLocation
      ? `Location: <strong>${esc(draftLocation.name)}</strong>`
      : 'No location set yet – search above so we can fetch the forecast.';
  }

  function renderPeriods() {
    $('#periods').innerHTML = draftPeriods.map((p, i) => `
      <div class="period" data-i="${i}">
        <label>Status
          <select data-k="type">
            <option value="out" ${p.type === 'out' ? 'selected' : ''}>Turned out</option>
            <option value="in" ${p.type === 'in' ? 'selected' : ''}>Stabled</option>
          </select>
        </label>
        <label>From <input type="time" step="3600" data-k="from" value="${p.from}"></label>
        <label>To <input type="time" step="3600" data-k="to" value="${p.to}"></label>
        <button type="button" class="ghost" data-del="${i}" title="Remove period" ${draftPeriods.length < 2 ? 'disabled' : ''}>✕</button>
      </div>`).join('');
  }
  $('#periods').addEventListener('change', e => {
    const row = e.target.closest('.period'); if (!row) return;
    draftPeriods[+row.dataset.i][e.target.dataset.k] = e.target.value;
  });
  $('#periods').addEventListener('click', e => {
    const d = e.target.dataset.del; if (d == null) return;
    draftPeriods.splice(+d, 1); renderPeriods();
  });
  $('#addPeriod').addEventListener('click', () => {
    const last = draftPeriods[draftPeriods.length - 1];
    draftPeriods.push({ type: last && last.type === 'out' ? 'in' : 'out', from: last ? last.to : '08:00', to: last ? last.from : '16:00' });
    renderPeriods();
  });
  $$('.presets button').forEach(b => b.addEventListener('click', () => {
    draftPeriods = structuredClone(PRESETS[b.dataset.preset]); renderPeriods();
  }));

  // location search (Open-Meteo geocoding – free, no key)
  async function searchLocation() {
    const q = $('#locSearch').value.trim(); if (!q) return;
    const ul = $('#locResults');
    ul.innerHTML = '<li class="muted">Searching…</li>';
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=20&language=en&format=json`);
      const j = await r.json();
      if (!j.results || !j.results.length) { ul.innerHTML = '<li class="muted">No places found – try a nearby town.</li>'; return; }
      const home = (navigator.language || 'en-GB').split('-')[1] || 'GB';
      const results = j.results
        .map((p, i) => ({ p, i, rank: p.country_code === home ? 0 : p.country_code === 'GB' || p.country_code === 'IE' ? 1 : 2 }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, 8).map(x => x.p);
      ul.innerHTML = results.map((p, i) => {
        const name = [p.name, p.admin2 || p.admin1, p.country].filter(Boolean).join(', ');
        return `<li><button type="button" data-i="${i}" data-name="${esc(name)}" data-lat="${p.latitude}" data-lon="${p.longitude}">${esc(name)}</button></li>`;
      }).join('');
    } catch (e) {
      ul.innerHTML = '<li class="muted">Couldn’t reach the location service. Check your connection.</li>';
    }
  }
  $('#locFind').addEventListener('click', searchLocation);
  $('#locSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchLocation(); } });
  $('#locResults').addEventListener('click', e => {
    const b = e.target.closest('button[data-lat]'); if (!b) return;
    draftLocation = { name: b.dataset.name, lat: +b.dataset.lat, lon: +b.dataset.lon };
    $('#locResults').innerHTML = ''; renderLocation();
  });
  $('#locGeo').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Location isn’t available in this browser.'); return; }
    $('#locCurrent').textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition(
      pos => {
        draftLocation = { name: `My location (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`, lat: pos.coords.latitude, lon: pos.coords.longitude };
        renderLocation();
      },
      () => { $('#locCurrent').textContent = 'Couldn’t get your location – search for a place instead.'; },
      { timeout: 10000 });
  });

  $('#horseForm').addEventListener('submit', e => {
    e.preventDefault();
    const h = horse(), f = e.target;
    h.name = f.name.value.trim() || 'My horse';
    h.age = f.age.value === '' ? null : Number(f.age.value);
    ['breed', 'clip', 'condition', 'temperament', 'shelter'].forEach(k => { h[k] = f[k].value; });
    h.health = $$('#healthList input:checked').map(i => i.value);
    h.precise = f.precise.disabled ? preciseByChoice : f.precise.checked;
    h.vetNotes = f.vetNotes.value.trim();
    h.periods = draftPeriods.filter(p => p.from && p.to);
    if (!h.periods.length) h.periods = structuredClone(PRESETS.outDay);
    h.location = draftLocation;
    save(); renderPicker();
    const s = $('#horseSaved'); s.hidden = false; setTimeout(() => { s.hidden = true; }, 1800);
  });
  $('#deleteHorse').addEventListener('click', () => {
    const h = horse();
    if (state.horses.length < 2) return;
    if (!confirm(`Delete ${h.name} and their rug list? This can’t be undone.`)) return;
    state.horses = state.horses.filter(x => x.id !== h.id);
    state.activeId = state.horses[0].id; save(); renderAll();
  });

  // ---------- rugs ----------
  function rugMeta(r) {
    const t = E.RUG_TYPES[r.type];
    const parts = [t ? t.label : r.type];
    if (!t || !t.special) parts.push(`${r.fill || 0}g`);
    if (r.neck && r.neck !== 'none') parts.push(r.neck === 'combo' ? 'fixed neck' : 'detachable neck');
    if (r.notes) parts.push(r.notes);
    return parts.map(esc).join(' · ');
  }
  function renderRugs() {
    const rugs = horse().rugs;
    const order = ['turnout', 'stable', 'liner', 'fleece', 'fly'];
    const sorted = [...rugs].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || (a.fill - b.fill));
    $('#rugList').innerHTML = sorted.length ? sorted.map(r => `
      <div class="rug-item">
        <div><strong>${esc(r.name)}</strong><div class="meta">${rugMeta(r)}</div></div>
        <div class="btns"><button data-edit="${r.id}">Edit</button><button data-rm="${r.id}" class="danger">Remove</button></div>
      </div>`).join('')
      : '<p class="muted">No rugs yet. Add your turnout rugs, stable rugs and liners below.</p>';
  }
  function resetRugForm() {
    const f = $('#rugForm'); f.reset(); f.id.value = '';
    $('#rugFormTitle').textContent = 'Add a rug'; $('#rugCancel').hidden = true;
  }
  $('#rugList').addEventListener('click', e => {
    const h = horse();
    if (e.target.dataset.rm) {
      const r = h.rugs.find(x => x.id === e.target.dataset.rm);
      if (r && confirm(`Remove “${r.name}” from the inventory?`)) {
        h.rugs = h.rugs.filter(x => x.id !== r.id); save(); renderRugs();
      }
    } else if (e.target.dataset.edit) {
      const r = h.rugs.find(x => x.id === e.target.dataset.edit); if (!r) return;
      const f = $('#rugForm');
      ['id', 'name', 'type', 'fill', 'neck', 'notes'].forEach(k => { f[k].value = r[k] ?? ''; });
      $('#rugFormTitle').textContent = 'Edit rug'; $('#rugCancel').hidden = false;
      f.scrollIntoView({ behavior: 'smooth' });
    }
  });
  $('#rugCancel').addEventListener('click', resetRugForm);
  $('#rugForm [name=type]').addEventListener('change', e => {
    if (e.target.value === 'fly' || e.target.value === 'fleece') $('#rugForm [name=fill]').value = 0;
  });
  $('#rugForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, h = horse();
    const rug = {
      id: f.id.value || uid(), name: f.name.value.trim(), type: f.type.value,
      fill: Math.max(0, Number(f.fill.value) || 0), neck: f.neck.value, notes: f.notes.value.trim(),
    };
    const i = h.rugs.findIndex(r => r.id === rug.id);
    if (i >= 0) h.rugs[i] = rug; else h.rugs.push(rug);
    save(); renderRugs(); resetRugForm();
  });

  // ---------- weather ----------
  const wxCache = new Map();
  async function getForecast(loc, force) {
    const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
    const c = wxCache.get(key);
    if (!force && c && Date.now() - c.at < 30 * 60 * 1000) return c.data;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      '&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m' +
      '&wind_speed_unit=mph&timezone=auto&forecast_days=3';
    const r = await fetch(url);
    if (!r.ok) throw new Error('Forecast unavailable');
    const data = await r.json();
    wxCache.set(key, { at: Date.now(), data });
    return data;
  }

  function hoursFor(data, dayIdx, period) {
    const H = data.hourly;
    const fromH = parseInt(period.from, 10) || 0;
    const toH = parseInt(period.to, 10) || 0;
    const len = ((toH - fromH + 24) % 24) || 24;
    const start = dayIdx * 24 + fromH;
    const rows = [];
    for (let i = start; i < start + len && i < H.time.length; i++) {
      rows.push({
        time: H.time[i], temp: H.temperature_2m[i], precip: H.precipitation[i] ?? 0,
        precipProb: H.precipitation_probability[i] ?? 0, wind: H.wind_speed_10m[i] ?? 0, gust: H.wind_gusts_10m[i] ?? 0,
      });
    }
    return rows.filter(r => r.temp != null);
  }

  function nowLocalKey(data) {
    // current time in the forecast's timezone, formatted like "2026-11-09T14:00"
    const d = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000);
    return d.toISOString().slice(0, 13) + ':00';
  }

  // ---------- today ----------
  let renderSeq = 0;
  async function renderToday(force) {
    const h = horse(), box = $('#results'), seq = ++renderSeq;
    if (!h.location) {
      $('#locLine').textContent = '';
      box.innerHTML = `<div class="card empty"><p>Set <strong>${esc(h.name)}</strong>’s location and routine to get a recommendation.</p>
        <button class="primary" id="goHorse">Set up ${esc(h.name)}</button></div>`;
      $('#goHorse').onclick = () => showTab('horse');
      return;
    }
    $('#locLine').textContent = `${h.name} · ${h.location.name}`;
    box.innerHTML = '<div class="card empty muted">Fetching forecast…</div>';
    let data;
    try { data = await getForecast(h.location, force); }
    catch (e) {
      if (seq === renderSeq) box.innerHTML = '<div class="card empty">Couldn’t fetch the forecast. Check your connection and tap Refresh.</div>';
      return;
    }
    if (seq !== renderSeq) return;

    const now = nowLocalKey(data);
    const month = parseInt(data.hourly.time[0].slice(5, 7), 10);
    const periods = [...h.periods].sort((a, b) => a.from.localeCompare(b.from));
    const cards = [];
    const noRugs = !h.rugs.some(r => E.RUG_TYPES[r.type] && E.RUG_TYPES[r.type].outer);

    for (const p of periods) {
      const hours = hoursFor(data, day, p);
      if (!hours.length) continue;
      const res = E.recommend({ horse: h, type: p.type, hours, inventory: h.rugs, month });
      const past = hours[hours.length - 1].time < now;
      cards.push(renderResult(p, res, hours, past));
    }
    box.innerHTML = (noRugs ? `<div class="card callout">No rugs in ${esc(h.name)}’s inventory yet – showing the ideal weight only. <a href="#" id="goRugs">Add rugs</a> to get a specific pick.</div>` : '')
      + (cards.join('') || '<div class="card empty">No forecast data for this day.</div>');
    const gr = $('#goRugs'); if (gr) gr.onclick = ev => { ev.preventDefault(); showTab('rugs'); };
  }

  function fmtTime(t) { return t.slice(11, 16); }
  function rugName(parts) { return parts.map(r => esc(r.name)).join(' + '); }

  function healthBox(res) {
    const vet = horse().vetNotes;
    if (!vet && !res.healthNotes.length) return '';
    return `<div class="health-box"><h4>Health</h4>
      ${vet ? `<p class="vet"><strong>Vet’s advice:</strong> ${esc(vet)}</p>` : ''}
      ${res.healthNotes.length ? `<ul>${res.healthNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  function renderResult(p, res, hours, past) {
    const w = res.weather;
    const label = p.type === 'out' ? 'Turned out' : 'Stabled';
    const span = p.from === p.to ? 'All day' : `${p.from} → ${p.to}`;
    const wx = [
      `🌡 ${Math.round(w.min)}° to ${Math.round(w.max)}°C`,
      p.type === 'out' ? `💨 ${Math.round(w.wind)} mph (gusts ${Math.round(w.gust)})` : null,
      `🌧 ${w.rainTotal.toFixed(1)} mm · ${w.rainProb}%`,
      `Feels like <strong>${res.feltTemp}°C</strong> for this horse`,
    ].filter(Boolean).map(s => `<span>${s}</span>`).join('');

    let pick;
    if (res.best && res.best.parts.length) {
      const gramsLine = `${res.best.grams}g total · ideal ≈ ${res.targetGrams}g`;
      pick = `<div class="pick ${res.status === 'approx' ? 'warn' : ''}">
        <div class="muted small">Recommended</div>
        <div class="big">${rugName(res.best.parts)}</div>
        <div class="small muted">${gramsLine}</div></div>`;
    } else if (res.best && !res.best.parts.length) {
      pick = `<div class="pick"><div class="muted small">Recommended</div><div class="big">No rug needed</div>
        <div class="small muted">Their own coat should be enough</div></div>`;
    } else {
      pick = `<div class="pick warn"><div class="muted small">Ideal</div><div class="big">${esc(res.describeTarget)}</div>
        <div class="small muted">${p.type === 'out' ? 'You have no waterproof turnout rug in the inventory.' : 'No suitable rug in the inventory.'}</div></div>`;
    }

    const notes = [...res.notes];
    if (res.neckAdvised) {
      const neck = res.best && res.best.hasNeck;
      notes.unshift(neck ? 'Use the neck cover – it’s cold/wet enough to justify one for this clip.' : 'A neck cover is advised in these conditions for this clip.');
    }
    const alts = res.alternatives.length ? `<p class="small muted">Alternatives: ${res.alternatives.map(a =>
      a.parts.length ? `${rugName(a.parts)} (${a.grams}g)` : 'no rug').join(' · ')}</p>` : '';

    const factorRows = res.factors.map(f => `<tr><td>${esc(f.label)}</td><td class="num ${f.delta < 0 ? 'neg' : f.delta > 0 ? 'pos' : ''}">${
      f.delta == null ? f.value + '°C' : (f.delta > 0 ? '+' : '') + f.delta + '°'}</td></tr>`).join('');
    const hourRows = hours.map(x => `<tr><td>${fmtTime(x.time)}</td><td class="num">${Math.round(x.temp)}°</td><td class="num">${Math.round(x.wind)} mph</td><td class="num">${x.precip.toFixed(1)} mm</td></tr>`).join('');

    return `<article class="card result ${p.type}">
      <div class="result-head"><h3>${label} · ${span}</h3>${past ? '<span class="pill">Already passed</span>' : ''}</div>
      <div class="wx">${wx}</div>
      ${pick}
      ${notes.length ? `<ul class="notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${alts}
      ${healthBox(res)}
      <details><summary>Why this recommendation?</summary>
        <table><tbody>${factorRows}<tr><th>Felt temperature</th><th class="num">${res.feltTemp}°C</th></tr>
        <tr><th>Ideal fill</th><th class="num">${res.targetGrams}g</th></tr></tbody></table>
      </details>
      <details><summary>Hourly forecast</summary>
        <table><thead><tr><th>Time</th><th class="num">Temp</th><th class="num">Wind</th><th class="num">Rain</th></tr></thead><tbody>${hourRows}</tbody></table>
      </details>
    </article>`;
  }

  $$('#daySeg button').forEach(b => b.addEventListener('click', () => {
    day = +b.dataset.day;
    $$('#daySeg button').forEach(x => x.classList.toggle('active', x === b));
    renderToday();
  }));
  $('#refresh').addEventListener('click', () => renderToday(true));

  // ---------- guide: factor table ----------
  function renderFactorTable() {
    const rows = (title, map) => `<tr><th colspan="2">${title}</th></tr>` + Object.values(map).map(v =>
      `<tr><td>${esc(v.label)}</td><td class="num ${v.offset < 0 ? 'neg' : v.offset > 0 ? 'pos' : ''}">${v.offset > 0 ? '+' : ''}${v.offset}°</td></tr>`).join('');
    $('#factorTable').innerHTML = `<details><summary>See the adjustments used</summary><table><tbody>
      ${rows('Clip', E.CLIPS)}${rows('Breed type', E.BREEDS)}${rows('Body condition', E.CONDITION)}
      <tr><th colspan="2">Age</th></tr><tr><td>Under 3</td><td class="num neg">-1°</td></tr>
      <tr><td>20–24</td><td class="num neg">-2°</td></tr><tr><td>25+</td><td class="num neg">-3°</td></tr>
      ${rows('Health', E.HEALTH)}
      <tr><th colspan="2">Turned out</th></tr>
      <tr><td>Wind: 1° per 5 mph (max 5°), scaled by shelter (exposed 100%, natural 60%, field shelter 35%)</td><td class="num neg">up to -5°</td></tr>
      <tr><td>Rain: scaled by shelter (donkeys penalised more)</td><td class="num neg">up to -4°</td></tr>
      </tbody></table></details>`;
  }

  // ---------- backup ----------
  $('#exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'rug-checker-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importData').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!s || !Array.isArray(s.horses) || !s.horses.length) throw new Error();
      if (!confirm('Replace your current horses and rugs with this backup?')) return;
      state = s; if (!horse()) state.activeId = state.horses[0].id; save(); renderAll();
      alert('Backup restored.');
    } catch (err) { alert('That file doesn’t look like a Rug Checker backup.'); }
    e.target.value = '';
  });

  function renderAll() {
    renderPicker(); renderHorseForm(); renderRugs(); resetRugForm();
    if ($('#tab-today').classList.contains('active')) renderToday();
  }

  renderFactorTable();
  renderAll();
  if (!horse().location) showTab('horse');
})();
