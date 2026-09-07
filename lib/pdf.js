'use strict';
const PDFDocument = require('pdfkit');
const path = require('path');

const FONT_PATH = path.join(__dirname, '..', 'public', 'fonts', 'TikTokSans-Variable.ttf');
const MARGIN = 40;
const CELL_PAD_X = 6;
const CELL_PAD_Y = 6;
const HEADER_ROW_HEIGHT = 22;
const HEADER_BG = '#efeafc';
const BORDER_COLOR = '#d8d3e6';
const VIOLET = '#7c3aed';
const TEXT_COLOR = '#1c1c24';
const FAINT_COLOR = '#6b6b7c';

const COLUMNS = [
  { key: 'date', label: 'Дата', width: 78 },
  { key: 'title', label: 'Мероприятие', width: 198 },
  { key: 'venue', label: 'Площадка', width: 118 },
  { key: 'position', label: 'Должность', width: 121 },
];
const TABLE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

function renderEventsPdf(res, { user, rows }) {
  const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });

  const niceFilename = `Мероприятия — ${user.fullName}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="events.pdf"; filename*=UTF-8''${encodeURIComponent(niceFilename)}`
  );
  doc.pipe(res);

  doc.registerFont('Brand', FONT_PATH);
  doc.font('Brand');

  doc.fillColor(VIOLET).fontSize(20).text('BAUMAN STAGE CREW', MARGIN, MARGIN, { characterSpacing: 1 });
  doc.moveDown(0.3);
  doc.fillColor(TEXT_COLOR).fontSize(15).text(`Список мероприятий — ${user.fullName}`);
  doc.moveDown(0.15);

  const meta = [];
  if (user.studyGroup) meta.push(user.studyGroup);
  meta.push(`Сформировано: ${new Date().toLocaleString('ru-RU')}`);
  meta.push(`Мероприятий: ${rows.length}`);
  doc.fillColor(FAINT_COLOR).fontSize(10).text(meta.join('  ·  '));

  doc.moveDown(1);

  if (!rows.length) {
    doc.fillColor(FAINT_COLOR).fontSize(12).text('Нет данных о мероприятиях.');
    finish(doc);
    return;
  }

  let y = doc.y;
  y = drawTableHeader(doc, y);

  rows.forEach((row) => {
    const rowHeight = computeRowHeight(doc, row);
    if (y + rowHeight > doc.page.height - MARGIN) {
      doc.addPage();
      y = MARGIN;
      y = drawTableHeader(doc, y);
    }
    drawRow(doc, row, y, rowHeight);
    y += rowHeight;
  });

  finish(doc);
}

function finish(doc) {
  addPageNumbers(doc);
  doc.end();
}

function computeRowHeight(doc, row) {
  doc.fontSize(9);
  let maxHeight = 0;
  COLUMNS.forEach((col) => {
    const text = cellText(row, col.key);
    const h = doc.heightOfString(text, { width: col.width - CELL_PAD_X * 2 });
    if (h > maxHeight) maxHeight = h;
  });
  return maxHeight + CELL_PAD_Y * 2;
}

function cellText(row, key) {
  const value = row[key];
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function drawTableHeader(doc, y) {
  let x = MARGIN;
  doc.rect(MARGIN, y, TABLE_WIDTH, HEADER_ROW_HEIGHT).fill(HEADER_BG);
  doc.fillColor(VIOLET).fontSize(8.5);
  COLUMNS.forEach((col) => {
    doc.text(col.label.toUpperCase(), x + CELL_PAD_X, y + 7, {
      width: col.width - CELL_PAD_X * 2,
      characterSpacing: 0.3,
    });
    x += col.width;
  });
  return y + HEADER_ROW_HEIGHT;
}

function drawRow(doc, row, y, rowHeight) {
  let x = MARGIN;
  doc.fontSize(9).fillColor(TEXT_COLOR);
  COLUMNS.forEach((col) => {
    doc.text(cellText(row, col.key), x + CELL_PAD_X, y + CELL_PAD_Y, {
      width: col.width - CELL_PAD_X * 2,
    });
    x += col.width;
  });
  doc
    .strokeColor(BORDER_COLOR)
    .lineWidth(0.5)
    .moveTo(MARGIN, y + rowHeight)
    .lineTo(MARGIN + TABLE_WIDTH, y + rowHeight)
    .stroke();
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    // Временно убираем нижний отступ — иначе text() в зоне margin
    // трактуется pdfkit как нехватка места и молча создаёт новую страницу.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fontSize(8)
      .fillColor(FAINT_COLOR)
      .text(`${i + 1} / ${range.count} · Bauman Stage Crew`, MARGIN, doc.page.height - MARGIN + 12, {
        width: doc.page.width - MARGIN * 2,
        align: 'center',
      });
    doc.page.margins.bottom = bottomMargin;
  }
}

module.exports = { renderEventsPdf };
