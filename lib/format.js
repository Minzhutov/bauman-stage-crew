'use strict';

// Все даты в приложении показываются и вводятся по московскому времени —
// независимо от часового пояса, в котором реально запущен сервер (на проде
// это обычно UTC/Гринвич, из-за чего без явного timeZone даты и время
// уезжали на 3 часа). Москва с 2014 года не переходит на летнее время,
// поэтому смещение фиксированное — не нужна полноценная библиотека поясов.
const MOSCOW_TZ = 'Europe/Moscow';
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const dtFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TZ,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TZ,
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dtFormatter.format(d).replace(',', ' ·');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFormatter.format(d);
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return timeFormatter.format(d);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function toInputValue(iso) {
  // Значение для <input type="datetime-local"> по московскому времени.
  // Сдвигаем момент времени на +3ч и читаем его через getUTC*-геттеры —
  // они не зависят от часового пояса процесса, в отличие от getFullYear()
  // и т.п., которые взяли бы локальное время сервера (на проде — UTC).
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const moscow = new Date(d.getTime() + MOSCOW_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${moscow.getUTCFullYear()}-${pad(moscow.getUTCMonth() + 1)}-${pad(moscow.getUTCDate())}T${pad(moscow.getUTCHours())}:${pad(moscow.getUTCMinutes())}`;
}

// Обратная операция: значение <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"),
// введённое пользователем как московское время, → корректный Date в UTC для
// хранения. Парсим строку как будто она UTC (с суффиксом Z), затем вычитаем
// московское смещение — тоже не зависит от часового пояса процесса.
function fromMoscowInput(value) {
  if (!value) return null;
  // value: "YYYY-MM-DDTHH:mm" (секунды datetime-local обычно не присылает) —
  // дополняем секундами, если их нет, и парсим как UTC-строку.
  const normalized = value.length === 16 ? `${value}:00` : value;
  const asIfUtc = new Date(`${normalized}Z`);
  if (Number.isNaN(asIfUtc.getTime())) return null;
  return new Date(asIfUtc.getTime() - MOSCOW_OFFSET_MS);
}

function isPast(iso) {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

function plural(n, forms) {
  // forms: [один, немного, много] — русские формы множественного числа
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

module.exports = { formatDateTime, formatDate, formatTime, formatBytes, toInputValue, fromMoscowInput, isPast, plural };
