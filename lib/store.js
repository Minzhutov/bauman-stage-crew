'use strict';
// файловое JSON-хранилище вместо полноценной СУБД — данные в data/db.json
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyDb() {
  return {
    users: [],
    positions: [],
    venues: [],
    achievements: [],
    userAchievements: [],
    events: [],
    eventSignups: [],
    academies: [],
    manuals: [],
    pointsLog: [],
    counters: {},
  };
}

let db;

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    db = emptyDb();
    persist();
  } else {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      db = Object.assign(emptyDb(), JSON.parse(raw));
    } catch (err) {
      console.error('[store] Не удалось прочитать базу данных, создаю новую:', err.message);
      db = emptyDb();
      persist();
    }
  }
  return db;
}

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

function nextId(collection) {
  db.counters[collection] = (db.counters[collection] || 0) + 1;
  return db.counters[collection];
}

function all(collection) {
  return db[collection];
}

function find(collection, id) {
  const numId = Number(id);
  return db[collection].find((item) => item.id === numId) || null;
}

function where(collection, predicate) {
  return db[collection].filter(predicate);
}

function insert(collection, data) {
  const record = Object.assign({ id: nextId(collection) }, data);
  db[collection].push(record);
  persist();
  return record;
}

function insertWithId(collection, data) {
  // Используется только сидом при первичном наполнении, чтобы id были предсказуемыми.
  db[collection].push(data);
  if (data.id > (db.counters[collection] || 0)) db.counters[collection] = data.id;
  return data;
}

function update(collection, id, patch) {
  const record = find(collection, id);
  if (!record) return null;
  Object.assign(record, patch);
  persist();
  return record;
}

function remove(collection, id) {
  const numId = Number(id);
  const idx = db[collection].findIndex((item) => item.id === numId);
  if (idx === -1) return false;
  db[collection].splice(idx, 1);
  persist();
  return true;
}

function removeWhere(collection, predicate) {
  const before = db[collection].length;
  db[collection] = db[collection].filter((item) => !predicate(item));
  const removed = before - db[collection].length;
  if (removed > 0) persist();
  return removed;
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
