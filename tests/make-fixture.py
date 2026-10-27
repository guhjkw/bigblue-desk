# tests/make-fixture.py: writes tests/fixtures/bookeo-SAMPLE.xlsx, a real Excel file (compressed, shared strings,
# date-formatted cells, a title row above the headers) from the invented sample CSV, so the reader is tested on
# the kind of file Excel and booking systems produce, not only on files this project writes itself.
import csv, datetime, os
from openpyxl import Workbook
here = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.reader(open(os.path.join(here, '..', 'samples', 'bookeo-bookings-SAMPLE.csv'), encoding='utf-8')))
wb = Workbook(); ws = wb.active; ws.title = 'Bookings'
ws.append([rows[0][0]])
ws.append(rows[1])
for r in rows[2:]:
    r = list(r)
    d, t = r[1].split(' ')
    dd, mm, yy = d.split('/'); hh, mi = t.split(':')
    r[1] = datetime.datetime(int(yy), int(mm), int(dd), int(hh), int(mi))
    r[6] = int(r[6])
    for i in (7, 8):
        r[i] = int(r[i].replace('VT', '').replace(',', '').strip())
    ws.append(r)
for row in ws.iter_rows(min_row=3, min_col=2, max_col=2):
    for c in row: c.number_format = 'dd/mm/yyyy hh:mm'
wb.save(os.path.join(here, 'fixtures', 'bookeo-SAMPLE.xlsx'))
print('wrote tests/fixtures/bookeo-SAMPLE.xlsx')
