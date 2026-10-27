// src/diveDesk.js: Big Blue Desk. Takes the exports Big Blue already has (Bookeo bookings, Xero invoices,
// PayZen payments, optionally WooCommerce orders), matches every booking to its invoice and its payments, and says
// what needs doing: money received but still open in Xero, bookings never invoiced, double payments, amounts that
// differ, cancelled bookings with an open invoice, unpaid divers who are in the water this week, failed or expired
// payment links, and payments nobody can place. It also builds the dive-day manifest for any date, payment
// reminders in English and French, and revenue by Xero account code.
// The page and the tests load this same file. It needs TableKit (src/tablekit.js) for reading values.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tablekit'));
  else root.DiveDesk = factory(root.TableKit);
})(typeof self !== 'undefined' ? self : this, function (TK) {
  'use strict';

  // ---------- what each export is expected to contain (found by header name, changeable on the page) ----------
  const SPECS = {
    bookings: {
      id: { label: 'Booking number', required: true, synonyms: ['booking number', 'booking id', 'booking ref', 'booking reference', 'booking no', 'reference', 'ref', 'confirmation number', 'booking code'] },
      start: { label: 'Start date', required: true, synonyms: ['start date', 'start', 'date', 'activity date', 'tour date', 'dive date', 'event date', 'start date time', 'date and time'] },
      startTime: { label: 'Start time', synonyms: ['start time', 'time'] },
      product: { label: 'Product', synonyms: ['product', 'product name', 'activity', 'tour', 'event', 'experience', 'service', 'course', 'trip'] },
      customer: { label: 'Customer name', synonyms: ['customer name', 'customer', 'name', 'full name', 'lead participant', 'booked by', 'contact name'], avoid: ['first', 'last', 'product'] },
      firstName: { label: 'First name', synonyms: ['first name', 'customer first name', 'given name', 'prenom'] },
      lastName: { label: 'Last name', synonyms: ['last name', 'customer last name', 'surname', 'family name', 'nom'] },
      email: { label: 'Email', synonyms: ['email', 'customer email', 'email address', 'e mail'] },
      phone: { label: 'Phone', synonyms: ['phone', 'mobile', 'phone number', 'customer phone', 'telephone', 'cell'] },
      pax: { label: 'Participants', synonyms: ['participants', 'number of participants', 'pax', 'people', 'seats', 'number of people', 'guests', 'persons', 'divers'] },
      total: { label: 'Total price', synonyms: ['total', 'total price', 'price', 'booking total', 'total amount', 'amount', 'gross'], avoid: ['paid', 'balance', 'outstanding', 'tax', 'due'] },
      paid: { label: 'Amount paid', synonyms: ['amount paid', 'paid', 'total paid', 'payments received', 'payment received', 'deposit paid'] },
      due: { label: 'Balance due', synonyms: ['balance due', 'balance', 'amount due', 'outstanding', 'remaining', 'to pay'] },
      status: { label: 'Booking status', synonyms: ['status', 'booking status', 'state'], avoid: ['payment'] },
      created: { label: 'Booked on', synonyms: ['booked on', 'creation date', 'created', 'created on', 'date booked', 'booking date'] }
    },
    invoices: {
      number: { label: 'Invoice number', required: true, synonyms: ['invoice number', 'invoice no', 'invoice', 'number', 'invoice id'] },
      reference: { label: 'Reference', synonyms: ['reference', 'ref', 'your reference'] },
      contact: { label: 'Contact', synonyms: ['contact name', 'contact', 'customer', 'name', 'client'] },
      email: { label: 'Email', synonyms: ['email address', 'email', 'contact email'] },
      date: { label: 'Invoice date', synonyms: ['invoice date', 'date', 'issue date'], avoid: ['due', 'planned'] },
      dueDate: { label: 'Due date', synonyms: ['due date', 'payment due'] },
      total: { label: 'Invoice total', required: true, synonyms: ['total', 'invoice total', 'gross', 'amount'], avoid: ['tax', 'paid', 'due', 'line', 'unit'] },
      paid: { label: 'Amount paid', synonyms: ['invoice amount paid', 'amount paid', 'paid'] },
      due: { label: 'Amount due', synonyms: ['invoice amount due', 'amount due', 'balance', 'outstanding'], avoid: ['date'] },
      status: { label: 'Status', synonyms: ['status', 'invoice status'] },
      account: { label: 'Account code', synonyms: ['account code', 'account', 'revenue account'] },
      lineAmount: { label: 'Line amount', synonyms: ['line amount', 'line total'] },
      unitAmount: { label: 'Unit price', synonyms: ['unit amount', 'unit price'] },
      quantity: { label: 'Quantity', synonyms: ['quantity', 'qty'] },
      description: { label: 'Description', synonyms: ['description', 'item', 'details'] },
      currency: { label: 'Currency', synonyms: ['currency', 'currency code'] },
      type: { label: 'Type', synonyms: ['type', 'invoice type'] }
    },
    payments: {
      id: { label: 'Transaction ID', synonyms: ['transaction id', 'transaction uuid', 'transaction', 'trans id', 'transaction number', 'uuid', 'id'] },
      order: { label: 'Order reference', required: true, synonyms: ['order id', 'order reference', 'order number', 'order ref', 'order', 'merchant reference', 'reference commande', 'numero de commande', 'reference'] },
      date: { label: 'Date', synonyms: ['date', 'transaction date', 'payment date', 'capture date', 'creation date', 'date de transaction'] },
      amount: { label: 'Amount', required: true, synonyms: ['amount', 'transaction amount', 'montant', 'captured amount', 'total'] },
      currency: { label: 'Currency', synonyms: ['currency', 'devise'] },
      status: { label: 'Status', required: true, synonyms: ['status', 'transaction status', 'statut', 'result', 'state', 'payment status'] },
      email: { label: 'Email', synonyms: ['email', 'customer email', 'buyer email', 'email address', 'e mail'] },
      name: { label: 'Customer', synonyms: ['customer name', 'customer', 'name', 'buyer', 'cardholder', 'client'] }
    },
    orders: {
      number: { label: 'Order number', required: true, synonyms: ['order number', 'order id', 'order', 'order no', 'id'] },
      date: { label: 'Order date', synonyms: ['order date', 'date', 'created'] },
      status: { label: 'Order status', synonyms: ['order status', 'status'] },
      total: { label: 'Order total', synonyms: ['order total', 'total', 'amount'] },
      email: { label: 'Email', synonyms: ['billing email', 'email', 'customer email'] },
      name: { label: 'Customer', synonyms: ['billing name', 'customer', 'name', 'billing first name'] }
    }
  };

  // Columns worth showing on the dive-day manifest when an export has them.
  const MANIFEST_HINT = /cert|level|padi|ssi|naui|logged|last dive|experience|wetsuit|bcd|fins?\b|mask|boots?|size|height|weight|medical|waiver|form|hotel|pick ?up|accommodation|cruise|ship|notes?|comment|special|request|language|nationality|insurance|\bdan\b|allerg/i;

  const DEFAULTS = {
    currency: 'VUV', shop: 'Big Blue Vanuatu', soonDays: 7, tolerance: 0.01, dateOrder: 'auto',
    accounts: { '4-1020': 'Dive Courses', '4-1040': 'Rentals Sales' }
  };

  // ---------- small helpers ----------
  const DAY = 86400000;
  const toDate = (s) => new Date(s + 'T00:00:00Z');
  const addDays = (s, n) => new Date(toDate(s).getTime() + n * DAY).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const low = (s) => String(s || '').trim().toLowerCase();
  const keyOf = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nameKey = (s) => low(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ').sort().join(' ');
  const close = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.abs(b) * tol);

  const NO_DECIMALS = { VUV: 1, XPF: 1, JPY: 1, KRW: 1 };
  function money(n, cur) {
    if (n == null || !isFinite(n)) return '';
    const c = (cur || 'VUV').toUpperCase(), d = NO_DECIMALS[c] ? 0 : 2;
    const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return (n < 0 ? '-' : '') + (c === 'VUV' ? 'VT ' + s : c === 'USD' ? '$' + s : c === 'AUD' ? 'A$' + s : c === 'NZD' ? 'NZ$' + s : s + ' ' + c);
  }
  function niceDate(s, lang) {
    if (!s) return '';
    return toDate(s).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function paymentState(raw) {
    const s = low(raw);
    if (/refund|rembours|credit/.test(s)) return 'refunded';
    if (/refus|declin|fail|error|abandon|expire|cancel|annul|reject|unpaid|not paid|insufficient/.test(s)) return 'failed';
    if (/pending|wait|attente|manual|review|in progress|en cours/.test(s)) return 'pending';
    if (/captur|accept|author|valid|success|paid|approved|complete|settled|remis|paye|autoris|ok/.test(s)) return 'ok';
    return 'unknown';
  }
  function invoiceState(raw, due, total) {
    const s = low(raw);
    if (/void|delet|cancel/.test(s)) return 'void';
    if (/draft|brouillon/.test(s)) return 'draft';
    if (/paid|paye/.test(s) && !/awaiting|unpaid|part/.test(s)) return 'paid';
    if (due != null) return due <= 0.5 ? (total ? 'paid' : 'open') : 'open';
    return s ? 'open' : 'unknown';
  }
  // Reference tokens: "WC Order #12345", "BK-55210 / Smith" and "55210" give 12345 / BK55210 / 55210.
  // Digit runs count only from 4 digits up and never as a year, so "Oct 2026" or "x2" never links two records.
  const digitKeys = (s) => (String(s).match(/\d+/g) || []).map((d) => d.replace(/^0+/, '')).filter((d) => d.length >= 4 && !(d.length === 4 && +d >= 1990 && +d <= 2099));
  function tokens(...texts) {
    const out = new Set();
    texts.join(' ').split(/[\s,;\/|]+/).forEach((w) => {
      const k = keyOf(w); if (k.length >= 3) out.add(k);
      digitKeys(w).forEach((d) => out.add(d));
    });
    return out;
  }
  const refersTo = (tokenSet, id) => tokenSet.has(keyOf(id)) || digitKeys(id).some((d) => tokenSet.has(d));

  // ---------- reading the exports into clean lists ----------
  // tables: { bookings: {headers, records}, invoices: ..., payments: ..., orders: ... } (from TableKit.toTable)
  // maps:   optional column choices from the page, { bookings: { id: 'Booking ref', ... }, ... }
  function columns(kind, table, fixed) {
    return TK.mapColumns(table ? table.headers : [], SPECS[kind], fixed);
  }
  function prepare(tables, maps, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const problems = [], cols = {};
    const get = (rec, map, f) => (map[f] ? rec[map[f]] : '');
    ['bookings', 'invoices', 'payments', 'orders'].forEach((k) => { if (tables[k]) cols[k] = columns(k, tables[k], (maps || {})[k]); });

    // bookings
    const bookings = [];
    if (tables.bookings) {
      const m = cols.bookings.map;
      const order = o.dateOrder !== 'auto' ? o.dateOrder : TK.dateOrder(tables.bookings.records.map((r) => get(r, m, 'start')), 'DMY');
      tables.bookings.records.forEach((r) => {
        const id = String(get(r, m, 'id')).trim();
        const when = TK.parseDateTime(get(r, m, 'start'), order);
        if (!id && !when) return;
        if (!id) { problems.push({ file: 'bookings', row: r._row, text: 'no booking number' }); return; }
        if (!when) { problems.push({ file: 'bookings', row: r._row, text: 'booking ' + id + ': start date "' + get(r, m, 'start') + '" not readable' }); return; }
        const name = String(get(r, m, 'customer') || [get(r, m, 'firstName'), get(r, m, 'lastName')].filter(Boolean).join(' ')).trim();
        const total = TK.parseNumber(get(r, m, 'total')), paidRaw = TK.parseNumber(get(r, m, 'paid')), dueRaw = TK.parseNumber(get(r, m, 'due'));
        const paid = paidRaw != null ? paidRaw : (total != null && dueRaw != null ? total - dueRaw : null);
        const extras = {};
        tables.bookings.headers.forEach((h) => { if (!Object.values(m).includes(h) && MANIFEST_HINT.test(h) && String(r[h] || '').trim()) extras[h] = String(r[h]).trim(); });
        bookings.push({
          id, date: when.date, time: when.time || TK.parseTime(get(r, m, 'startTime')) || '', product: String(get(r, m, 'product') || '').trim(),
          name, first: String(get(r, m, 'firstName') || name.split(' ')[0] || '').trim(), email: low(get(r, m, 'email')), phone: String(get(r, m, 'phone') || '').trim(),
          pax: TK.parseNumber(get(r, m, 'pax')) || 1, total, paid, due: dueRaw != null ? dueRaw : (total != null && paid != null ? total - paid : null),
          cancelled: /cancel|annul|no ?show|void|delet/.test(low(get(r, m, 'status'))), extras, row: r._row
        });
      });
      const seen = {};
      bookings.forEach((b) => { if (seen[b.id]) problems.push({ file: 'bookings', row: b.row, text: 'booking ' + b.id + ' appears twice (rows ' + seen[b.id] + ' and ' + b.row + ')' }); else seen[b.id] = b.row; });
    }

    // invoices: Xero exports one row per line, so rows are grouped by invoice number
    const invoices = [], byNumber = {};
    if (tables.invoices) {
      const m = cols.invoices.map;
      const order = o.dateOrder !== 'auto' ? o.dateOrder : TK.dateOrder(tables.invoices.records.map((r) => get(r, m, 'date')), 'DMY');
      tables.invoices.records.forEach((r) => {
        if (m.type && /bill|accpay|purchase|achat/.test(low(r[m.type]))) return;
        const num = String(get(r, m, 'number')).trim();
        if (!num) return;
        let inv = byNumber[num];
        if (!inv) {
          const total = TK.parseNumber(get(r, m, 'total')), paid = TK.parseNumber(get(r, m, 'paid')), due = TK.parseNumber(get(r, m, 'due'));
          const dt = TK.parseDateTime(get(r, m, 'date'), order), dd = TK.parseDateTime(get(r, m, 'dueDate'), order);
          inv = byNumber[num] = {
            number: num, reference: String(get(r, m, 'reference') || '').trim(), contact: String(get(r, m, 'contact') || '').trim(), email: low(get(r, m, 'email')),
            date: dt ? dt.date : null, dueDate: dd ? dd.date : null, total, paid: paid != null ? paid : (total != null && due != null ? total - due : null),
            due: due != null ? due : (total != null && paid != null ? total - paid : null), currency: String(get(r, m, 'currency') || '').trim().toUpperCase(),
            rawStatus: String(get(r, m, 'status') || '').trim(), lines: [], descriptions: [], row: r._row
          };
          if (total == null) problems.push({ file: 'invoices', row: r._row, text: 'invoice ' + num + ': total "' + get(r, m, 'total') + '" not readable' });
          invoices.push(inv);
        }
        const qty = TK.parseNumber(get(r, m, 'quantity')), unit = TK.parseNumber(get(r, m, 'unitAmount')), line = TK.parseNumber(get(r, m, 'lineAmount'));
        const amount = line != null ? line : (unit != null ? unit * (qty == null ? 1 : qty) : null);
        const desc = String(get(r, m, 'description') || '').trim();
        if (desc) inv.descriptions.push(desc);
        if (amount != null || m.account) inv.lines.push({ account: String(get(r, m, 'account') || '').trim(), amount, description: desc });
      });
      invoices.forEach((v) => { v.state = invoiceState(v.rawStatus, v.due, v.total); v.tokens = tokens(v.number, v.reference, v.descriptions.join(' ')); });
    }

    // payments
    const payments = [];
    if (tables.payments) {
      const m = cols.payments.map;
      const order = o.dateOrder !== 'auto' ? o.dateOrder : TK.dateOrder(tables.payments.records.map((r) => get(r, m, 'date')), 'DMY');
      tables.payments.records.forEach((r, i) => {
        const amount = TK.parseNumber(get(r, m, 'amount'));
        if (amount == null) { if (Object.values(r).some((v) => String(v).trim())) problems.push({ file: 'payments', row: r._row, text: 'amount "' + get(r, m, 'amount') + '" not readable' }); return; }
        const dt = TK.parseDateTime(get(r, m, 'date'), order);
        payments.push({
          id: String(get(r, m, 'id') || 'row ' + r._row).trim(), order: String(get(r, m, 'order') || '').trim(), date: dt ? dt.date : null, amount,
          currency: String(get(r, m, 'currency') || '').trim().toUpperCase(), state: paymentState(get(r, m, 'status')), rawStatus: String(get(r, m, 'status') || '').trim(),
          email: low(get(r, m, 'email')), name: String(get(r, m, 'name') || '').trim(), row: r._row, idx: i
        });
      });
    }

    // WooCommerce orders (optional): their numbers help place payments and invoices that quote "WC Order #"
    const orders = [];
    if (tables.orders) {
      const m = cols.orders.map;
      tables.orders.records.forEach((r) => {
        const number = String(get(r, m, 'number') || '').trim(); if (!number) return;
        const dt = TK.parseDateTime(get(r, m, 'date'), 'DMY');
        orders.push({ number, date: dt ? dt.date : null, status: low(get(r, m, 'status')), total: TK.parseNumber(get(r, m, 'total')), email: low(get(r, m, 'email')), name: String(get(r, m, 'name') || '').trim() });
      });
    }

    const currency = (invoices.find((v) => v.currency) || payments.find((p) => p.currency) || {}).currency || o.currency;
    return { bookings, invoices, payments, orders, problems, columns: cols, opts: Object.assign(o, { currency }) };
  }

  // ---------- matching ----------
  function match(data) {
    const o = data.opts, links = {};
    const invTaken = new Set();
    data.bookings.forEach((b) => { links[b.id] = { invoice: null, invoiceHow: null, payments: [] }; });
    const nearest = (list, dateOf, target) => list.sort((a, b) => Math.abs(daysBetween(dateOf(a) || target, target)) - Math.abs(daysBetween(dateOf(b) || target, target)))[0];
    // 1. booking number quoted on the invoice (number, reference or line description)
    data.bookings.forEach((b) => {
      const inv = data.invoices.find((v) => !invTaken.has(v) && refersTo(v.tokens, b.id));
      if (inv) { links[b.id].invoice = inv; links[b.id].invoiceHow = 'booking number on the invoice'; invTaken.add(inv); }
    });
    // 2. same email (or same name) and amount, invoiced within 45 days of the dive; the closest date wins
    data.bookings.forEach((b) => {
      if (links[b.id].invoice || b.total == null) return;
      const cands = data.invoices.filter((v) => !invTaken.has(v) && ((b.email && v.email === b.email) || (b.name && nameKey(v.contact) === nameKey(b.name))) && close(v.total, b.total, o.tolerance) && (!v.date || Math.abs(daysBetween(v.date, b.date)) <= 45));
      const inv = nearest(cands, (v) => v.date, b.date);
      if (inv) { links[b.id].invoice = inv; links[b.id].invoiceHow = b.email && inv.email === b.email ? 'same email and amount' : 'same name and amount'; invTaken.add(inv); }
    });
    // payments: by order reference (booking number, invoice number or invoice reference), then email and amount
    const payTaken = new Set();
    data.payments.forEach((p) => {
      const pk = tokens(p.order);
      const b = data.bookings.find((x) => { const inv = links[x.id].invoice; return refersTo(pk, x.id) || (inv && (refersTo(pk, inv.number) || (inv.reference && refersTo(pk, inv.reference)))); });
      if (b) { links[b.id].payments.push(Object.assign({ how: 'order reference' }, p)); payTaken.add(p); }
    });
    data.payments.forEach((p) => {
      if (payTaken.has(p) || !p.email) return;
      const cands = data.bookings.filter((x) => x.email === p.email && (close(p.amount, x.total, o.tolerance) || (links[x.id].invoice && close(p.amount, links[x.id].invoice.total, o.tolerance))) && (!p.date || daysBetween(p.date, x.date) >= -60));
      const b = nearest(cands, (x) => x.date, p.date || cands.length && cands[0].date);
      if (b) { links[b.id].payments.push(Object.assign({ how: 'same email and amount' }, p)); payTaken.add(p); }
    });
    return { links, invTaken, payTaken };
  }

  // ---------- verdicts ----------
  const ACTIONS = {
    paid_open_xero: { level: 'act', title: 'Paid, but still open in Xero', action: 'Mark the invoice paid in Xero' },
    not_invoiced: { level: 'act', title: 'Not in Xero', action: 'Create the invoice in Xero' },
    paid_twice: { level: 'act', title: 'Paid twice', action: 'Refund the second payment' },
    amount_differs: { level: 'act', title: 'Amounts differ', action: 'Correct the booking or the invoice' },
    cancelled_open: { level: 'act', title: 'Cancelled, invoice still open', action: 'Void the invoice or issue a credit note' },
    cancelled_paid: { level: 'act', title: 'Cancelled, paid, no refund', action: 'Refund, or keep as credit and note it' },
    unpaid_soon: { level: 'urgent', title: 'Unpaid, diving this week', action: 'Remind today or take payment on arrival' },
    link_failed: { level: 'act', title: 'Payment failed or link expired', action: 'Send a new payment link' },
    overdue: { level: 'act', title: 'Overdue', action: 'Send a reminder' },
    xero_paid_bookeo_unpaid: { level: 'act', title: 'Paid in Xero, unpaid in Bookeo', action: 'Mark it paid in Bookeo' },
    awaiting: { level: 'info', title: 'Awaiting payment', action: 'Nothing yet' },
    stray_payment: { level: 'act', title: 'Payment with no booking', action: 'Find the booking and allocate it' },
    stray_invoice: { level: 'info', title: 'Open invoice, no booking', action: 'Check it is a shop or walk-in sale' },
    ok: { level: 'ok', title: 'All matched', action: '' }
  };

  function check(data, asOf) {
    const today = asOf || new Date().toISOString().slice(0, 10), o = data.opts;
    const { links, invTaken, payTaken } = match(data);
    const items = [];
    const add = (code, b, extra) => items.push(Object.assign({ code, level: ACTIONS[code].level, title: ACTIONS[code].title, action: ACTIONS[code].action, booking: b || null }, extra || {}));

    data.bookings.forEach((b) => {
      const L = links[b.id], inv = L.invoice;
      const okPays = L.payments.filter((p) => p.state === 'ok'), failed = L.payments.filter((p) => p.state === 'failed');
      const refunded = L.payments.some((p) => p.state === 'refunded');
      const received = okPays.reduce((s, p) => s + p.amount, 0);
      const base = { invoice: inv, payments: L.payments, how: L.invoiceHow, received };
      if (b.cancelled) {
        if (inv && (inv.state === 'open' || inv.state === 'draft')) add('cancelled_open', b, base);
        else if (okPays.length && !refunded) add('cancelled_paid', b, base);
        return;
      }
      if (!b.total) { add('ok', b, base); return; }
      const flagged = [];
      const slack = Math.max(1, b.total * o.tolerance), owedTotal = inv && inv.total != null ? inv.total : b.total;
      if (!inv) flagged.push('not_invoiced');
      if (inv && inv.total != null && !close(inv.total, b.total, o.tolerance)) flagged.push('amount_differs');
      // more than one successful payment and more money in than the booking is worth (a 50/50 deposit is fine)
      if (okPays.length > 1 && received > owedTotal + slack) flagged.push('paid_twice');
      const paidSomewhere = received >= owedTotal - slack || (b.paid != null && b.paid >= b.total - slack);
      if (inv && inv.state === 'open' && paidSomewhere) flagged.push('paid_open_xero');
      if (inv && inv.state === 'paid' && b.paid != null && b.paid < b.total - slack && !okPays.length) flagged.push('xero_paid_bookeo_unpaid');
      const unpaid = !paidSomewhere && !(inv && inv.state === 'paid');
      let note = '';
      if (unpaid) {
        const days = daysBetween(today, b.date);
        if (failed.length) note = 'last payment attempt: ' + (failed[failed.length - 1].rawStatus || 'failed');
        if (days >= 0 && days <= o.soonDays) flagged.push('unpaid_soon');
        else if (failed.length) flagged.push('link_failed');
        else if (inv && inv.dueDate && inv.dueDate < today) flagged.push('overdue');
        else flagged.push('awaiting');
      }
      if (!flagged.length) add('ok', b, base);
      flagged.forEach((c) => add(c, b, Object.assign({ note, owed: unpaid ? Math.max(0, inv && inv.due != null ? inv.due : b.total - (b.paid || 0) - received) : null, overpaid: c === 'paid_twice' ? received - owedTotal : null }, base)));
    });

    // shop orders (WooCommerce) explain payments and invoices that have no booking
    const shop = new Set(); data.orders.forEach((w) => { shop.add(keyOf(w.number)); digitKeys(w.number).forEach((d) => shop.add(d)); });
    const isShop = (set) => [...set].some((t) => shop.has(t));
    data.payments.forEach((p) => { if (!payTaken.has(p) && p.state === 'ok' && !isShop(tokens(p.order))) add('stray_payment', null, { payment: p }); });
    data.invoices.forEach((v) => { if (!invTaken.has(v) && v.state === 'open' && data.bookings.length && !isShop(v.tokens)) add('stray_invoice', null, { invoice: v }); });

    // money summary
    const active = data.bookings.filter((b) => !b.cancelled && b.total);
    const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
    const owedItems = items.filter((x) => ['unpaid_soon', 'overdue', 'awaiting', 'link_failed'].includes(x.code));
    const owed = {}; owedItems.forEach((x) => { owed[x.booking.id] = x.owed || 0; });
    const summary = {
      asOf: today, currency: o.currency, bookings: active.length, cancelled: data.bookings.length - active.length,
      booked: sum(active, (b) => b.total), received: sum(data.payments.filter((p) => p.state === 'ok'), (p) => p.amount),
      openInXero: sum(data.invoices.filter((v) => v.state === 'open'), (v) => v.due),
      toChase: Object.values(owed).reduce((s, n) => s + n, 0),
      paidNotRecorded: sum(items.filter((x) => x.code === 'paid_open_xero'), (x) => (x.invoice && x.invoice.due) || 0),
      notInvoiced: sum(items.filter((x) => x.code === 'not_invoiced'), (x) => x.booking.total),
      toRefund: sum(items.filter((x) => x.code === 'paid_twice'), (x) => x.overpaid),
      counts: {}
    };
    items.forEach((x) => { summary.counts[x.code] = (summary.counts[x.code] || 0) + 1; });
    const order = ['unpaid_soon', 'paid_open_xero', 'not_invoiced', 'paid_twice', 'link_failed', 'amount_differs', 'cancelled_open', 'cancelled_paid', 'xero_paid_bookeo_unpaid', 'stray_payment', 'overdue', 'awaiting', 'stray_invoice', 'ok'];
    items.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code) || String((a.booking || {}).date || '').localeCompare(String((b.booking || {}).date || '')));
    return { items, summary, links };
  }

  // ---------- revenue by account ----------
  function revenue(data) {
    const by = {};
    data.invoices.filter((v) => v.state !== 'void' && v.state !== 'draft').forEach((v) => {
      const lines = v.lines.filter((l) => l.amount != null);
      if (!lines.length) { const k = '(no account)'; by[k] = by[k] || { account: k, name: '', amount: 0, invoices: 0 }; by[k].amount += v.total || 0; by[k].invoices++; return; }
      const seen = new Set();
      lines.forEach((l) => {
        const k = l.account || '(no account)';
        by[k] = by[k] || { account: k, name: data.opts.accounts[k] || '', amount: 0, invoices: 0 };
        by[k].amount += l.amount; if (!seen.has(k)) { by[k].invoices++; seen.add(k); }
      });
    });
    return Object.values(by).sort((a, b) => b.amount - a.amount);
  }

  // ---------- dive-day manifest ----------
  function manifest(data, date, result) {
    const owing = {};
    (result ? result.items : []).forEach((x) => { if (x.booking && x.owed) owing[x.booking.id] = x.owed; });
    const day = data.bookings.filter((b) => b.date === date && !b.cancelled).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.product.localeCompare(b.product));
    // columns any booking in the export filled in: a blank one on a diver's row is worth flagging
    const allCols = Object.keys(data.bookings.reduce((a, x) => Object.assign(a, x.extras), {}));
    const certCol = allCols.find((h) => /cert|level/i.test(h)), formCols = allCols.filter((h) => /medical|waiver|form/i.test(h));
    const trips = [];
    day.forEach((b) => {
      let t = trips.find((x) => x.time === b.time && x.product === b.product);
      if (!t) { t = { time: b.time, product: b.product, pax: 0, people: [] }; trips.push(t); }
      const flags = [], ex = b.extras;
      const isCourse = /course|open water|discover|scuba diver|rescue|divemaster|idc|instructor|try|intro/i.test(b.product);
      if (certCol && !isCourse && !ex[certCol]) flags.push('no cert level');
      formCols.forEach((h) => { if (!ex[h] || /^(no|n|false|0|missing|pending|not received)$/i.test(ex[h])) flags.push('no ' + h.toLowerCase()); });
      if (owing[b.id]) flags.push('owes ' + money(owing[b.id], data.opts.currency));
      if (!b.phone) flags.push('no phone');
      t.pax += b.pax; t.people.push({ id: b.id, name: b.name, pax: b.pax, phone: b.phone, extras: ex, flags });
    });
    const gear = {};
    day.forEach((b) => Object.entries(b.extras).forEach(([h, v]) => { if (/size|wetsuit|bcd|fins?\b|boots?/i.test(h)) { gear[h] = gear[h] || {}; String(v).split(/[,;\/]+/).map((s) => s.trim()).filter(Boolean).forEach((s) => { gear[h][s] = (gear[h][s] || 0) + 1; }); } }));
    const pax = trips.reduce((s, t) => s + t.pax, 0);
    const flagged = trips.reduce((s, t) => s + t.people.filter((p) => p.flags.length).length, 0);
    const lines = [niceDate(date) + ': ' + trips.length + (trips.length === 1 ? ' trip, ' : ' trips, ') + pax + (pax === 1 ? ' person' : ' people') + '.'];
    trips.forEach((t) => {
      lines.push('');
      lines.push((t.time || 'No time') + ' ' + (t.product || 'Trip') + ' (' + t.pax + ')');
      // a form that is in ("Yes") needs no mention on the crew message; a missing one shows as a flag instead
      const said = (p) => Object.entries(p.extras).filter(([h, v]) => !/notes?|comment/i.test(h) && !(/medical|waiver|form/i.test(h) && /^(yes|y|true|ok|received|signed|done)$/i.test(v))).map(([, v]) => v);
      t.people.forEach((p) => { const s = said(p); lines.push('- ' + p.name + (p.pax > 1 ? ' x' + p.pax : '') + (s.length ? ': ' + s.join(', ') : '') + (p.flags.length ? ' [' + p.flags.join('; ') + ']' : '')); });
    });
    Object.entries(gear).forEach(([h, counts]) => { lines.push(''); lines.push(h + ': ' + Object.entries(counts).map(([s, n]) => n + ' x ' + s).join(', ')); });
    return { date, trips, pax, flagged, gear, crewText: lines.join('\n') };
  }
  // The next date (from asOf) that has bookings, so the manifest opens on something useful.
  function nextDiveDate(data, asOf) {
    const today = asOf || new Date().toISOString().slice(0, 10);
    const dates = [...new Set(data.bookings.filter((b) => !b.cancelled).map((b) => b.date))].sort();
    return dates.find((d) => d > today) || dates.find((d) => d >= today) || dates[dates.length - 1] || today;
  }

  // ---------- reminders ----------
  function reminder(data, item, lang) {
    const b = item.booking, cur = data.opts.currency, amt = money(item.owed != null ? item.owed : b.total, cur), shop = data.opts.shop;
    const first = b.first || 'there';
    if (lang === 'fr') return 'Bonjour ' + (b.first || '') + ',\n\nMerci pour votre réservation : ' + (b.product || 'votre sortie') + ', le ' + niceDate(b.date, 'fr') + (b.time ? ' à ' + b.time.replace(':', 'h') : '') + '. Nous n’avons pas encore reçu le paiement de ' + amt + ' (réservation ' + b.id + ').\n\nVous pouvez régler à la boutique sur le front de mer à Port-Vila, ou répondre à ce message et nous vous enverrons un lien de paiement.\n\nÀ bientôt sous l’eau,\n' + shop;
    return 'Hi ' + first + ',\n\nThanks for booking ' + (b.product || 'with us') + ' on ' + niceDate(b.date) + (b.time ? ' at ' + b.time : '') + '. We haven’t received the payment of ' + amt + ' yet (booking ' + b.id + ').\n\nYou can pay at the shop on the seawall in Port Vila, or reply to this message and we’ll send you a payment link.\n\nSee you on the water,\n' + shop;
  }

  // ---------- downloads ----------
  function fixListRows(data, result) {
    const cur = data.opts.currency;
    return result.items.filter((x) => x.level !== 'ok' && x.code !== 'awaiting').map((x) => {
      const b = x.booking || {}, inv = x.invoice || {}, p = x.payment || {};
      return [x.title, x.action, b.id || '', b.date || p.date || inv.date || '', b.name || p.name || p.email || inv.contact || '', b.product || '', b.total != null ? money(b.total, cur) : (p.amount != null ? money(p.amount, cur) : ''), inv.number || '', inv.number ? money(inv.due, cur) : '', (x.payments || (p.id ? [p] : [])).map((q) => q.id + ' ' + q.rawStatus).join('; ')];
    });
  }
  const FIX_HEADERS = ['Problem', 'What to do', 'Booking', 'Date', 'Customer', 'Product', 'Amount', 'Xero invoice', 'Still due in Xero', 'Payments'];

  return { SPECS, DEFAULTS, ACTIONS, columns, prepare, check, revenue, manifest, nextDiveDate, reminder, money, niceDate, paymentState, invoiceState, fixListRows, FIX_HEADERS };
});
