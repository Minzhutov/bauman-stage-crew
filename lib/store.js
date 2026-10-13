'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'bsc.sqlite');
const LEGACY_JSON_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = [
  'users',
  'positions',
  'venues',
  'achievements',
  'userAchievements',
  'userBadges',
  'events',
  'eventSignups',
  'eventMessages',
  'academies',
  'academySignups',
  'manuals',
  'pointsLog',
  'seasons',
  'equipment',
  'equipmentCategories',
  'cases',
];

let db;
let stmts = {};
let counterGet;
let counterSet;

function assertCollection(collection) {
  if (!COLLECTIONS.includes(collection)) {
    throw new Error(`[store] Неизвестная коллекция: ${collection}`);
  }
}

function ensureSchema() {
  COLLECTIONS.forEach((name) => {
    db.exec(`CREATE TABLE IF NOT EXISTS "${name}" (id INTEGER PRIMARY KEY, data TEXT NOT NULL)`);
  });
  db.exec('CREATE TABLE IF NOT EXISTS counters (collection TEXT PRIMARY KEY, value INTEGER NOT NULL)');
}

function prepareStatements() {
  stmts = {};
  COLLECTIONS.forEach((name) => {
    stmts[name] = {
      all: db.prepare(`SELECT data FROM "${name}" ORDER BY id`),
      find: db.prepare(`SELECT data FROM "${name}" WHERE id = ?`),
      insert: db.prepare(`INSERT INTO "${name}" (id, data) VALUES (?, ?)`),
      update: db.prepare(`UPDATE "${name}" SET data = ? WHERE id = ?`),
      remove: db.prepare(`DELETE FROM "${name}" WHERE id = ?`),
    };
  });
  counterGet = db.prepare('SELECT value FROM counters WHERE collection = ?');
  counterSet = db.prepare(
    'INSERT INTO counters (collection, value) VALUES (?, ?) ' +
    'ON CONFLICT(collection) DO UPDATE SET value = excluded.value'
  );
}

function discardPartialSqliteFiles() {
  try { db.close(); } catch (err) {}
  [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

function migrateFromJsonIfNeeded(alreadyExisted) {
  if (alreadyExisted) return;
  if (!fs.existsSync(LEGACY_JSON_FILE)) return;

  console.log('[store] Найдена старая data/db.json — переношу данные в SQLite…');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(LEGACY_JSON_FILE, 'utf-8'));
  } catch (err) {
    console.error('[store] Не удалось прочитать data/db.json для переноса:', err.message);
    return;
  }

  const backupFile = `${LEGACY_JSON_FILE}.pre-sqlite-backup`;
  if (!fs.existsSync(backupFile)) {
    fs.copyFileSync(LEGACY_JSON_FILE, backupFile);
    console.log(`[store] Бэкап исходника сохранён: ${backupFile}`);
  }

  const importAll = db.transaction(() => {
    COLLECTIONS.forEach((name) => {
      (raw[name] || []).forEach((record) => {
        stmts[name].insert.run(record.id, JSON.stringify(record));
      });
    });
    const counters = raw.counters || {};
    Object.keys(counters).forEach((name) => counterSet.run(name, counters[name]));
  });
  importAll();

  const mismatches = COLLECTIONS
    .map((name) => {
      const expected = (raw[name] || []).length;
      const actual = stmts[name].all.all().length;
      return { name, expected, actual };
    })
    .filter((c) => c.expected !== c.actual);

  if (mismatches.length) {
    discardPartialSqliteFiles();
    const details = mismatches.map((c) => `${c.name}: ожидалось ${c.expected}, перенесено ${c.actual}`).join('; ');
    throw new Error(
      `[store] Перенос в SQLite не сошёлся по количеству записей (${details}). ` +
      `Исходный data/db.json не тронут, бэкап сохранён в ${backupFile}. ` +
      `Сервер не запущен — нужно разобраться, прежде чем повторять запуск.`
    );
  }

  console.log('[store] Перенос в SQLite завершён и проверен — количество записей совпадает по всем коллекциям.');
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const alreadyExisted = fs.existsSync(DB_FILE);
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema();
  prepareStatements();
  migrateFromJsonIfNeeded(alreadyExisted);
  return db;
}

function persist() {}

function nextId(collection) {
  assertCollection(collection);
  const row = counterGet.get(collection);
  const next = (row ? row.value : 0) + 1;
  counterSet.run(collection, next);
  return next;
}

function all(collection) {
  assertCollection(collection);
  return stmts[collection].all.all().map((row) => JSON.parse(row.data));
}

function find(collection, id) {
  assertCollection(collection);
  const numId = Number(id);
  const row = stmts[collection].find.get(numId);
  return row ? JSON.parse(row.data) : null;
}

function where(collection, predicate) {
  return all(collection).filter(predicate);
}

function insert(collection, data) {
  assertCollection(collection);
  const record = Object.assign({ id: nextId(collection) }, data);
  stmts[collection].insert.run(record.id, JSON.stringify(record));
  return record;
}

function insertWithId(collection, data) {
  assertCollection(collection);
  stmts[collection].insert.run(data.id, JSON.stringify(data));
  const row = counterGet.get(collection);
  const current = row ? row.value : 0;
  if (data.id > current) counterSet.run(collection, data.id);
  return data;
}

function update(collection, id, patch) {
  const record = find(collection, id);
  if (!record) return null;
  Object.assign(record, patch);
  stmts[collection].update.run(JSON.stringify(record), Number(id));
  return record;
}

function remove(collection, id) {
  assertCollection(collection);
  const numId = Number(id);
  const info = stmts[collection].remove.run(numId);
  return info.changes > 0;
}

function removeWhere(collection, predicate) {
  const toRemove = where(collection, predicate);
  if (!toRemove.length) return 0;
  const tx = db.transaction((ids) => {
    ids.forEach((id) => stmts[collection].remove.run(id));
  });
  tx(toRemove.map((r) => r.id));
  return toRemove.length;
}

load();

module.exports = {
  load,
  persist,
  all,
  find,
  where,
  insert,
  insertWithId,
  update,
  remove,
  removeWhere,
  nextId,
};
