/* Présentation : navigation, graphiques Plotly, calculateur, lecteurs de simulation. */
(() => {
  const S = window.SIM, P = S.params, K = S.cles;
  const C = { cy: '#3ad6ff', or: '#ff8a3d', gr: '#46e6a6', vi: '#a98bff', ye: '#ffd166', rd: '#ff4d6d', mut: '#8ea3c8', txt: '#cfe0ff' };
  const fr = (v, d = 0) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

  // ---------- liaison des valeurs calculées dans le texte ----------
  document.querySelectorAll('[data-p],[data-k]').forEach(el => {
    let v = el.dataset.p ? P[el.dataset.p] : K[el.dataset.k];
    if (el.dataset.div) v /= +el.dataset.div;
    if (el.dataset.mul) v *= +el.dataset.mul;
    if (el.dataset.pct) { v *= 100; el.textContent = fr(v, +el.dataset.pct); return; }
    el.textContent = fr(v, +(el.dataset.f || 0));
  });

  // ---------- thème des graphiques ----------
  const AX = (title, extra = {}) => Object.assign({ title: { text: title, font: { size: 17 } }, gridcolor: 'rgba(140,170,230,.12)', zerolinecolor: 'rgba(140,170,230,.25)', linecolor: 'rgba(140,170,230,.3)', tickfont: { size: 15 } }, extra);
  const LAY = (extra) => Object.assign({
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Segoe UI, sans-serif', color: C.txt, size: 16 },
    margin: { l: 72, r: 72, t: 40, b: 62 },
    legend: { bgcolor: 'rgba(0,0,0,0)', orientation: 'h', x: 0, y: 1.12, font: { size: 15 } },
    hoverlabel: { bgcolor: '#0b1430', bordercolor: C.cy, font: { color: '#fff' } },
  }, extra);
  const CFG = { displayModeBar: false, responsive: true, locale: 'fr' };
  const kgf = T => T / P.G;
  const thrustFromRpm = rpm => P.CT * P.RHO * Math.pow(rpm / 60, 2) * Math.pow(P.D, 4);

  const charts = {
    'ch-comp'(el) {
      const c = S.comparaison, tr = [];
      [.75, .5, .25].forEach(k => tr.push({ x: [0, 1.5], y: [k, k], mode: 'lines', line: { color: C.or, width: 1.5, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' }));
      tr.push({ x: c.mcc_C, y: c.mcc_n, name: 'MCC', line: { color: C.cy, width: 3 } });
      tr.push({ x: c.mas_C, y: c.mas_n, name: 'MAS', line: { color: C.gr, width: 3 } });
      tr.push({ x: c.ms_C, y: c.ms_n, name: 'Moteur synchrone', line: { color: C.or, width: 5 } });
      tr.push({ x: [1.5], y: [1], mode: 'markers', marker: { symbol: 'x', size: 14, color: C.or, line: { width: 3, color: C.or } }, showlegend: false, hoverinfo: 'skip' });
      Plotly.newPlot(el, tr, LAY({
        xaxis: AX('Couple / couple nominal', { range: [0, 2.6] }), yaxis: AX('Vitesse / vitesse de synchronisme', { range: [0, 1.12] }),
        annotations: [
          { x: 1.52, y: 1.035, text: 'décrochage', showarrow: false, xanchor: 'left', font: { color: C.or, size: 16 } },
          { x: .05, y: .64, text: 'f variable ⇒ n réglable', showarrow: false, xanchor: 'left', font: { color: C.or, size: 16 } },
          ...[.75, .5, .25].map(k => ({ x: 1.5, y: k, text: `f = ${String(k).replace('.', ',')}·f<sub>n</sub>`, showarrow: false, xanchor: 'left', font: { color: C.or, size: 14 } })),
        ],
      }), CFG);
    },
    'ch-rotor'(el) {
      const r = S.rotor;
      Plotly.newPlot(el, [
        { x: r.rpm, y: r.T.map(kgf), name: 'Poussée (kgf)', line: { color: C.cy, width: 3 }, hovertemplate: '%{x:.0f} tr/min<br>%{y:.0f} kgf<extra></extra>' },
        { x: r.rpm, y: r.P, name: 'Puissance (kW)', yaxis: 'y2', line: { color: C.or, width: 3 }, hovertemplate: '%{x:.0f} tr/min<br>%{y:.1f} kW<extra></extra>' },
        { x: [K.rpm_stat, K.rpm_maxi], y: [kgf(K.T_stat), kgf(K.T_maxi)], mode: 'markers+text', marker: { size: 12, color: [C.gr, C.vi], line: { color: '#fff', width: 1.5 } }, text: ['Stationnaire', 'Poussée max'], textposition: 'top left', textfont: { color: '#fff', size: 16 }, showlegend: false, hoverinfo: 'skip' },
      ], LAY({ xaxis: AX('Vitesse du rotor (tr/min)'), yaxis: AX('Poussée (kgf)', { titlefont: { color: C.cy } }), yaxis2: AX('Puissance (kW)', { overlaying: 'y', side: 'right', showgrid: false }) }), CFG);
    },
    'ch-env'(el) {
      const e = S.enveloppe, pl = e.plein;
      const C0 = pl.C[1]; const ib = pl.C.findIndex(v => v < .985 * C0);
      const rb = pl.rpm[ib], rmax = pl.rpm[pl.rpm.length - 1];
      const fa = e.faible, jf = Math.round(fa.rpm.length * .9);
      const zone = (x0, x1, col) => ({ type: 'rect', xref: 'x', yref: 'paper', x0, x1, y0: 0, y1: 1, fillcolor: col, opacity: .07, line: { width: 0 }, layer: 'below' });
      Plotly.newPlot(el, [
        { x: pl.rpm, y: pl.C, name: `C max · ${fr(pl.vdc)} V`, line: { color: C.cy, width: 4 } },
        { x: e.faible.rpm, y: e.faible.C, name: `C max · ${fr(e.faible.vdc)} V`, line: { color: C.cy, width: 2, dash: 'dash' } },
        { x: S.charge.rpm, y: S.charge.C, name: 'Rotor', line: { color: C.gr, width: 3 } },
        { x: pl.rpm, y: pl.P, name: 'P max', yaxis: 'y2', line: { color: C.or, width: 2 } },
        { x: [K.rpm_stat], y: [K.C_stat], name: 'Stationnaire', mode: 'markers', marker: { size: 14, color: C.gr, line: { color: '#fff', width: 2 } } },
        { x: [K.rpm_maxi], y: [K.C_maxi], name: 'Poussée max', mode: 'markers', marker: { size: 14, symbol: 'square', color: C.vi, line: { color: '#fff', width: 2 } } },
      ], LAY({
        xaxis: AX('Vitesse (tr/min)', { range: [0, rmax] }), yaxis: AX('Couple (N·m)', { range: [0, 320] }), yaxis2: AX('Puissance (kW)', { overlaying: 'y', side: 'right', showgrid: false, range: [0, 80] }),
        legend: { bgcolor: 'rgba(0,0,0,0)', orientation: 'h', x: 0, y: 1.2, font: { size: 14 } },
        shapes: [zone(0, rb, C.cy), zone(rb, rmax, C.or)],
        annotations: [
          { x: rb / 2, y: 0.04, yref: 'paper', text: 'COUPLE CONSTANT', showarrow: false, font: { color: C.cy, size: 15 } },
          { x: (rb + rmax) / 2, y: 0.04, yref: 'paper', text: 'PUISSANCE CONSTANTE', showarrow: false, font: { color: C.or, size: 15 } },
          { x: fa.rpm[jf], y: fa.C[jf], ax: -90, ay: 50, text: 'batterie faible', arrowcolor: C.vi, font: { color: C.vi, size: 15 } },
        ],
      }), CFG);
    },
    'ch-eta'(el) {
      const c = S.carte, m = S.mission;
      const ic = m.t.findIndex(t => t >= 500);
      Plotly.newPlot(el, [
        { type: 'contour', x: c.rpm, y: c.C, z: c.eta, zmin: 80, zmax: 97, connectgaps: false,
          contours: { start: 80, end: 97, size: 1, coloring: 'heatmap', showlines: true },
          line: { color: 'rgba(255,255,255,.18)', width: .6 },
          colorscale: [[0, '#1b1347'], [.3, '#3b2f8f'], [.55, '#1f7fa8'], [.75, '#22b39a'], [.9, '#8fe36a'], [1, '#ffe14d']],
          colorbar: { title: { text: 'η (%)', side: 'right' }, thickness: 14, outlinewidth: 0, tickfont: { color: C.txt } },
          hovertemplate: '%{x:.0f} tr/min · %{y:.0f} N·m<br><b>η = %{z:.1f} %</b><extra></extra>' },
        { x: c.rpm, y: c.C_max, name: 'Couple max', line: { color: '#fff', width: 3 }, hoverinfo: 'skip' },
        { x: S.charge.rpm, y: S.charge.C, name: 'Charge rotor', line: { color: '#fff', width: 2, dash: 'dash' }, hoverinfo: 'skip' },
        { x: [K.rpm_stat, m.rpm[ic]], y: [K.C_stat, m.couple[ic]], mode: 'markers+text', text: [`Stationnaire ${fr(K.eta_stat * 100, 1)} %`, 'Croisière'], textposition: ['top left', 'bottom right'], textfont: { color: '#fff', size: 16 }, marker: { size: 16, color: [C.or, C.cy], line: { color: '#fff', width: 2 } }, showlegend: false, hoverinfo: 'skip' },
      ], LAY({ xaxis: AX('Vitesse (tr/min)', { range: [50, 2700] }), yaxis: AX('Couple (N·m)', { range: [0, 300] }), margin: { l: 62, r: 20, t: 36, b: 50 } }), CFG);
    },
    'ch-bilan'(el) {
      const b = S.bilan;
      const vals = [b.p_dc, -b.p_ond, -b.p_cu, -b.p_fer, -b.p_meca, b.p_u];
      Plotly.newPlot(el, [{
        type: 'waterfall', orientation: 'v', measure: ['absolute', 'relative', 'relative', 'relative', 'relative', 'total'],
        x: ['Batterie', 'Onduleur', 'Joule R·I²', 'Fer', 'Méca', 'Utile'],
        y: vals.map(v => v / 1000), text: vals.map(v => `${fr(Math.abs(v))} W`), textposition: 'outside', textfont: { color: '#fff', size: 16 },
        connector: { line: { color: 'rgba(255,255,255,.3)', dash: 'dot' } },
        decreasing: { marker: { color: C.or } }, increasing: { marker: { color: C.cy } }, totals: { marker: { color: C.gr } },
        hovertemplate: '%{x}<br>%{text}<extra></extra>',
      }], LAY({ xaxis: AX(''), yaxis: AX('Puissance (kW)', { range: [18.5, 21.8] }), showlegend: false, annotations: [{ x: 1, y: 1.02, xref: 'paper', yref: 'paper', xanchor: 'right', text: 'axe tronqué', showarrow: false, font: { size: 13, color: C.mut } }] }), CFG);
    },
  };

  // ---------- calculateur de cahier des charges ----------
  (function calculateur() {
    const NOPT = [4, 6, 8, 12, 16];
    const $ = id => document.getElementById(id);
    function drawViz(N, D) {
      const svg = $('calc-viz'); if (!svg) return;
      const Rr = Math.max(D * 0.53 / Math.sin(Math.PI / N), D * 0.9), sc = 92 / (Rr + D / 2);
      let h = `<circle r="${Rr * sc}" fill="none" stroke="rgba(140,170,230,.35)" stroke-width="2"/>`;
      for (let i = 0; i < N; i++) {
        const a = (i + .5) * 2 * Math.PI / N, x = Rr * sc * Math.cos(a), y = Rr * sc * Math.sin(a);
        h += `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="rgba(140,170,230,.35)" stroke-width="2"/>`;
        h += `<circle cx="${x}" cy="${y}" r="${D / 2 * sc}" fill="rgba(58,214,255,.14)" stroke="${C.cy}" stroke-width="1.5"/>`;
        h += `<circle cx="${x}" cy="${y}" r="4" fill="${C.or}"/>`;
      }
      h += `<ellipse rx="${0.95 * sc}" ry="${1.5 * sc}" fill="#e8f0ff" opacity=".9"/>`;
      svg.innerHTML = h;
    }
    function upd() {
      const m = +$('s-m').value, N = NOPT[+$('s-n').value], D = +$('s-d').value, k = +$('s-k').value;
      $('o-m').textContent = `${fr(m)} kg`; $('o-n').textContent = N; $('o-d').textContent = `${fr(D, 2)} m`; $('o-k').textContent = `× ${fr(k, 2)}`;
      const T = m * P.G / N, n = Math.sqrt(T / (P.CT * P.RHO * D ** 4));
      const Ph = P.CP * P.RHO * n ** 3 * D ** 5, Ch = Ph / (2 * Math.PI * n);
      const Cm = Ch * k, Pm = Ph * k ** 1.5, rpm = n * 60;
      const Pt = N * Ph / (0.955 * P.ETA_OND) + P.P_AUX;
      const aut = P.E_BAT * 0.8 / Pt * 60;
      $('r-T').textContent = `${fr(T)} N`; $('r-n').textContent = `${fr(rpm)} tr/min`;
      $('r-C').textContent = `${fr(Ch)} N·m`; $('r-P').textContent = `${fr(Ph / 1000, 1)} kW`;
      $('r-Cm').textContent = `${fr(Cm)} N·m`; $('r-Pm').textContent = `${fr(Pm / 1000, 1)} kW`;
      $('r-Pt').textContent = `${fr(Pt / 1000)} kW`; $('r-aut').textContent = `${fr(aut, 0)} min`;
      drawViz(N, D);
      const ok = Cm <= P.C_MAX && Pm <= P.P_MAX;
      const v = $('verdict'); v.className = 'verdict ' + (ok ? 'ok' : 'ko');
      v.textContent = ok ? `✓ Notre moteur (${P.C_MAX} N·m · ${P.P_MAX / 1000} kW) convient`
                         : `✗ Moteur insuffisant (${P.C_MAX} N·m · ${P.P_MAX / 1000} kW)`;
    }
    ['s-m', 's-n', 's-d', 's-k'].forEach(id => $(id).addEventListener('input', upd));
    upd();
  })();

  // ---------- jauges ----------
  function gauge(parent, label, unit, max, color, dec = 0) {
    const d = document.createElement('div'); d.className = 'gauge';
    const r = 44, cx = 60, cy = 56, a0 = 210 * Math.PI / 180, a1 = -30 * Math.PI / 180;
    const pt = a => `${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`;
    const path = `M ${pt(a0)} A ${r} ${r} 0 1 1 ${pt(a1)}`, len = r * (a0 - a1);
    d.innerHTML = `<svg viewBox="0 0 120 84"><path d="${path}" fill="none" stroke="rgba(140,170,230,.15)" stroke-width="8" stroke-linecap="round"/>
      <path class="v" d="${path}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="0 ${len}" style="filter:drop-shadow(0 0 4px ${color})"/>
      <text x="60" y="58" text-anchor="middle" fill="#fff" font-size="19" font-family="Bahnschrift, Segoe UI" font-weight="600" class="t">0</text>
      <text x="60" y="74" text-anchor="middle" fill="${C.mut}" font-size="10">${unit}</text></svg><div class="gl">${label}</div>`;
    parent.appendChild(d);
    const arc = d.querySelector('.v'), txt = d.querySelector('.t');
    return v => { const f = Math.max(0, Math.min(1, v / max)); arc.setAttribute('stroke-dasharray', `${f * len} ${len}`); txt.textContent = fr(v, dec); };
  }

  // ---------- lecteur de mission ----------
  const mission = (() => {
    const m = S.mission, n = m.t.length, tEnd = m.t[n - 1];
    const g = document.getElementById('gauges');
    const G = {
      h: gauge(g, 'Altitude', 'm', 350, C.cy), V: gauge(g, 'Vitesse', 'km/h', 100, C.cy),
      rpm: gauge(g, 'Vitesse moteur', 'tr/min', 2200, C.vi), f: gauge(g, 'f = p·n/60', 'Hz', 520, C.vi),
      C: gauge(g, 'Couple moteur', 'N·m', 300, C.or), I: gauge(g, 'Courant', 'A eff.', 200, C.or),
      P: gauge(g, 'Puissance', 'kW', 400, C.ye), soc: gauge(g, 'Batterie', '%', 100, C.gr),
    };
    let t = 0, playing = false, last = 0, inited = false, lastPlot = 0;
    const play = document.getElementById('m-play'), scrub = document.getElementById('m-scrub'), speed = document.getElementById('m-speed');
    const phaseEl = document.getElementById('m-phase'), timeEl = document.getElementById('m-time');
    const phases = [[6, 'Démarrage des rotors'], [31, 'Décollage vertical'], [121, 'Transition & montée'], [801, 'Croisière à 90 km/h'], [891, 'Descente'], [906, 'Stationnaire d\'approche'], [935, 'Atterrissage'], [1e9, 'Arrêt des rotors']];
    const tm = m.t.map(v => v / 60);
    const cursor = x => ({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: '#fff', width: 1.5, dash: 'dot' } });
    // phases de vol (min) : fond coloré + étiquette, pour lire les courbes d'un coup d'œil
    const bands = [[0, 121 / 60, C.cy, 'Décollage'], [121 / 60, 801 / 60, C.gr, 'Croisière'], [801 / 60, tEnd / 60, C.vi, 'Atterr.']];
    const bandShapes = bands.map(([a, b, col]) => ({ type: 'rect', xref: 'x', yref: 'paper', x0: a, x1: b, y0: 0, y1: 1, fillcolor: col, opacity: .07, line: { width: 0 }, layer: 'below' }));
    const bandLabels = bands.map(([a, b, col, txt]) => ({ x: (a + b) / 2, y: 1, xref: 'x', yref: 'paper', yanchor: 'top', text: txt, showarrow: false, font: { size: 12, color: col } }));
    let mShapes = [];
    function initCharts() {
      const yTick = { tickfont: { size: 13 }, nticks: 5 };
      const lay = (y1, r1, y2, r2, col1, col2, extraAnn = []) => LAY({
        margin: { l: 56, r: 50, t: 30, b: 40 },
        xaxis: AX('Temps (min)', { range: [0, tEnd / 60], dtick: 2, tickfont: { size: 13 }, title: { text: 'Temps (min)', font: { size: 13 }, standoff: 4 } }),
        yaxis: AX(y1, Object.assign({ range: r1, title: { text: y1, font: { size: 13, color: col1 } }, tickfont: { size: 13, color: col1 } }, { nticks: 5 })),
        yaxis2: AX(y2, Object.assign({ overlaying: 'y', side: 'right', showgrid: false, zeroline: false, range: r2, title: { text: y2, font: { size: 13, color: col2 } }, tickfont: { size: 13, color: col2 } }, { nticks: 5 })),
        legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)', font: { size: 13 } },
        shapes: [...bandShapes, cursor(0)], annotations: [...bandLabels, ...extraAnn],
      });
      const iRg = m.p_total.indexOf(Math.min(...m.p_total));
      Plotly.newPlot('ch-mis1', [
        { x: tm, y: m.p_total, name: 'Puissance batterie', line: { color: C.ye, width: 2 }, hovertemplate: '%{x:.1f} min · %{y:.0f} kW<extra></extra>' },
        { x: tm, y: m.soc, name: 'État de charge', yaxis: 'y2', line: { color: C.gr, width: 2.5 }, hovertemplate: '%{x:.1f} min · %{y:.0f} %<extra></extra>' },
      ], lay('kW', [-100, 400], '%', [0, 100], C.ye, C.gr, [
        { x: tm[iRg], y: m.p_total[iRg], ax: -50, ay: 0, xanchor: 'right', text: 'récupération', arrowcolor: C.ye, arrowsize: .8, font: { size: 12, color: C.ye } },
      ]), CFG);
      Plotly.newPlot('ch-mis2', [
        { x: tm, y: m.couple, name: 'Couple moteur', line: { color: C.or, width: 2 }, hovertemplate: '%{x:.1f} min · %{y:.0f} N·m<extra></extra>' },
        { x: tm, y: m.temp, name: 'T° bobinage', yaxis: 'y2', line: { color: C.rd, width: 2.5 }, hovertemplate: '%{x:.1f} min · %{y:.0f} °C<extra></extra>' },
      ], lay('N·m', [-100, 300], '°C', [0, 100], C.or, C.rd), CFG);
      inited = true;
    }
    function show(force) {
      const i = Math.min(n - 1, Math.round(t / 0.25));
      G.h(m.h[i]); G.V(m.V[i]); G.rpm(m.rpm[i]); G.f(m.f_elec[i]); G.C(Math.max(m.couple[i], 0)); G.I(m.i_rms[i]); G.P(Math.max(m.p_total[i], 0)); G.soc(m.soc[i]);
      phaseEl.textContent = phases.find(p => t < p[0])[1];
      timeEl.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      scrub.value = t / tEnd * 1000;
      const Vms = m.V[i] / 3.6, pitch = Math.atan(0.5 * P.RHO * 2.5 * Vms * Vms / (P.M * P.G));
      V3D.setFlight(m.x[i], m.h[i], pitch);
      V3D.state.rpm.fill(m.rpm[i]); V3D.state.load.fill(Math.max(m.couple[i], 0) / 200);
      const now = performance.now();
      if (inited && (force || now - lastPlot > 120)) {
        lastPlot = now;
        mShapes = [...bandShapes, cursor(t / 60)];
        Plotly.relayout('ch-mis1', { shapes: mShapes }); Plotly.relayout('ch-mis2', { shapes: mShapes });
      }
    }
    function loop(ts) {
      if (!playing) return;
      const dt = Math.min((ts - last) / 1000, .1); last = ts;
      t += dt * +speed.value;
      if (t >= tEnd) { t = tEnd; playing = false; play.textContent = '↺ Rejouer'; }
      show(); requestAnimationFrame(loop);
    }
    play.addEventListener('click', () => {
      if (playing) { playing = false; play.textContent = '▶ Reprendre'; return; }
      if (t >= tEnd) { t = 0; V3D.resetChase(); }
      playing = true; play.textContent = '❚❚ Pause'; last = performance.now(); requestAnimationFrame(loop);
    });
    scrub.addEventListener('input', () => { t = scrub.value / 1000 * tEnd; V3D.resetChase(); show(true); });
    return { enter() { if (!inited) initCharts(); V3D.resetChase(); const q = +new URLSearchParams(location.search).get('mt'); if (q) t = q; show(true); }, leave() { playing = false; play.textContent = '▶ Lancer'; } };
  })();

  // ---------- lecteur de la panne ----------
  const panne = (() => {
    const p = S.panne, n = p.t.length, tEnd = p.t[n - 1];
    let t = 0, playing = false, last = 0, inited = false, lastPlot = 0;
    const btn = document.getElementById('p-play'), ph = document.getElementById('p-phase'), te = document.getElementById('p-time');
    const cols = [C.rd, C.cy, C.gr, C.vi, C.ye, '#7aa2ff', '#ff9ecf', '#9ff0ff'];
    const motors = [...Array(P.N_ROT).keys()];
    const cursor = x => ({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: '#fff', width: 1.5, dash: 'dot' } });
    function initCharts() {
      Plotly.newPlot('ch-pbars', [
        { type: 'bar', x: motors.map(i => 'M' + (i + 1)), y: p.T_nom.map(kgf), name: 'Nominal', marker: { color: 'rgba(140,170,230,.25)' }, hoverinfo: 'skip' },
        { type: 'bar', x: motors.map(i => 'M' + (i + 1)), y: p.T_nom.map(kgf), name: 'Actuel', marker: { color: cols }, hovertemplate: '%{x} : %{y:.0f} kgf<extra></extra>' },
      ], LAY({ barmode: 'overlay', margin: { l: 58, r: 20, t: 34, b: 34 }, yaxis: AX('Poussée (kgf)', { range: [0, 200] }), xaxis: AX(''), legend: { orientation: 'h', x: 0, y: 1.28, bgcolor: 'rgba(0,0,0,0)', font: { size: 14 } } }), CFG);
      Plotly.newPlot('ch-prpm', motors.map(i => ({ x: p.t, y: p.rpm[i], name: 'M' + (i + 1), line: { color: cols[i], width: i ? 2 : 3 } })),
        LAY({ margin: { l: 58, r: 20, t: 34, b: 36 }, xaxis: AX('Temps (s)', { title: { text: '' } }), yaxis: AX('tr/min'), showlegend: false, shapes: [cursor(0)],
          annotations: [{ x: 2, y: 1, yref: 'paper', text: 'panne', showarrow: false, font: { color: C.rd, size: 11 }, xanchor: 'left' }] }), CFG);
      inited = true;
    }
    function show(force) {
      const i = Math.min(n - 1, Math.round(t / 0.02));
      for (let k = 0; k < P.N_ROT; k++) { V3D.state.rpm[k] = p.rpm[k][i]; V3D.state.load[k] = Math.max(p.couple[k][i], 0) / 250; }
      V3D.state.failed = t >= 2 ? 0 : -1;
      ph.textContent = t < 2 ? 'Vol stationnaire à 30 m' : t < 2.15 ? '⚠ Panne M1' : t < 5 ? 'M1 en court-circuit · 7 moteurs compensent' : '✓ Stabilisé sur 7 moteurs';
      ph.style.borderColor = ph.style.color = t < 2 ? C.cy : t < 5 ? C.rd : C.gr;
      te.textContent = `t = ${fr(t, 2)} s · altitude ${fr(p.h[i], 2)} m`;
      const now = performance.now();
      if (inited && (force || now - lastPlot > 90)) {
        lastPlot = now;
        Plotly.restyle('ch-pbars', { y: [motors.map(k => kgf(thrustFromRpm(p.rpm[k][i])))] }, [1]);
        Plotly.relayout('ch-prpm', { shapes: [cursor(t)] });
      }
    }
    function loop(ts) {
      if (!playing) return;
      t += Math.min((ts - last) / 1000, .1) * 0.5; last = ts;
      if (t >= tEnd) { t = tEnd; playing = false; btn.textContent = '↺ Rejouer la panne'; }
      show(); requestAnimationFrame(loop);
    }
    btn.addEventListener('click', () => { t = 0; playing = true; last = performance.now(); btn.textContent = '… simulation (ralenti ×0,5)'; requestAnimationFrame(loop); });
    return { enter() { if (!inited) initCharts(); t = +new URLSearchParams(location.search).get('pt') || 0; show(true); }, leave() { playing = false; btn.textContent = '⚠ Panne du moteur 1'; } };
  })();

  // ---------- navigation ----------
  V3D.init();
  const slides = [...document.querySelectorAll('.slide')];
  const players = { mission: mission, top: panne };
  const drawn = new Set();
  const notes = document.getElementById('notes-panel');
  let cur = -1;
  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === cur) return;
    if (cur >= 0) { slides[cur].classList.remove('active'); const pm = players[slides[cur].dataset['3d']]; pm && pm.leave(); }
    cur = i; const s = slides[i]; s.classList.add('active');
    document.querySelector('#progress div').style.width = `${(i + 1) / slides.length * 100}%`;
    document.getElementById('counter').textContent = `${i + 1} / ${slides.length}`;
    const nt = s.querySelector('.notes'); notes.textContent = nt ? nt.textContent : '';
    history.replaceState(null, '', '#' + (i + 1));
    const m3 = s.dataset['3d'];
    if (m3) V3D.attach(s.querySelector('.v3d'), m3);
    s.querySelectorAll('.chart').forEach(el => { if (charts[el.id] && !drawn.has(el.id)) { charts[el.id](el); drawn.add(el.id); } });
    if (players[m3]) players[m3].enter();
    [60, 800].forEach(d => setTimeout(() => { s.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el)); V3D.resize(); }, d));
    sendState();
  }

  // ---------- vue présentateur (fenêtre séparée, synchronisée par postMessage) ----------
  const SPEAKERS = window.SPEAKERS || ['Intervenant 1', 'Intervenant 2', 'Intervenant 3', 'Intervenant 4', 'Intervenant 5'];
  const slideInfo = slides.map(s => {
    const h = s.querySelector('h1, h2'), nt = s.querySelector('.notes');
    return { title: h ? h.textContent.replace(/\s+/g, ' ').trim() : '', notes: nt ? nt.textContent.trim() : '', speaker: +s.dataset.speaker || 0 };
  });
  const presenters = new Set();
  function sendState(target) {
    const msg = { type: 'evtol-state', i: cur, slides: slideInfo, speakers: SPEAKERS };
    if (target) { target.postMessage(msg, '*'); return; }
    presenters.forEach(w => { if (w.closed) presenters.delete(w); else w.postMessage(msg, '*'); });
  }
  let pCount = 0;
  function openPresenter() {
    const w = window.open('presenter.html', 'presenter-' + (++pCount), 'width=1100,height=760');
    if (!w) { alert('Fenêtre bloquée : autorisez les pop-ups pour cette page.'); return; }
    presenters.add(w);
  }
  addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'evtol-hello') { presenters.add(e.source); sendState(e.source); }
    else if (d.type === 'evtol-go') go(d.i);
  });
  const pBtn = document.createElement('button');
  pBtn.id = 'presenter-btn'; pBtn.title = 'Vue présentateur (P)'; pBtn.textContent = '🎤 Présentateur';
  pBtn.addEventListener('click', openPresenter);
  document.getElementById('footer').appendChild(pBtn);
  addEventListener('keydown', e => {
    if (e.target.matches('input, select')) { if (e.key !== 'PageDown' && e.key !== 'PageUp') return; }
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(slides.length - 1);
    else if (e.key.toLowerCase() === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
    else if (e.key.toLowerCase() === 'n') notes.classList.toggle('show');
    else if (e.key.toLowerCase() === 'p') openPresenter();
  });
  addEventListener('resize', () => { if (cur >= 0) slides[cur].querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el)); });
  // un graphique créé pendant l'animation d'entrée garde sa taille initiale : on le recale dès que sa carte change de taille
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(es => es.forEach(e => { const el = e.target; if (el.classList.contains('js-plotly-plot') && el.offsetParent) Plotly.Plots.resize(el); }));
    document.querySelectorAll('.chart').forEach(el => ro.observe(el));
  }
  go((parseInt(location.hash.slice(1)) || 1) - 1);
})();
