# tests/browser-check.py: drives the real page in Chromium the way Joshua would use it.
# Run: python3 tests/browser-check.py   (serves the folder on a local port, prints PASS/FAIL lines and a count)
import http.server, os, socketserver, subprocess, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tests', 'screenshots'); os.makedirs(SHOTS, exist_ok=True)
SAMPLES = os.path.join(ROOT, 'samples')
results = []
def check(name, ok, detail=''):
    results.append(ok); print(('  PASS ' if ok else '  FAIL ') + name + ('' if ok else ' -> ' + str(detail)))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
httpd = socketserver.TCPServer(('127.0.0.1', 0), Quiet); port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:%d/index.html' % port

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    text = lambda sel: page.locator(sel).inner_text()

    print('\n1. First visit')
    check('four export boxes, results hidden', page.locator('.slot').count() == 4 and page.locator('#results').is_hidden())

    print('\n2. Sample files')
    page.click('#sample')
    check('results appear with the sample banner', page.locator('#results').is_visible() and page.locator('#samplebanner').is_visible())
    tiles = text('#money .tiles')
    check('VT 159,000 to chase, VT 12,000 paid but open, VT 13,500 never invoiced, VT 13,500 to refund', 'VT 159,000' in tiles and 'VT 12,000' in tiles and tiles.count('VT 13,500') == 2, tiles)
    check('12 rows need doing', page.locator('#money tbody tr').count() == 12, page.locator('#money tbody tr').count())
    page.click('#money .chip[data-filter=paid_twice]')
    check('filter to "Paid twice" shows James', page.locator('#money tbody tr').count() == 1 and '1043206' in text('#money tbody'))
    page.click('#money .chip[data-filter=problems]')

    print('\n3. Dive day')
    page.click('.tabs [data-tab=day]')
    check('28 Oct: 2 trips, 7 people', '2 trips, 7 people' in text('#day'), text('#day')[:200])
    crew = page.input_value('#crewtext')
    check('crew message ready, forms that are in left out', '08:00 Two-tank reef dive (4)' in crew and ', Yes' not in crew and 'no medical form' in crew, crew)
    check('missing medical form shown for Lucas', 'no medical form' in text('#day'))
    page.screenshot(path=os.path.join(SHOTS, 'day-desktop.png'), full_page=True)
    page.click('#nextday')
    check('"Next dive day" moves to 29 Oct', '29 Oct' in text('#day'), text('#day')[:120])

    print('\n4. The check date changes the answer')
    page.click('.tabs [data-tab=money]')
    before = text('#money .chips')
    page.fill('#asof', '2026-11-15'); page.dispatch_event('#asof', 'change')
    after = text('#money .chips')
    check('checking as of 15 Nov re-sorts the unpaid bookings', before != after and 'Overdue' in after, after)
    check('...and Hannah is no longer only "overdue" but diving this week', 'Unpaid, diving this week' in text('#money .chips'))
    page.fill('#asof', '2026-10-27'); page.dispatch_event('#asof', 'change')

    print('\n5. Reminders')
    page.click('.tabs [data-tab=reminders]')
    check('six unpaid bookings listed', page.locator('#reminders .rem').count() == 6, page.locator('#reminders .rem').count())
    lucas = page.locator('#reminders .rem', has_text='Lucas Martin')
    check('French chosen for a .fr email', 'Bonjour Lucas' in lucas.locator('textarea').input_value())
    lucas.locator('[data-lang=en]').click()
    lucas = page.locator('#reminders .rem', has_text='Lucas Martin')
    check('switching to English rewrites it', 'Hi Lucas' in lucas.locator('textarea').input_value())

    print('\n6. Revenue')
    page.click('.tabs [data-tab=revenue]')
    rev = text('#revenue')
    check('courses VT 184,500 under 4-1020 Dive Courses', '4-1020' in rev and 'Dive Courses' in rev and 'VT 184,500' in rev, rev)
    page.screenshot(path=os.path.join(SHOTS, 'revenue-desktop.png'), full_page=False)

    print('\n7. Real files dropped in (Excel bookings, CSV invoices and payments)')
    page.click('#clear')
    check('clear hides the results', page.locator('#results').is_hidden())
    page.set_input_files('input[data-kind=bookings]', os.path.join(ROOT, 'tests', 'fixtures', 'bookeo-SAMPLE.xlsx'))
    page.wait_for_selector('#results:not(.hidden)')
    page.set_input_files('input[data-kind=invoices]', os.path.join(SAMPLES, 'xero-invoices-SAMPLE.csv'))
    page.set_input_files('input[data-kind=payments]', os.path.join(SAMPLES, 'payzen-payments-SAMPLE.csv'))
    page.fill('#asof', '2026-10-27'); page.dispatch_event('#asof', 'change')
    check('Excel bookings read: 15 rows', 'bookeo-SAMPLE.xlsx: 15 rows' in text('#slots'), text('#slots')[:200])
    check('same answer from the Excel file: VT 159,000 to chase', 'VT 159,000' in text('#money .tiles'), text('#money .tiles'))
    check('no sample banner for real files', page.locator('#samplebanner').is_hidden())
    page.click('.tabs [data-tab=money]')
    page.screenshot(path=os.path.join(SHOTS, 'money-desktop.png'), full_page=True)

    print('\n8. Changing a column changes the result')
    before = text('#money .tiles')
    page.click('.slot[data-kind=bookings] summary')
    page.select_option('select[data-kind=bookings][data-field=total]', 'Amount paid')
    check('the column section stays open after a change', page.locator('.slot[data-kind=bookings] details').get_attribute('open') is not None)
    after = text('#money .tiles')
    check('reading "Amount paid" as the price changes the totals', before != after and 'VT 490,000' not in after, after)
    page.select_option('select[data-kind=bookings][data-field=total]', 'Total price')
    page.select_option('select[data-kind=bookings][data-field=paid]', 'Amount paid')
    check('putting it back restores them', text('#money .tiles') == before, text('#money .tiles'))

    print('\n9. Wrong files are refused with a reason')
    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False); tmp.write(b'%PDF-1.7 not a spreadsheet'); tmp.close()
    page.set_input_files('input[data-kind=orders]', tmp.name)
    check('a PDF is refused and says what to do', 'Export the report as Excel or CSV' in text('#slots'), text('#slots')[-300:])
    page.click('[data-remove=orders]')
    page.set_input_files('input[data-kind=bookings]', os.path.join(SAMPLES, 'payzen-payments-SAMPLE.csv'))
    check('payments dropped in the bookings box: explained, results hidden', 'does not look like a Bookeo bookings export' in text('#slots') and page.locator('#results').is_hidden(), text('#slots')[:300])
    page.set_input_files('input[data-kind=bookings]', os.path.join(ROOT, 'tests', 'fixtures', 'bookeo-SAMPLE.xlsx'))
    page.fill('#asof', '2026-10-27'); page.dispatch_event('#asof', 'change')

    print('\n10. Downloads')
    page.click('.tabs [data-tab=downloads]')
    with page.expect_download() as d: page.click('[data-dl=fix-xlsx]')
    path = os.path.join(tempfile.gettempdir(), 'bb-fix.xlsx'); d.value.save_as(path)
    out = subprocess.run([sys.executable, '-c', 'import openpyxl,sys; ws=openpyxl.load_workbook(sys.argv[1]).active; print(ws.max_row, ws["A1"].value, ws["C2"].value)', path], capture_output=True, text=True).stdout.split()
    # 12 problems plus the unexplained mask-and-snorkel invoice (no shop export loaded in this run), plus the header
    check('fix list opens in Excel: header plus one row per problem', out[0] == '14' and out[1] == 'Problem' and out[2] == '1043203', out)
    with page.expect_download() as d: page.click('[data-dl=rem-csv]')
    csv_text = open(d.value.path(), encoding='utf-8-sig').read()
    check('reminders CSV has six messages', csv_text.count('VT ') >= 6 and 'Lucas Martin' in csv_text)

    print('\n11. Phone width')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.click('.tabs [data-tab=money]')
    check('no sideways scrolling on a phone', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
    page.screenshot(path=os.path.join(SHOTS, 'money-phone.png'), full_page=False)

    check('no console or page errors', not errors, errors)
    b.close()
httpd.shutdown()
print('\n%d passed, %d failed' % (results.count(True), results.count(False)))
sys.exit(0 if all(results) else 1)
