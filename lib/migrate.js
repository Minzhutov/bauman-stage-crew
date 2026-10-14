'use strict';
const store = require('./store');
const domain = require('./domain');

// До этой правки состав кейса был общим свойством каталога (cases.items) —
// одно и то же наполнение на все мероприятия. Теперь состав привязан к
// конкретной привязке кейса к мероприятию (event.cases[].items), чтобы один
// и тот же кейс мог иметь разное наполнение на разных мероприятиях. Миграция
// идемпотентна — трогает только записи старой формы, безопасна при повторном
// запуске на каждом старте сервера (в т.ч. на проде после деплоя этой правки).
function migrateCaseContentsToEvents() {
  const casesById = new Map(store.all('cases').map((c) => [c.id, c]));
  let migratedEvents = 0;
  store.all('events').forEach((event) => {
    if (!event.cases || !event.cases.length) return;
    let changed = false;
    const migratedCases = event.cases.map((row) => {
      if (row.items) return row;
      changed = true;
      const caseItem = casesById.get(row.caseId);
      return Object.assign({}, row, { items: (caseItem && caseItem.items) || [] });
    });
    if (changed) {
      store.update('events', event.id, { cases: migratedCases });
      migratedEvents += 1;
    }
  });

  let strippedCases = 0;
  store.all('cases').forEach((c) => {
    if (c.items !== undefined) {
      store.update('cases', c.id, { items: undefined });
      strippedCases += 1;
    }
  });

  if (migratedEvents || strippedCases) {
    console.log(
      `[migrate] Состав кейсов перенесён на привязку к мероприятию: затронуто мероприятий — ${migratedEvents}, очищено записей каталога кейсов — ${strippedCases}.`
    );
  }
}

// Тип «Другое» убран из списка типов кейса — у кейсов, которые на проде
// могли остаться с таким (или любым другим неизвестным) типом, подставляем
// «Рэк» как безопасный дефолт, чтобы страницы с кейсами не ломались на
// несуществующей подписи типа.
function migrateLegacyCaseTypes() {
  let fixed = 0;
  store.all('cases').forEach((c) => {
    if (!domain.CASE_TYPE_LABELS[c.type]) {
      store.update('cases', c.id, { type: 'rack' });
      fixed += 1;
    }
  });
  if (fixed) {
    console.log(`[migrate] Кейсам с устаревшим/неизвестным типом (напр. «Другое») назначен тип «Рэк»: ${fixed}.`);
  }
}

module.exports = { migrateCaseContentsToEvents, migrateLegacyCaseTypes };
