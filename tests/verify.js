// tests/verify.js: node tests for the file reader (src/tablekit.js) and the desk (src/diveDesk.js).
// They load the same two files the page loads. Run: node tests/verify.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const TK = require('../src/tablekit');
const Desk = require('../src/diveDesk');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); } };
const section = (t) => console.log('\n' + t);
const sample = (f) => fs.readFileSync(path.join(__dirname, '..', 'samples', f));
const table = async (bytes, name) => TK.toTable(await TK.readFile(bytes, name));
const AS_OF = '2026-10-27';

(async () => {
  section('1. CSV reading');
  check('comma file', TK.parseCsv('a,b\n1,2\n')[1][1] === '2');
  check('semicolon file (European Excel)', TK.detectDelimiter('Date;Montant;Statut\n') === ';' && TK.parseCsv('a;b\n1;2')[1][0] === '1');
  check('tab file', TK.detectDelimiter('a\tb\tc\n') === '\t');
  const q = TK.parseCsv('name,notes\r\n"Smith, Jo","line one\nline two"\r\n"say ""hi""",x\r\n\r\n');
  check('quoted commas, line breaks and doubled quotes', q.length === 3 && q[1][0] === 'Smith, Jo' && q[1][1] === 'line one\nline two' && q[2][0] === 'say "hi"', q);
  check('byte-order mark is dropped', TK.parseCsv('﻿a,b\n1,2')[0][0] === 'a');

  section('2. Money as exports write it');
  const n = TK.parseNumber;
  check('VT 12,000', n('VT 12,000') === 12000);
  check('$1,200.00', n('$1,200.00') === 1200);
  check('1.234,50 (European)', n('1.234,50') === 1234.5);
  check('12 000 (space thousands)', n('12 000') === 12000);
  check('(500) is negative', n('(500)') === -500);
  check('-48,000 VUV', n('-48,000 VUV') === -48000);
  check('words are not money', n('n/a') === null && n('') === null);

  section('3. Dates as exports write them');
  const d = (v, o) => JSON.stringify(TK.parseDateTime(v, o));
  check('28/10/2026 08:00 (day first)', d('28/10/2026 08:00') === '{"date":"2026-10-28","time":"08:00"}');
  check('10/28/2026 8:00 PM (month first, told)', d('10/28/2026 8:00 PM', 'MDY') === '{"date":"2026-10-28","time":"20:00"}');
  check('2026-10-28T13:30:00', d('2026-10-28T13:30:00') === '{"date":"2026-10-28","time":"13:30"}');
  check('Wed 28 Oct 2026 8:30', d('Wed 28 Oct 2026 8:30') === '{"date":"2026-10-28","time":"08:30"}');
  check('October 28, 2026', d('October 28, 2026') === '{"date":"2026-10-28","time":null}');
  check('28 oct. 2026 (French)', d('28 oct. 2026') === '{"date":"2026-10-28","time":null}');
  check('Excel serial 46323.3333', d('46323.3333') === '{"date":"2026-10-28","time":"08:00"}');
  check('31/02/2026 refused', TK.parseDateTime('31/02/2026') === null);
  check('column with 13/10 reads day first', TK.dateOrder(['03/10/2026', '13/10/2026']) === 'DMY');
  check('column with 10/13 reads month first', TK.dateOrder(['10/03/2026', '10/13/2026']) === 'MDY');

  section('4. Finding the header row and the columns');
  const t1 = TK.toTable(TK.parseCsv(sample('bookeo-bookings-SAMPLE.csv').toString()));
  check('title line above the headers is skipped', t1.headerRow === 1 && t1.headers[0] === 'Booking number' && t1.records.length === 15, t1.headerRow);
  const bm = TK.mapColumns(t1.headers, Desk.SPECS.bookings).map;
  check('booking columns found by name', bm.id === 'Booking number' && bm.start === 'Start' && bm.total === 'Total price' && bm.paid === 'Amount paid' && bm.status === 'Status', bm);
  const xh = ['ContactName', 'EmailAddress', 'InvoiceNumber', 'Reference', 'InvoiceDate', 'DueDate', 'Total', 'TaxTotal', 'InvoiceAmountPaid', 'InvoiceAmountDue', 'AccountCode', 'LineAmount'];
  const xm = TK.mapColumns(xh, Desk.SPECS.invoices).map;
  check('Xero CamelCase headers', xm.number === 'InvoiceNumber' && xm.total === 'Total' && xm.due === 'InvoiceAmountDue' && xm.dueDate === 'DueDate' && xm.date === 'InvoiceDate' && xm.paid === 'InvoiceAmountPaid' && xm.contact === 'ContactName', xm);
  const pm = TK.mapColumns(['Transaction ID', 'Order ID', 'Date', 'Amount', 'Currency', 'Status', 'Customer email'], Desk.SPECS.payments).map;
  check('PayZen columns', pm.id === 'Transaction ID' && pm.order === 'Order ID' && pm.amount === 'Amount' && pm.status === 'Status' && pm.email === 'Customer email', pm);
  const fm = TK.mapColumns(['Montant', 'Statut', 'Référence commande', 'Date de transaction'], Desk.SPECS.payments).map;
  check('French PayZen columns', fm.amount === 'Montant' && fm.status === 'Statut' && fm.order === 'Référence commande' && fm.date === 'Date de transaction', fm);
  const fixed = TK.mapColumns(t1.headers, Desk.SPECS.bookings, { total: 'Amount paid' }).map;
  check('a column chosen on the page wins and is not reused', fixed.total === 'Amount paid' && fixed.paid !== 'Amount paid', fixed);
  check('missing required column is reported', TK.mapColumns(['Foo', 'Bar'], Desk.SPECS.bookings).missing.includes('id'));

  section('5. Excel files');
  const xbytes = TK.xlsxBytes([{ name: 'Fix list', headers: ['Booking', 'Amount', 'Note'], rows: [['1043202', 12000, 'Mark <paid> & "done"'], ['1043205', 13500, '']] }]);
  const back = await TK.readXlsx(xbytes);
  check('an .xlsx written here reads back the same', back[0][0] === 'Booking' && back[1][1] === '12000' && back[1][2] === 'Mark <paid> & "done"' && back.length === 3, back);
  const tmp = path.join(require('os').tmpdir(), 'tablekit-check-' + process.pid + '.xlsx');
  fs.writeFileSync(tmp, xbytes);
  const py = execFileSync('python3', ['-c', 'import sys,openpyxl; ws=openpyxl.load_workbook(sys.argv[1]).active; print(ws["A1"].value, ws["B2"].value, ws["C2"].value)', tmp]).toString().trim();
  fs.unlinkSync(tmp);
  check('Excel (openpyxl) opens it', py === 'Booking 12000 Mark <paid> & "done"', py);
  const xt = await table(fs.readFileSync(path.join(__dirname, 'fixtures', 'bookeo-SAMPLE.xlsx')), 'bookeo.xlsx');
  check('real .xlsx: title row skipped, 15 bookings', xt.headers[0] === 'Booking number' && xt.records.length === 15, xt.headers);
  check('real .xlsx: date cell becomes a date and time', xt.records[0].Start === '2026-10-28 08:00', xt.records[0].Start);
  check('real .xlsx: shared-string text and numbers', xt.records[0].Customer === 'Sarah Mitchell' && xt.records[0]['Total price'] === '24000');
  let refused = '';
  try { await TK.readFile(Buffer.from('%PDF-1.7 ...'), 'report.pdf'); } catch (e) { refused = e.message; }
  check('a PDF is refused with a reason', /PDF/.test(refused), refused);
  try { refused = ''; await TK.readFile(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), 'old.xls'); } catch (e) { refused = e.message; }
  check('an old .xls is refused with a reason', /\.xls/.test(refused), refused);

  section('6. The money check on the sample exports (as of 27 Oct 2026)');
  const tables = {
    bookings: t1,
    invoices: await table(sample('xero-invoices-SAMPLE.csv'), 'x.csv'),
    payments: await table(sample('payzen-payments-SAMPLE.csv'), 'p.csv'),
    orders: await table(sample('woocommerce-orders-SAMPLE.csv'), 'w.csv')
  };
  const data = Desk.prepare(tables);
  check('15 bookings, 15 invoices from 16 lines (one has two lines), 11 payments', data.bookings.length === 15 && data.invoices.length === 15 && data.payments.length === 11, [data.bookings.length, data.invoices.length, data.payments.length]);
  check('currency read from the files', data.opts.currency === 'VUV');
  const r = Desk.check(data, AS_OF);
  const codes = (c) => r.items.filter((x) => x.code === c).map((x) => x.booking ? x.booking.id : (x.payment || x.invoice || {}).id || (x.invoice || {}).number);
  check('paid but still open in Xero: Tom (1043202)', JSON.stringify(codes('paid_open_xero')) === '["1043202"]', codes('paid_open_xero'));
  check('unpaid and diving this week: Mei Lin, Lucas, Emma', JSON.stringify(codes('unpaid_soon').sort()) === '["1043203","1043204","1043207"]', codes('unpaid_soon'));
  check('not in Xero: Aroha (1043205)', JSON.stringify(codes('not_invoiced')) === '["1043205"]', codes('not_invoiced'));
  check('paid twice: James (1043206), VT 13,500 to refund', JSON.stringify(codes('paid_twice')) === '["1043206"]' && r.summary.toRefund === 13500, [codes('paid_twice'), r.summary.toRefund]);
  check('deposit plus balance is not "paid twice"', !codes('paid_twice').includes('1043207'));
  check('amounts differ: Ben (Bookeo 185,000 vs Xero 158,000)', JSON.stringify(codes('amount_differs')) === '["1043209"]');
  check('cancelled with an open invoice: Olivia', JSON.stringify(codes('cancelled_open')) === '["1043210"]');
  check('paid in Xero, unpaid in Bookeo: Noah', JSON.stringify(codes('xero_paid_bookeo_unpaid')) === '["1043211"]');
  check('expired link, not diving soon: Chloe', JSON.stringify(codes('link_failed')) === '["1043208"]');
  check('overdue: Hannah; awaiting: Daniel', JSON.stringify(codes('overdue')) === '["1043212"]' && JSON.stringify(codes('awaiting')) === '["1043213"]');
  check('payment with no booking: WEB-88812', r.items.filter((x) => x.code === 'stray_payment').length === 1 && r.items.find((x) => x.code === 'stray_payment').payment.order === 'WEB-88812');
  check('shop order explains the open mask-and-snorkel invoice', !r.items.some((x) => x.code === 'stray_invoice'));
  check('cruise booking matched by email when the payment has no booking number', JSON.stringify(codes('ok').sort()) === '["1043201","1043214","1043215"]', codes('ok'));
  const grace = r.links['1043215'];
  check('...and its invoice by email and amount', grace.invoice.number === 'INV-2115' && grace.invoiceHow === 'same email and amount' && grace.payments[0].how === 'same email and amount');
  check('refused attempt noted on the unpaid diver', r.items.find((x) => x.booking && x.booking.id === '1043203').note === 'last payment attempt: Refused');
  check('VT 159,000 to chase', r.summary.toChase === 159000, r.summary.toChase);
  check('VT 12,000 paid but not recorded, VT 13,500 never invoiced', r.summary.paidNotRecorded === 12000 && r.summary.notInvoiced === 13500);
  check('booked VT 490,000, received VT 304,000, open in Xero VT 189,500', r.summary.booked === 490000 && r.summary.received === 304000 && r.summary.openInXero === 189500, r.summary);
  check('urgent items sort first', r.items[0].code === 'unpaid_soon');
  const noShop = Desk.check(Desk.prepare({ bookings: tables.bookings, invoices: tables.invoices, payments: tables.payments }), AS_OF);
  check('without the shop export the mask invoice is listed as unexplained', noShop.items.filter((x) => x.code === 'stray_invoice').length === 1);

  section('7. Dive-day manifest');
  check('next dive day after 27 Oct is 28 Oct', Desk.nextDiveDate(data, AS_OF) === '2026-10-28');
  const m = Desk.manifest(data, '2026-10-28', r);
  check('two trips, seven people', m.trips.length === 2 && m.pax === 7, [m.trips.length, m.pax]);
  check('08:00 reef dive has 4 divers, 13:30 Discover has 3', m.trips[0].time === '08:00' && m.trips[0].pax === 4 && m.trips[1].time === '13:30' && m.trips[1].pax === 3);
  const mei = m.trips[0].people.find((p) => p.name === 'Mei Lin Chen');
  check('missing cert level and money owed flagged', mei.flags.includes('no cert level') && mei.flags.includes('owes VT 12,000'), mei.flags);
  const lucas = m.trips[1].people.find((p) => p.name === 'Lucas Martin');
  check('Discover course is not asked for a cert; missing medical form flagged', !lucas.flags.includes('no cert level') && lucas.flags.includes('no medical form'), lucas.flags);
  check('wetsuit sizes counted (3 M, 2 L, 2 S)', JSON.stringify(m.gear['Wetsuit size']) === '{"M":3,"L":2,"S":2}', m.gear);
  check('crew message lists both trips', /2 trips, 7 people/.test(m.crewText) && /08:00 Two-tank reef dive \(4\)/.test(m.crewText) && /13:30 Discover Scuba Diving \(3\)/.test(m.crewText), m.crewText);
  check('cancelled bookings stay off the manifest', Desk.manifest(data, '2026-10-31', r).pax === 0);

  section('8. Reminders and revenue');
  const item = r.items.find((x) => x.booking && x.booking.id === '1043204');
  const en = Desk.reminder(data, item, 'en'), fr = Desk.reminder(data, item, 'fr');
  check('English reminder names the dive, date and amount', /Hi Lucas/.test(en) && /Discover Scuba Diving/.test(en) && /VT 27,000/.test(en) && /1043204/.test(en), en);
  check('French reminder', /Bonjour Lucas/.test(fr) && /27,000/.test(fr) && /13h30/.test(fr), fr);
  const rev = Desk.revenue(data);
  const code = (c) => (rev.find((x) => x.account === c) || {}).amount;
  check('revenue by account: courses 184,500, dives 179,000, rentals 6,500, stay 98,000', code('4-1020') === 184500 && code('4-1010') === 179000 && code('4-1040') === 6500 && code('4-1050') === 98000, rev);
  check('known account names shown', rev.find((x) => x.account === '4-1020').name === 'Dive Courses');

  section('9. Bad rows are reported, not fatal');
  const bad = Desk.prepare({ bookings: TK.toTable(TK.parseCsv('Booking number,Start,Total price\n1,32/13/2026,100\n2,28/10/2026,100\n2,29/10/2026,100\n,,\n')) });
  check('unreadable date reported and skipped', bad.bookings.length === 2 && bad.problems.some((p) => /not readable/.test(p.text)), bad.problems);
  check('duplicate booking number reported', bad.problems.some((p) => /appears twice/.test(p.text)));
  check('a payment row with no amount is reported', Desk.prepare({ payments: TK.toTable(TK.parseCsv('Order ID,Amount,Status\n1043201,abc,Captured\n')) }).problems.length === 1);
  check('the fix list download has a row per problem', Desk.fixListRows(data, r).length === r.items.filter((x) => x.level !== 'ok' && x.code !== 'awaiting').length && Desk.FIX_HEADERS.length === 10);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
