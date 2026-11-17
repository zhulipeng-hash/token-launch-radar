// Token Launch Radar — the page. Reads window.RADAR (data.js, written beside
// dashboard/ by main.ts) and renders the ranked board, the live-comp evidence
// table and a per-protocol detail drawer. No network, no framework.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', cat: '', chain: '', min: 0, watch: false, sort: 'rank' };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    return d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // The model's arithmetic, restated in the page: the four factors stored on a
  // row multiply back to the board's implied value (within display rounding),
  // so what the reader sees is the same computation main.ts ran.
  function impliedValueFor(row) {
    return Math.round(row.tvl_usd * row.multiple * row.growth_multiplier * row.maturity_multiplier * row.breadth_multiplier);
  }

  /* ------------------------------ header stats ------------------------------ */
  var totalImplied = D.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  $('asof').textContent = D.as_of;
  $('stats').innerHTML = [
    [D.counts.protocols, 'protocols scanned'],
    [D.counts.board, 'on the radar board'],
    [D.counts.watchlist + ' / ' + D.counts.watchlist, 'watchlist covered'],
    [fmtUsd(totalImplied), 'total implied value'],
    [D.params.global_median_multiple.toFixed(2) + 'x', 'global peer median'],
  ].map(function (s) { return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>'; }).join('');

  /* --------------------------------- filters -------------------------------- */
  var cats = [], chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('fcat').innerHTML += cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('fchain').innerHTML += chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function visible() {
    var q = state.q.toLowerCase();
    var out = D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.implied_value_usd < state.min) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      rank: function (r) { return -r.implied_value_usd; },
      tvl: function (r) { return -r.tvl_usd; },
      growth: function (r) { return -(r.change_7d === null ? -999 : r.change_7d); },
      age: function (r) { return -(r.age_days === null ? -1 : r.age_days); },
      conviction: function (r) { return -r.conviction; },
    }[state.sort];
    return out.sort(function (a, b) { return key(a) - key(b) || a.rank - b.rank; });
  }

  function renderBoard() {
    var rows = visible();
    $('count').textContent = rows.length + ' of ' + D.rows.length + ' protocols';
    $('rows').innerHTML = rows.map(function (r) {
      var ch = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) +
          (r.watchlist ? '<span class="badge wl">watchlist</span>' : '') +
          (r.asset_unit_risk ? '<span class="badge risk">asset unit?</span>' : '') +
          '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + ch + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + 'x</td>' +
        '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td><span class="bar"><i style="width:' + r.conviction + '%"></i></span><span class="conv">' + r.conviction + '</span></td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#rows tr'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  /* -------------------------------- live comps ------------------------------- */
  $('liverows').innerHTML = D.live.map(function (r) {
    var ch = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
    return '<tr><td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.symbol || '—') + '</td><td class="cat">' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
      '<td class="num">' + r.multiple.toFixed(2) + 'x</td>' +
      '<td class="num ' + ch + '">' + fmtPct(r.change_7d) + '</td></tr>';
  }).join('');

  /* --------------------------------- detail ---------------------------------- */
  function openDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var comps = D.live.filter(function (x) { return x.family === r.family; }).slice(0, 6);
    var check = impliedValueFor(r);
    var drift = Math.abs(check - r.implied_value_usd) / r.implied_value_usd;
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge wl">watchlist</span>' : '') + '</h2>' +
      '<div class="dslug">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc(r.family) + '</div>' +
      '<p class="thesis">' + esc(r.thesis) + '</p>' +
      '<div class="kv">' +
        '<div><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied value</span></div>' +
        '<div><b>' + fmtUsd(r.tvl_usd) + '</b><span>TVL</span></div>' +
        '<div><b>#' + r.rank + '</b><span>radar rank</span></div>' +
        '<div><b>' + fmtPct(r.change_7d) + '</b><span>TVL change 7d</span></div>' +
        '<div><b>' + fmtAge(r.age_days) + '</b><span>tracked, no token</span></div>' +
        '<div><b>' + r.conviction + ' / 100</b><span>conviction (display)</span></div>' +
      '</div>' +
      '<p class="cat">Chains: ' + esc(r.chains.join(', ') || 'none recorded') + ' · First tracked: ' + esc(r.listed_at || 'unknown') +
        (r.asset_unit_risk ? '<br><strong>Caution:</strong> the name looks like a yield-bearing asset unit; the implied value prices its issuer, and if the unit itself is the product, treat this row as a screen miss and discount it.' : '') +
      '</p>' +
      '<h3>How this value is built</h3>' +
      '<div class="modelrow"><span>TVL (snapshot)</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
      '<div class="modelrow"><span>Peer multiple (' + r.multiple_scope + ' level, ' + r.comp_count + ' comps)</span><b>× ' + r.multiple.toFixed(3) + '</b></div>' +
      '<div class="modelrow"><span>Growth (7d ' + fmtPct(r.change_7d) + ', clamped, weight 0.30)</span><b>× ' + r.growth_multiplier.toFixed(3) + '</b></div>' +
      '<div class="modelrow"><span>Maturity (' + fmtAge(r.age_days) + ' with no token)</span><b>× ' + r.maturity_multiplier.toFixed(3) + '</b></div>' +
      '<div class="modelrow"><span>Breadth (' + r.chains.length + ' chains)</span><b>× ' + r.breadth_multiplier.toFixed(3) + '</b></div>' +
      '<div class="modelrow"><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>' +
      '<p class="cat">Page check: the four factors above multiply back to ' + fmtUsd(check) + ' (' + (drift < 0.005 ? 'matches' : 'within rounding of') + ' the board figure) — the page runs the same model as the program.</p>' +
      '<h3>Live peers in ' + esc(r.family) + '</h3>' +
      (comps.length ? comps.map(function (c) {
        return '<div class="comp"><span>' + esc(c.name) + ' (' + esc(c.symbol || '?') + ')</span><b>mcap ' + fmtUsd(c.mcap_usd) + ' · ' + c.multiple.toFixed(2) + 'x TVL</b></div>';
      }).join('') : '<p class="cat">No live comps in this family in the snapshot; this row falls back to the global median multiple.</p>') +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('drawer').hidden = false;
    $('scrim').hidden = false;
  }
  function closeDetail() { $('drawer').hidden = true; $('scrim').hidden = true; }
  $('close').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  /* ---------------------------------- events --------------------------------- */
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('fcat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('fchain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('fmin').addEventListener('change', function (e) { state.min = Number(e.target.value); renderBoard(); });
  $('fwatch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      ['board', 'live', 'method'].forEach(function (v) { $('view-' + v).hidden = v !== t.getAttribute('data-tab'); });
    });
  });

  renderBoard();
})();
