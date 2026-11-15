// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail drawer with the model's own inputs and the protocol's farm plan, the
// live-token view, and the model tab with its comparables and a sandbox that
// re-ranks the board live. No network: every byte it shows is in data.js.
//
// The model in one function: the page recomputes a row from the snapshot figures
// and checks the number board.json carries, so the page's code and the board's
// data are visibly the same arithmetic. The farm plan is the same derivation
// main.ts writes to board.json: category, chains, TVL and age.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    watch: params.get('watch') === '1',
    early: params.get('early') === '1',
    tab: params.get('tab') || 'board',
    sort: 'implied',
    dir: -1,
    selected: null,
    sandbox: {
      growth_weight: DATA.model.growth_weight,
      maturity_floor: DATA.model.maturity_floor,
      chain_bonus: DATA.model.chain_bonus,
      multiple: 'category',
    },
  };
  if (params.get('view') === 'detail' && params.get('slug')) state.selected = params.get('slug');

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageFmt(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The model, exactly as lib/model.ts runs it. `m` is the sandbox's constants.
  function multipleOf(row, m) {
    if (m.multiple === 'global') return DATA.comparables.global_multiple;
    var hit = DATA.comparables.by_category[row.category || 'Uncategorised'];
    return hit ? hit.multiple : DATA.comparables.global_multiple;
  }
  function impliedOf(row, m) {
    var mult = multipleOf(row, m);
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var growthMult = clamp(1 + (growth / 100) * m.growth_weight, m.growth_min, m.growth_max);
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chainMult = 1 + m.chain_bonus * Math.min(Math.max(row.chains.length - 1, 0), m.chain_max);
    return Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity * chainMult));
  }
  function factorsOf(row, m) {
    var mult = multipleOf(row, m);
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var growthMult = clamp(1 + (growth / 100) * m.growth_weight, m.growth_min, m.growth_max);
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chainMult = 1 + m.chain_bonus * Math.min(Math.max(row.chains.length - 1, 0), m.chain_max);
    return { multiple: mult, growthPct: growth, growthMult: growthMult, maturity: maturity, chainMult: chainMult, age: row.age_days, base: row.tvl_usd * mult };
  }

  // The farm plan, exactly as lib/model.ts writes it to board.json.
  function capitalFor(row) {
    if (row.tvl_usd >= 5000000000) return 250;
    if (row.tvl_usd >= 1000000000) return 150;
    if (row.tvl_usd >= 100000000) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + '\'s chain and use one native app on it.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow about $' + small + ' against the supply and repay it the same week, so the address shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap about $' + small + ' through the pool each week, so the address shows trading activity as well as liquidity.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount of about $' + small + ' back the other way, so the address shows two-way volume.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the receipt token once, if ' + name + ' offers it, to deepen the same position.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close and reopen one small hedge, so the account shows more than one trade.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market and place a second small position of about $' + small + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Allocate a second, smaller amount of about $' + small + ' to a different vault run by the same curator.';
    if (c.indexOf('stable') >= 0) return 'Hold the stable asset through one full weekly cycle, then redeem a small part of about $' + small + '.';
    if (c.indexOf('rwa') >= 0) return 'Reinvest one week\'s yield, about $' + small + ', into the same asset.';
    if (c.indexOf('insurance') >= 0) return 'Top up the cover by about $' + small + ' once before the hold ends.';
    if (c.indexOf('chain') >= 0) return 'Use a second native app on ' + chain + ' with about $' + small + ', so the address is active twice.';
    return 'Repeat the deposit once with a second, smaller amount of about $' + small + ', so the address shows repeated use.';
  }
  function farmSteps(row) {
    var chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = capital >= 150 ? 8 : 4;
    var small = Math.max(10, Math.round(capital / 5));
    var steps = [
      ['Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'],
      [actionFor(row, capital, chain), '$' + capital + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'],
      [secondActionFor(row, capital, chain), 'about $' + small + ' of capital and $2 of gas', '10 minutes'],
      ['Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', 'about $2 of gas a week', '10 minutes a week'],
      ['Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'],
      ['Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', 'no fee to check, and never pay to claim', '10 minutes'],
      ['Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes'],
    ];
    return steps.map(function (s) {
      var t = s[0] + ' Cost: ' + s[1] + '. Time: ' + s[2] + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      return t;
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && !r.watchlist) return false;
      if (state.early && r.tvl_usd >= DATA.floor_usd) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change_7d') { va = a.change_7d === null ? -9999 : a.change_7d; vb = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else { va = a.rank; vb = b.rank; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return rows;
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
    render();
  }

  function th(label, key, cls) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
    return el('th', { class: cls || '', onclick: function () { setSort(key); } }, label + arrow);
  }

  function renderStats() {
    var top = DATA.rows[0];
    var watchRows = DATA.rows.filter(function (r) { return r.watchlist; });
    var med = DATA.rows.slice().sort(function (a, b) { return a.implied_value_usd - b.implied_value_usd; })[Math.floor(DATA.rows.length / 2)];
    var stats = el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Protocols ranked'), el('div', { class: 'v' }, String(DATA.board_size)), el('div', { class: 's' }, DATA.watchlist_size + ' on the watchlist · ' + DATA.early_size + ' early finds below the floor')),
      el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Top implied value'), el('div', { class: 'v' }, usd(top ? top.implied_value_usd : 0)), el('div', { class: 's' }, top ? top.name : '—')),
      el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Median implied value'), el('div', { class: 'v' }, usd(med ? med.implied_value_usd : 0)), el('div', { class: 's' }, 'half the board sits above this')),
      el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Watchlist covered'), el('div', { class: 'v' }, watchRows.length + ' / ' + DATA.watchlist_size), el('div', { class: 's' }, 'every watchlist protocol is ranked')),
    );
    return stats;
  }

  function renderTabs() {
    function tab(name, label) {
      return el('button', { class: 'tab', 'aria-selected': state.tab === name ? 'true' : 'false', onclick: function () { state.tab = name; render(); } }, label);
    }
    return el('div', { class: 'tabs' },
      tab('board', 'Pre-token board (' + DATA.board_size + ')'),
      tab('live', 'Live tokens (' + DATA.live_size + ')'),
      tab('model', 'Model & method'));
  }

  function renderControls() {
    var cats = [];
    DATA.rows.forEach(function (r) { var c = r.category || 'Uncategorised'; if (cats.indexOf(c) < 0) cats.push(c); });
    cats.sort();
    var chains = [];
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
    chains.sort();
    function opt(v, label) { return el('option', { value: v }, label); }
    var catSel = el('select', { 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; render(); } });
    catSel.appendChild(opt('all', 'All categories'));
    cats.forEach(function (c) { catSel.appendChild(opt(c, c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Uncategorised') === c; }).length + ')')); });
    catSel.value = state.category;
    var chainSel = el('select', { 'aria-label': 'Filter by chain', onchange: function (e) { state.chain = e.target.value; render(); } });
    chainSel.appendChild(opt('all', 'All chains'));
    chains.forEach(function (c) { chainSel.appendChild(opt(c, c)); });
    chainSel.value = state.chain;
    var search = el('input', { type: 'search', placeholder: 'Search a protocol, slug or category…', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; renderTableOnly(); } });
    return el('div', { class: 'controls' }, search, catSel, chainSel,
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: state.watch ? true : null, onchange: function (e) { state.watch = e.target.checked; render(); } }), 'Watchlist only'),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: state.early ? true : null, onchange: function (e) { state.early = e.target.checked; render(); } }), 'Early finds only'));
  }

  function renderBoard() {
    var rows = filteredRows();
    var head = el('thead', {},
      el('tr', {},
        th('Rank', 'rank'), th('Protocol', 'name'), th('Category', 'category'),
        th('Chains', 'chain'), th('TVL', 'tvl', 'num'), th('7d', 'change_7d', 'num'),
        th('Age', 'age', 'num'), th('Implied value', 'implied', 'num'), th('Tag', 'tag')));
    var body = el('tbody', {});
    rows.forEach(function (r) {
      var tag = r.watchlist ? el('span', { class: 'pill watch' }, 'Watchlist') : (r.tvl_usd < DATA.floor_usd ? el('span', { class: 'pill early' }, 'Early find') : el('span', { class: 'pill' }, 'Below floor'));
      var rankCls = 'rank-badge' + (r.rank <= 3 ? ' rank-' + r.rank : '');
      var changeCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { state.selected = state.selected === r.slug ? null : r.slug; render(); } },
        el('td', {}, el('span', { class: rankCls }, String(r.rank))),
        el('td', { class: 'name-cell' }, r.name, el('span', { class: 'sub' }, r.slug)),
        el('td', { class: 'cat' }, r.category || '—'),
        el('td', {}, r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '')),
        el('td', { class: 'num' }, usd(r.tvl_usd)),
        el('td', { class: 'num ' + changeCls }, pct(r.change_7d)),
        el('td', { class: 'num' }, ageFmt(r.age_days)),
        el('td', { class: 'num' }, el('b', {}, usd(r.implied_value_usd))),
        el('td', {}, tag));
      body.appendChild(tr);
    });
    if (rows.length === 0) body.appendChild(el('tr', {}, el('td', { class: 'empty', colspan: 9 }, 'No protocol matches this filter. Clear the search or pick another category.')));
    var count = el('div', { class: 'count-line' }, el('strong', {}, String(rows.length) + ' of ' + DATA.board_size + ' protocols'), ' shown · click a row for its detail and farm plan · click a column header to sort');
    var wrap = el('div', { class: 'table-wrap' }, el('table', { class: 'board' }, head, body));
    return [count, wrap];
  }

  function renderDetail() {
    if (!state.selected) return null;
    var r = bySlug(state.selected);
    if (!r) return null;
    var f = factorsOf(r, DATA.model);
    var steps = farmSteps(r);
    var cat = DATA.comparables.by_category[r.category || 'Uncategorised'];
    var compLine = cat
      ? 'Its category, ' + (r.category || 'Uncategorised') + ', has ' + cat.live_count + ' live-token protocols, and their median token is worth ' + cat.multiple + '× their TVL — the multiple this row uses.'
      : 'Its category has fewer than ' + DATA.model.min_live_for_category + ' live-token protocols, so this row uses the global median of ' + DATA.comparables.global_multiple + '× TVL over ' + DATA.comparables.global_live_count + ' live tokens.';
    return el('div', { class: 'detail' },
      el('div', { class: 'detail-card' },
        el('button', { class: 'close-btn', onclick: function () { state.selected = null; render(); } }, 'Close ✕'),
        el('h2', {}, '#' + r.rank + ' · ' + r.name),
        el('p', { class: 'dsub' }, (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · ' + (r.watchlist ? 'on the watchlist' : 'below the watchlist floor') + ' · records no token'),
        el('div', { class: 'detail-grid' },
          el('div', { class: 'stat' }, el('div', { class: 'k' }, 'TVL'), el('div', { class: 'v' }, usd(r.tvl_usd))),
          el('div', { class: 'stat' }, el('div', { class: 'k' }, 'TVL change, 7d'), el('div', { class: 'v', style: 'color:' + (r.change_7d !== null && r.change_7d < 0 ? 'var(--red)' : 'var(--green)') }, pct(r.change_7d))),
          el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Running with no token'), el('div', { class: 'v' }, ageFmt(r.age_days))),
          el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Implied value'), el('div', { class: 'v' }, usd(r.implied_value_usd)))),
        el('div', { class: 'math' },
          el('h3', {}, 'How the value is built — model ' + DATA.model_version),
          el('table', {},
            el('tr', {}, el('td', {}, 'Base: TVL × category multiple (' + f.multiple + '×)'), el('td', {}, usdFull(f.base))),
            el('tr', {}, el('td', {}, 'Growth: 7d ' + pct(r.change_7d) + ' → ×' + f.growthMult.toFixed(4)), el('td', {}, '×' + f.growthMult.toFixed(4))),
            el('tr', {}, el('td', {}, 'Maturity: ' + ageFmt(r.age_days) + ' with no token → ×' + f.maturity.toFixed(4)), el('td', {}, '×' + f.maturity.toFixed(4))),
            el('tr', {}, el('td', {}, 'Chains: ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' → ×' + f.chainMult.toFixed(4)), el('td', {}, '×' + f.chainMult.toFixed(4))),
            el('tr', { class: 'total' }, el('td', {}, 'Implied value'), el('td', {}, usdFull(r.implied_value_usd))))),
        el('div', { class: 'farm' },
          el('h3', {}, 'Farm plan — 7 steps, with cost and time'),
          el('ol', {}, steps.map(function (s, i) { return el('li', {}, el('b', {}, 'Step ' + (i + 1) + '. '), s); }))),
        el('div', { class: 'note' },
          el('h3', {}, 'Read it straight'),
          el('p', {}, compLine + ' ' + r.name + ' records no token in this snapshot — that is the record, not proof it has none. The implied value is the radar\'s own claim from the snapshot\'s figures; it is not a price, and no token launch is promised.'))));
  }

  function renderLive() {
    var head = el('thead', {}, el('tr', {},
      el('th', {}, 'Protocol'), el('th', {}, 'Category'), el('th', { class: 'num' }, 'TVL'), el('th', { class: 'num' }, 'Market cap'), el('th', { class: 'num' }, 'Mcap / TVL'), el('th', { class: 'num' }, '7d')));
    var body = el('tbody', {});
    DATA.live.forEach(function (p) {
      var ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null;
      body.appendChild(el('tr', {},
        el('td', { class: 'name-cell' }, p.name, el('span', { class: 'sub' }, p.slug)),
        el('td', {}, p.category || '—'),
        el('td', { class: 'num' }, usd(p.tvl_usd)),
        el('td', { class: 'num' }, usd(p.mcap_usd)),
        el('td', { class: 'num' }, ratio === null ? 'n/a' : ratio.toFixed(3) + '×'),
        el('td', { class: 'num ' + (p.change_7d !== null && p.change_7d < 0 ? 'down' : 'up') }, pct(p.change_7d))));
    });
    return [
      el('div', { class: 'live-note' }, 'These protocols already have a token that trades, so the board shows the market\'s own value for them — never a model\'s. Their mcap-per-TVL ratios are the comparables the pre-token board is priced from.'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'board' }, head, body)),
    ];
  }

  function renderModel() {
    var cats = Object.keys(DATA.comparables.by_category).map(function (c) {
      return { cat: c, multiple: DATA.comparables.by_category[c].multiple, n: DATA.comparables.by_category[c].live_count };
    }).sort(function (a, b) { return b.multiple - a.multiple; });
    var compRows = cats.map(function (c) {
      return el('tr', {}, el('td', {}, c.cat), el('td', {}, String(c.n) + ' live'), el('td', {}, c.multiple.toFixed(3) + '×'));
    });
    compRows.push(el('tr', { class: 'total' }, el('td', {}, 'Global median'), el('td', {}, String(DATA.comparables.global_live_count) + ' live'), el('td', {}, DATA.comparables.global_multiple.toFixed(3) + '×')));
    var about = el('div', { class: 'model-card' },
      el('h2', {}, 'How the radar prices a token that does not exist yet'),
      el('p', {}, 'A live token\'s market cap, divided by its protocol\'s TVL, is what the market pays per dollar of locked value. This radar takes the median of that ratio inside each category — Lending tokens trade near 0.13× TVL, Dexs near 0.34× — and prices a pre-token protocol at the same ratio, from the snapshot alone. No name is ever special-cased.'),
      el('p', {}, el('code', {}, 'implied = TVL × category multiple × growth × maturity × chains')),
      el('p', {}, 'Growth is the 7-day TVL change, clamped to −50%…+100% and weighted 0.6, so a shrinking protocol is marked down and a growing one marked up. Maturity is how long the protocol has run with no token — longer without one, more pent-up value, up to 3 years. Chains add 3% each, to 4 extra chains, for the surface a multi-chain protocol has.'),
      el('p', {}, 'The board ranks every protocol the snapshot\'s watchlist names, plus every other rankable pre-token protocol below the floor. Live-token protocols are shown apart, at the market\'s own value.'),
      el('h2', {}, 'Comparables from this snapshot'),
      el('table', {}, el('tr', {}, el('th', {}, 'Category'), el('th', {}, 'Live tokens'), el('th', {}, 'Median mcap / TVL')), compRows));
    var sandbox = el('div', { class: 'model-card sandbox' },
      el('h2', {}, 'Model sandbox — change it and re-rank the board'),
      el('p', {}, 'Move a slider and the page recomputes every row with the same arithmetic as main.ts, then re-ranks. The board above always shows the submitted model; this is how you test it.'),
      sandboxSlider('Growth weight', 'growth_weight', 0, 1.5, 0.05),
      sandboxSlider('Maturity floor', 'maturity_floor', 0.3, 1, 0.05),
      sandboxSlider('Chain bonus (per extra chain)', 'chain_bonus', 0, 0.1, 0.01),
      el('label', {}, 'Multiple source', el('select', { onchange: function (e) { state.sandbox.multiple = e.target.value; render(); } },
        el('option', { value: 'category', selected: state.sandbox.multiple === 'category' ? true : null }, 'Category median (submitted model)'),
        el('option', { value: 'global', selected: state.sandbox.multiple === 'global' ? true : null }, 'Global median for every protocol'))),
      el('div', { class: 'sandbox-top' }, el('h3', {}, 'Top 10 under your settings'), sandboxTop()));
    return el('div', { class: 'model-wrap' }, about, sandbox);
  }

  function sandboxSlider(label, key, min, max, step) {
    var val = state.sandbox[key];
    var wrap = el('div', {},
      el('label', {}, label + ' ', el('output', {}, String(val))),
      el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), oninput: function (e) { state.sandbox[key] = parseFloat(e.target.value); render(); } }));
    return wrap;
  }

  function sandboxTop() {
    var m = Object.assign({}, DATA.model, state.sandbox);
    var scored = DATA.rows.map(function (r) { return { row: r, v: impliedOf(r, m) }; });
    scored.sort(function (a, b) { return b.v - a.v || (a.row.slug < b.row.slug ? -1 : 1); });
    var items = scored.slice(0, 10).map(function (s, i) {
      var delta = s.row.rank - (i + 1);
      var d = delta === 0 ? '—' : (delta > 0 ? '▲ +' + delta : '▼ ' + delta);
      return el('li', {}, el('b', {}, '#' + (i + 1) + ' ' + s.row.name + ' '), usd(s.v) + ' · board rank #' + s.row.rank + ' (' + d + ')');
    });
    return el('ol', {}, items);
  }

  function renderTableOnly() {
    var boardPart = document.getElementById('board-part');
    if (!boardPart) { render(); return; }
    var frag = document.createElement('div');
    renderBoard().forEach(function (n) { frag.appendChild(n); });
    boardPart.innerHTML = '';
    while (frag.firstChild) boardPart.appendChild(frag.firstChild);
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var meta = document.getElementById('meta');
    if (meta) meta.textContent = 'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · model ' + DATA.model_version + ' · ' + DATA.board_size + ' protocols ranked';
    var topEl = document.getElementById('top-value');
    if (topEl && DATA.rows[0]) topEl.textContent = usd(DATA.rows[0].implied_value_usd);
    var covEl = document.getElementById('watch-covered');
    if (covEl) covEl.textContent = DATA.rows.filter(function (r) { return r.watchlist; }).length + ' / ' + DATA.watchlist_size;
    app.appendChild(renderStats());
    app.appendChild(renderTabs());
    if (state.tab === 'board') {
      app.appendChild(renderControls());
      var detail = renderDetail();
      if (detail) app.appendChild(detail);
      var part = el('div', { id: 'board-part' });
      renderBoard().forEach(function (n) { part.appendChild(n); });
      app.appendChild(part);
    } else if (state.tab === 'live') {
      renderLive().forEach(function (n) { app.appendChild(n); });
    } else {
      app.appendChild(renderModel());
    }
  }

  render();
})();
