'use strict';
const store = require('./store');

function inRange(iso, range) {
  if (!range) return true;
  const t = new Date(iso).getTime();
  return t >= new Date(range.startsAt).getTime() && t <= new Date(range.endsAt).getTime();
}

function activeSeason() {
  const now = Date.now();
  return store.all('seasons').find((s) => new Date(s.startsAt).getTime() <= now && now <= new Date(s.endsAt).getTime()) || null;
}

function userPoints(userId, range) {
  return store
    .where('pointsLog', (p) => p.userId === Number(userId) && inRange(p.awardedAt, range))
    .reduce((sum, p) => sum + p.amount, 0);
}

function userPointsHistory(userId) {
  return store
    .where('pointsLog', (p) => p.userId === Number(userId))
    .map((p) => Object.assign({}, p, {
      event: p.eventId ? store.find('events', p.eventId) : null,
      academy: p.academyId ? store.find('academies', p.academyId) : null,
      manual: p.manualId ? store.find('manuals', p.manualId) : null,
      awardedByUser: p.awardedBy ? store.find('users', p.awardedBy) : null,
    }))
    .sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt));
}

function userEventsCompletedCount(userId) {
  return store.where('eventSignups', (s) => s.userId === Number(userId) && s.status === 'done').length;
}

function userAcademiesAttendedCount(userId) {
  const academyIds = store
    .where('pointsLog', (p) => p.userId === Number(userId) && p.academyId)
    .map((p) => p.academyId);
  return new Set(academyIds).size;
}

// key = achievement.autoRuleType
const AUTO_RULES = {
  events_completed: {
    label: 'Закрытых смен на мероприятиях',
    metric: (userId) => userEventsCompletedCount(userId),
  },
  points_total: {
    label: 'Баллов всего',
    metric: (userId) => userPoints(userId),
  },
  academies_attended: {
    label: 'Лекций Академии с начисленными баллами',
    metric: (userId) => userAcademiesAttendedCount(userId),
  },
  positions_count: {
    label: 'Доступных должностей в профиле',
    metric: (userId) => userPositions(userId).length,
  },
};

// Ачивка — это лестница из 1+ уровней (levels[]), каждый со своей редкостью
// и (для авто-ачивок) своим порогом. У ачивки без прогрессии — один уровень.
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
const RARITY_LABELS = {
  common: 'Обычная',
  rare: 'Редкая',
  epic: 'Эпическая',
  legendary: 'Легендарная',
};

// Группировка каталога должностей по цехам — используется в профиле и
// в каталоге должностей, чтобы длинный плоский список читался проще.
const POSITION_CATEGORY_ORDER = ['sound', 'dj', 'light', 'screens', 'broadcast', 'stage', 'management', 'other'];
const POSITION_CATEGORY_LABELS = {
  sound: 'Звук',
  dj: 'Диджеинг',
  light: 'Свет',
  screens: 'Экраны',
  broadcast: 'Трансляции',
  stage: 'Сцена',
  management: 'Управление',
  other: 'Другое',
};

// Направления лекций Академии — простой список готовых подписей (не ключей,
// как у должностей): у лекций нет прав/фильтров, завязанных на код направления.
const ACADEMY_TOPICS = ['Звук', 'Свет', 'Видео', 'Сцена', 'Безопасность', 'Управление', 'Другое'];

function groupPositionsByCategory(positions) {
  const buckets = new Map();
  positions.forEach((p) => {
    const key = POSITION_CATEGORY_LABELS[p.category] ? p.category : 'other';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  });
  return POSITION_CATEGORY_ORDER
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: POSITION_CATEGORY_LABELS[key], positions: buckets.get(key) }));
}

// Категории оборудования — в отличие от категорий должностей, это настоящий
// редактируемый каталог (админ может добавлять/переименовывать/удалять свои
// цеха: «Радиосистемы», «Электричество» и т.п.), а не фиксированный список в
// коде — см. CRUD в routes/equipment.js.
function equipmentCategories() {
  return store.all('equipmentCategories').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function equipmentCategoryLabel(categoryId) {
  const cat = categoryId ? store.find('equipmentCategories', categoryId) : null;
  return cat ? cat.name : 'Без категории';
}

// items — любые объекты с полем categoryId (оборудование или обогащённые
// строки event.equipment) — используется и в форме планирования, и на
// странице мероприятия. Позиции без категории или с удалённой категорией
// попадают в группу «Без категории» последней.
function groupEquipmentByCategory(items, categoryOf) {
  const getCategory = categoryOf || ((item) => item.categoryId);
  const categories = equipmentCategories();
  const buckets = new Map();
  const uncategorized = [];
  items.forEach((item) => {
    const catId = getCategory(item);
    const cat = catId ? categories.find((c) => c.id === catId) : null;
    if (!cat) {
      uncategorized.push(item);
      return;
    }
    if (!buckets.has(cat.id)) buckets.set(cat.id, { key: cat.id, label: cat.name, items: [] });
    buckets.get(cat.id).items.push(item);
  });
  const result = categories.filter((c) => buckets.has(c.id)).map((c) => buckets.get(c.id));
  if (uncategorized.length) result.push({ key: 'none', label: 'Без категории', items: uncategorized });
  return result;
}

function achievementMetricValue(userId, achievement) {
  const rule = AUTO_RULES[achievement.autoRuleType];
  return rule ? rule.metric(userId) : null;
}

// Индекс наивысшего уровня, порогу которого уже соответствует метрика (-1, если ни один)
function qualifyingLevelIndex(achievement, metricValue) {
  if (metricValue === null || metricValue === undefined) return -1;
  let idx = -1;
  (achievement.levels || []).forEach((lvl, i) => {
    if (lvl.threshold !== null && lvl.threshold !== undefined && metricValue >= lvl.threshold) idx = i;
  });
  return idx;
}

// вызывается после начисления баллов / закрытия смены / смены должностей.
// Новая ачивка выдаётся на наивысший уже пройденный уровень; существующая —
// повышается (level апгрейдится), если пройден более высокий уровень.
function evaluateAutoAchievements(userId) {
  const existingByAchievement = new Map(
    store.where('userAchievements', (ua) => ua.userId === Number(userId)).map((ua) => [ua.achievementId, ua])
  );
  const results = [];
  store
    .all('achievements')
    .filter((a) => a.autoRuleType && AUTO_RULES[a.autoRuleType])
    .forEach((a) => {
      const qualIdx = qualifyingLevelIndex(a, achievementMetricValue(userId, a));
      if (qualIdx < 0) return;
      const current = existingByAchievement.get(a.id);
      const ruleLabel = AUTO_RULES[a.autoRuleType].label.toLowerCase();
      if (!current) {
        const record = store.insert('userAchievements', {
          userId: Number(userId),
          achievementId: a.id,
          level: qualIdx,
          awardedBy: null,
          awardedAt: new Date().toISOString(),
          comment: `Автоматически: ${ruleLabel} ≥ ${a.levels[qualIdx].threshold}`,
        });
        results.push(Object.assign({}, record, { achievement: a, kind: 'new' }));
      } else if (qualIdx > (current.level || 0)) {
        store.update('userAchievements', current.id, {
          level: qualIdx,
          awardedAt: new Date().toISOString(),
          comment: `Автоматически повышено: ${ruleLabel} ≥ ${a.levels[qualIdx].threshold}`,
        });
        results.push(Object.assign({}, store.find('userAchievements', current.id), { achievement: a, kind: 'upgrade' }));
      }
    });
  return results;
}

// начисление/повышение задним числом при создании новой ачивки с автоправилом
function evaluateAchievementForAllUsers(achievement) {
  if (!achievement.autoRuleType || !AUTO_RULES[achievement.autoRuleType]) return [];
  const results = [];
  store.all('users').forEach((u) => {
    const qualIdx = qualifyingLevelIndex(achievement, achievementMetricValue(u.id, achievement));
    if (qualIdx < 0) return;
    const current = store.where('userAchievements', (ua) => ua.userId === u.id && ua.achievementId === achievement.id)[0];
    if (!current) {
      results.push(store.insert('userAchievements', {
        userId: u.id,
        achievementId: achievement.id,
        level: qualIdx,
        awardedBy: null,
        awardedAt: new Date().toISOString(),
        comment: `Автоматически: ${AUTO_RULES[achievement.autoRuleType].label.toLowerCase()} ≥ ${achievement.levels[qualIdx].threshold}`,
      }));
    } else if (qualIdx > (current.level || 0)) {
      store.update('userAchievements', current.id, { level: qualIdx, awardedAt: new Date().toISOString() });
      results.push(store.find('userAchievements', current.id));
    }
  });
  return results;
}

function userAchievements(userId) {
  return store
    .where('userAchievements', (ua) => ua.userId === Number(userId))
    .map((ua) => {
      const achievement = store.find('achievements', ua.achievementId);
      if (!achievement) return null;
      const levelIndex = Math.min(ua.level || 0, achievement.levels.length - 1);
      return Object.assign({}, ua, {
        achievement,
        levelIndex,
        levelData: achievement.levels[levelIndex],
        isMaxLevel: levelIndex === achievement.levels.length - 1,
      });
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt));
}

function userBadges(userId) {
  return store
    .where('userBadges', (b) => b.userId === Number(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Лучшие ачивки пользователя (по редкости, затем по дате) — для «доски
// достижений» в шапке профиля: самое ценное на виду, а не просто всё подряд.
function topAchievements(userId, limit) {
  return userAchievements(userId)
    .sort((a, b) => {
      const rarityDiff = RARITY_ORDER.indexOf(b.levelData.rarity) - RARITY_ORDER.indexOf(a.levelData.rarity);
      return rarityDiff || new Date(b.awardedAt) - new Date(a.awardedAt);
    })
    .slice(0, limit || 6);
}

// Ачивки с автоправилом, которые пользователь ещё не выбил на максимум —
// для блока "в процессе" в профиле: сколько набрано и сколько нужно дальше.
function achievementProgress(userId) {
  const owned = new Map(
    store.where('userAchievements', (ua) => ua.userId === Number(userId)).map((ua) => [ua.achievementId, ua.level || 0])
  );
  return store
    .all('achievements')
    .filter((a) => a.autoRuleType && AUTO_RULES[a.autoRuleType])
    .map((a) => {
      const currentLevel = owned.has(a.id) ? owned.get(a.id) : -1;
      if (currentLevel >= a.levels.length - 1) return null;
      const nextLevel = a.levels[currentLevel + 1];
      const metric = achievementMetricValue(userId, a);
      const prevThreshold = currentLevel >= 0 ? a.levels[currentLevel].threshold : 0;
      const span = nextLevel.threshold - prevThreshold;
      const gained = metric - prevThreshold;
      return {
        achievement: a,
        currentLevel,
        nextLevelIndex: currentLevel + 1,
        nextLevel,
        metric,
        percent: span > 0 ? Math.max(0, Math.min(100, Math.round((gained / span) * 100))) : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.percent - a.percent);
}

function userPositions(userId) {
  const user = store.find('users', userId);
  if (!user) return [];
  return (user.positionIds || []).map((id) => store.find('positions', id)).filter(Boolean);
}

function userSignups(userId) {
  return store
    .where('eventSignups', (s) => s.userId === Number(userId))
    .map((s) => Object.assign({}, s, {
      event: store.find('events', s.eventId),
      position: store.find('positions', s.positionId),
    }))
    .filter((s) => s.event)
    .sort((a, b) => new Date(b.event.startsAt) - new Date(a.event.startsAt));
}

// Лекции Академии, к которым пользователь причастен — либо записался
// (academySignups), либо ему уже начислены баллы (pointsLog), даже если
// саму запись он не оформлял (баллы мог начислить куратор вручную).
function userAcademies(userId) {
  const uid = Number(userId);
  const signedIds = new Set(store.where('academySignups', (s) => s.userId === uid).map((s) => s.academyId));
  const pointsByAcademy = new Map();
  store.where('pointsLog', (p) => p.userId === uid && p.academyId).forEach((p) => {
    pointsByAcademy.set(p.academyId, (pointsByAcademy.get(p.academyId) || 0) + p.amount);
  });
  const allIds = new Set([...signedIds, ...pointsByAcademy.keys()]);
  return Array.from(allIds)
    .map((id) => {
      const academy = store.find('academies', id);
      if (!academy) return null;
      return {
        academy,
        signedUp: signedIds.has(id),
        pointsAwarded: pointsByAcademy.has(id) ? pointsByAcademy.get(id) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.academy.startsAt) - new Date(a.academy.startsAt));
}

function leaderboard(range, options) {
  const includeRoles = options && options.includeRoles;
  return store
    .all('users')
    .filter((u) => !includeRoles || includeRoles.includes(u.role))
    .map((u) => ({
      user: u,
      points: userPoints(u.id, range),
      achievementsCount: store.where(
        'userAchievements',
        (ua) => ua.userId === u.id && inRange(ua.awardedAt, range)
      ).length,
      completedEvents: store.where(
        'eventSignups',
        (s) => s.userId === u.id && s.status === 'done' && inRange(s.respondedAt, range)
      ).length,
    }))
    .sort((a, b) => b.points - a.points || a.user.fullName.localeCompare(b.user.fullName, 'ru'));
}

function eventRequirementStatus(event) {
  return (event.requiredPositions || []).map((req) => {
    const position = store.find('positions', req.positionId);
    const signups = store.where(
      'eventSignups',
      (s) => s.eventId === event.id && s.positionId === req.positionId
    );
    const approved = signups.filter((s) => s.status === 'approved' || s.status === 'done');
    const pending = signups.filter((s) => s.status === 'pending');
    return {
      position,
      needed: req.count,
      approvedCount: approved.length,
      approved: approved.map((s) => Object.assign({}, s, { user: store.find('users', s.userId) })),
      pending: pending.map((s) => Object.assign({}, s, { user: store.find('users', s.userId) })),
      isFull: approved.length >= req.count,
    };
  });
}

// Админ добавляет мероприятие, а курирует (правит, разбирает заявки,
// закрывает смены) — либо сам админ, либо назначенный на это мероприятие
// технический директор. Другие тех.директора доступа не получают.
function canManageEvent(user, event) {
  if (!user || !event) return false;
  if (user.role === 'admin') return true;
  return user.role === 'tech_director' && event.techDirectorId === user.id;
}

function eventWithDetails(event) {
  if (!event) return null;
  const allSignups = store
    .where('eventSignups', (s) => s.eventId === event.id)
    .map((s) => Object.assign({}, s, {
      user: store.find('users', s.userId),
      position: store.find('positions', s.positionId),
    }));
  return Object.assign({}, event, {
    venue: store.find('venues', event.venueId),
    creator: store.find('users', event.createdBy),
    techDirector: event.techDirectorId ? store.find('users', event.techDirectorId) : null,
    requirements: eventRequirementStatus(event),
    equipment: (event.equipment || [])
      .map((row) => {
        const item = store.find('equipment', row.equipmentId);
        return item
          ? Object.assign({}, item, { allocatedQuantity: row.quantity, transit: transitStatus(row) })
          : null;
      })
      .filter(Boolean),
    cases: (event.cases || [])
      .map((row) => {
        const c = store.find('cases', row.caseId);
        if (!c) return null;
        return Object.assign({}, c, caseContentsInfo(c, row.items), {
          transit: transitStatus(row),
          allocations: caseAllocations(c.id),
        });
      })
      .filter(Boolean),
    allSignups,
    headcount: eventHeadcountSeries(event, allSignups),
    chatMessages: eventChatMessages(event.id),
  });
}

// Участник указывает при отклике (или позже правит), когда он реально будет
// на площадке — arrivesAt/departsAt. Если не указано, считаем «всё мероприятие»
// (от startsAt до endsAt). Используется и для графика явки, и для показа
// менеджеру при разборе заявок.
function signupWindow(signup, event) {
  const start = signup.arrivesAt ? new Date(signup.arrivesAt).getTime() : new Date(event.startsAt).getTime();
  const end = signup.departsAt ? new Date(signup.departsAt).getTime() : new Date(event.endsAt).getTime();
  return { start, end };
}

// Столбчатая гистограмма «сколько подтверждённых участников на площадке»
// по времени мероприятия. Размер «столбика» подбирается по длительности
// мероприятия, чтобы не рисовать сотни часовых баров на недельном фестивале.
function eventHeadcountSeries(event, allSignups) {
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  if (!(end > start)) return { buckets: [], max: 0 };

  const durationHours = (end - start) / 3600000;
  let bucketHours;
  if (durationHours <= 12) bucketHours = 1;
  else if (durationHours <= 48) bucketHours = 2;
  else if (durationHours <= 24 * 7) bucketHours = 12;
  else bucketHours = 24;
  const bucketMs = bucketHours * 3600000;
  const numBuckets = Math.min(40, Math.ceil((end - start) / bucketMs));

  const confirmed = (allSignups || store.where('eventSignups', (s) => s.eventId === event.id))
    .filter((s) => s.status === 'approved' || s.status === 'done')
    .map((s) => signupWindow(s, event));

  let max = 0;
  const buckets = [];
  for (let i = 0; i < numBuckets; i += 1) {
    const bucketStart = start + i * bucketMs;
    const bucketEnd = Math.min(bucketStart + bucketMs, end);
    const count = confirmed.filter((w) => w.start < bucketEnd && w.end > bucketStart).length;
    if (count > max) max = count;
    buckets.push({ start: bucketStart, end: bucketEnd, count, bucketHours });
  }
  return { buckets, max, bucketHours };
}

// Чат мероприятия — простая хронологическая лента сообщений без вложений.
function eventChatMessages(eventId) {
  return store
    .where('eventMessages', (m) => m.eventId === Number(eventId))
    .map((m) => Object.assign({}, m, { user: store.find('users', m.userId) }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

const EQUIPMENT_STATUS_ORDER = ['available', 'in_use', 'maintenance', 'broken', 'missing'];
const EQUIPMENT_STATUS_LABELS = {
  available: 'Доступно',
  in_use: 'Занято',
  maintenance: 'На обслуживании',
  broken: 'Неисправно',
  missing: 'Утеряно',
  // Эти два значения не входят в EQUIPMENT_STATUS_ORDER и не хранятся в
  // позиции — только подписи для производного displayStatus (см. ниже):
  // настоящий статус остаётся «available», а «на мероприятии» вычисляется
  // по тому, собрано/уехало ли оно сейчас, а не по ручной отметке.
  at_event: 'На мероприятии',
  partially_at_event: 'Частично на мероприятии',
};

// Статус перемещения конкретной позиции/кейса на мероприятии (не статус
// самого оборудования в каталоге): «ожидает» — просто запланировано, позиция
// физически ещё в общем доступе; «собрано» — реально вынули и отложили под
// это мероприятие (с этого момента и считается занятой «на складе»); «в
// пути» — отметили как уехавшее; «вернулось» — отметили как приехавшее обратно.
const TRANSIT_LABELS = {
  pending: 'Запланировано',
  confirmed: 'Собрано',
  departed: 'В пути',
  returned: 'Вернулось',
};

function transitStatus(row) {
  if (row.returnedAt) return 'returned';
  if (row.departedAt) return 'departed';
  if (row.confirmedAt) return 'confirmed';
  return 'pending';
}

// «Держит» ли эта строка позицию физически прямо сейчас (вынута под сборку
// или уже уехала, но ещё не вернулась) — именно это, а не факт попадания в
// план мероприятия, должно уменьшать «на складе»: мероприятие может быть
// через неделю, и до момента сборки позиция свободно лежит на складе.
function isHeld(row) {
  return Boolean(row.confirmedAt) && !row.returnedAt;
}

// Если к моменту закрытия/отмены мероприятия позиция отмечена «уехала», но
// не «вернулась» — это и есть потеря: автоматически переводим её статус в
// «Утеряно», чтобы это не потерялось среди обычных «доступно» в каталоге.
function flagUnreturnedAsMissing(equipmentRows, caseRows) {
  const flagged = [];
  (equipmentRows || []).forEach((row) => {
    if (row.departedAt && !row.returnedAt) {
      const item = store.find('equipment', row.equipmentId);
      if (item && item.status !== 'missing') {
        store.update('equipment', item.id, { status: 'missing' });
        flagged.push(item.name);
      }
    }
  });
  (caseRows || []).forEach((row) => {
    if (row.departedAt && !row.returnedAt) {
      const item = store.find('cases', row.caseId);
      if (item && item.status !== 'missing') {
        store.update('cases', item.id, { status: 'missing' });
        flagged.push(item.name);
      }
    }
  });
  return flagged;
}

// Кейс — физический контейнер (рэк, «гроб» на колёсах и т.п.), в который
// заранее упаковано конкретное оборудование. В отличие от оборудования
// (расходуемое количество), кейс — единственный физический объект: он либо
// целиком едет на мероприятие, либо нет, поэтому резерв — да/нет, а не число.
const CASE_TYPE_ORDER = ['rack', 'road_case', 'mini_case', 'bag'];
const CASE_TYPE_LABELS = {
  rack: 'Рэк',
  road_case: 'Гроб',
  mini_case: 'Мини-кейс',
  bag: 'Чехол',
};

// Пересекаются ли два периода (мероприятия бронируют оборудование только
// на свои даты — не бронируют его «навсегда», как только получали статус planned).
function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

// Запланированное мероприятие, которое держит этот кейс (кроме excludeEventId
// — самого редактируемого, чтобы его же резерв не мешал ему самому
// пересохраниться). dateRange — {startsAt, endsAt} планируемого мероприятия:
// если передан, конфликтом считается только пересечение по датам, а не любое
// другое запланированное мероприятие вообще (кейс может быть свободен на эти
// даты, даже если занят на какие-то другие).
function caseCurrentEvent(caseId, excludeEventId, dateRange) {
  return (
    store.all('events').find(
      (e) =>
        e.status === 'planned' &&
        e.id !== excludeEventId &&
        (e.cases || []).some((r) => r.caseId === caseId) &&
        (!dateRange || datesOverlap(dateRange.startsAt, dateRange.endsAt, e.startsAt, e.endsAt))
    ) || null
  );
}

// Все запланированные мероприятия, которые когда-либо держат этот кейс —
// для отображения «уже забронировано на такие-то даты» (в отличие от
// caseCurrentEvent, без учёта конкретного диапазона дат).
function caseAllocations(caseId) {
  return store.all('events').filter((e) => e.status === 'planned' && (e.cases || []).some((r) => r.caseId === caseId));
}

function isCaseAvailable(caseItem, excludeEventId, dateRange) {
  return caseItem.status === 'available' && !caseCurrentEvent(caseItem.id, excludeEventId, dateRange);
}

// Мероприятие, которое ФИЗИЧЕСКИ держит этот кейс прямо сейчас (состав
// подтверждён как собранный и кейс ещё не вернулся) — в отличие от
// caseCurrentEvent, которая считает занятым кейс сразу при планировании,
// даже если до сборки ещё далеко.
function caseHeldEvent(caseId) {
  return (
    store.all('events').find((e) => {
      if (e.status !== 'planned') return false;
      const row = (e.cases || []).find((r) => r.caseId === caseId);
      return Boolean(row) && isHeld(row);
    }) || null
  );
}

// Кейс сам по себе — просто физический контейнер (рэк, «гроб» и т.п.) без
// фиксированного состава: что в него упаковано — свойство не кейса, а его
// привязки к конкретному мероприятию (event.cases[].items), см. caseContentsInfo.
// Так один и тот же кейс может иметь разное наполнение на разных датах.
function resolveItemRows(rawItems) {
  return (rawItems || [])
    .map((row) => {
      const item = store.find('equipment', row.equipmentId);
      return item ? { item, quantity: row.quantity } : null;
    })
    .filter(Boolean);
}

// Рэковые кейсы и рэковое оборудование измеряются в юнитах (U), а не в литрах
// — вместимость кейса (capacity) для type === 'rack' интерпретируется как U
// (сумма item.rackUnits * quantity), для остальных типов — как литры объёма.
// rawItems — состав ИМЕННО для конкретной привязки (каталожной формы «кейс
// вообще» не существует — только «кейс на мероприятии X»).
function caseContentsInfo(caseItem, rawItems) {
  const items = resolveItemRows(rawItems);
  const isRack = caseItem.type === 'rack';
  const contentsVolume = items.reduce((sum, r) => sum + (r.item.volume || 0) * r.quantity, 0);
  const contentsUnits = items.reduce((sum, r) => sum + (r.item.rackUnits || 0) * r.quantity, 0);
  const contentsWeight = items.reduce((sum, r) => sum + (r.item.weight || 0) * r.quantity, 0);
  const capacityUsed = isRack ? contentsUnits : contentsVolume;
  return {
    items,
    contentsVolume,
    contentsUnits,
    contentsWeight,
    capacityUsed,
    capacityUnit: isRack ? 'U' : 'л',
    totalWeight: (caseItem.weight || 0) + contentsWeight,
    overCapacity: caseItem.capacity != null && capacityUsed > caseItem.capacity,
  };
}

// Каталожная карточка кейса — статус/доступность и, если он реально собран
// (а не просто запланирован) под какое-то мероприятие прямо сейчас, состав
// этой привязки — чтобы на странице «Кейсы» было видно, что в нём едет на
// самом деле, а не что на него просто есть план на будущее. Сам кейс в
// каталоге — всегда «пустой контейнер».
function caseWithAvailability(caseItem, excludeEventId, dateRange) {
  const heldEvent = caseHeldEvent(caseItem.id);
  // conflictEvent — не то же самое, что heldEvent: это чей-то план (собранный
  // или не собранный) на пересекающиеся даты — именно он блокирует выбор
  // кейса при сборке другого комплекта, см. available ниже.
  const conflictEvent = caseCurrentEvent(caseItem.id, excludeEventId, dateRange);
  let currentContents = null;
  if (heldEvent) {
    const row = (heldEvent.cases || []).find((r) => r.caseId === caseItem.id);
    currentContents = caseContentsInfo(caseItem, row ? row.items : []);
  }
  return Object.assign({}, caseItem, {
    currentEvent: heldEvent,
    conflictEvent,
    currentContents,
    allocations: caseAllocations(caseItem.id),
    available: caseItem.status === 'available' && !conflictEvent,
  });
}

// Сколько единиц этого оборудования выделено на мероприятия, пересекающиеся
// по датам с dateRange (если не передан — на все запланированные мероприятия
// вообще, для общего снимка на странице каталога) — напрямую (event.equipment)
// либо спрятано внутри одного из назначенных мероприятию кейсов (event.cases).
// Завершённые/отменённые мероприятия резерв не держат. excludeEventId — само
// редактируемое мероприятие: его текущее резервирование не в счёт.
function equipmentAllocatedQuantity(equipmentId, excludeEventId, dateRange) {
  return store
    .all('events')
    .filter((e) => e.status === 'planned' && e.id !== excludeEventId)
    .filter((e) => !dateRange || datesOverlap(dateRange.startsAt, dateRange.endsAt, e.startsAt, e.endsAt))
    .reduce((sum, e) => {
      let total = sum;
      const direct = (e.equipment || []).find((r) => r.equipmentId === equipmentId);
      if (direct) total += direct.quantity;
      (e.cases || []).forEach((caseRow) => {
        const row = (caseRow.items || []).find((r) => r.equipmentId === equipmentId);
        if (row) total += row.quantity;
      });
      return total;
    }, 0);
}

// Сколько единиц можно ещё выделить («на складе») на даты dateRange.
// На обслуживании/неисправно/утеряно — 0 независимо от дат.
function equipmentAvailableQuantity(item, excludeEventId, dateRange) {
  if (item.status !== 'available') return 0;
  return Math.max(0, item.quantity - equipmentAllocatedQuantity(item.id, excludeEventId, dateRange));
}

// Мероприятия, которые когда-либо держат часть оборудования item.id —
// напрямую или через один из назначенных им кейсов (via — название кейса,
// если так; held — реально собрано под это мероприятие прямо сейчас, а не
// просто запланировано). Без учёта дат — показывает полный календарь занятости позиции.
function equipmentAllocations(equipmentId) {
  const result = [];
  store
    .all('events')
    .filter((e) => e.status === 'planned')
    .forEach((e) => {
      const direct = (e.equipment || []).find((r) => r.equipmentId === equipmentId);
      if (direct) result.push({ event: e, quantity: direct.quantity, via: null, held: isHeld(direct) });
      (e.cases || []).forEach((caseRow) => {
        const row = (caseRow.items || []).find((r) => r.equipmentId === equipmentId);
        if (row) {
          const caseItem = store.find('cases', caseRow.caseId);
          result.push({ event: e, quantity: row.quantity, via: caseItem ? caseItem.name : null, held: isHeld(caseRow) });
        }
      });
    });
  return result;
}

// Сколько единиц этой позиции реально вынуто и отложено под мероприятия
// прямо сейчас (собрано, но ещё не вернулось) — именно это число, а не сумма
// всех планов, должно уменьшать «на складе» в каталоге.
function equipmentHeldQuantity(equipmentId) {
  return equipmentAllocations(equipmentId)
    .filter((a) => a.held)
    .reduce((sum, a) => sum + a.quantity, 0);
}

// Статус для показа (верхний правый бейдж на карточке/карточке товара) —
// в отличие от item.status (ручное поле: обслуживание/неисправно/утеряно/
// занято вручную), здесь же учитывается физическое наличие на складе: если
// статус «доступно», но всё или часть собрано/уехало под мероприятие,
// показываем это, а не формальное «доступно». Ручные статусы (не available)
// важнее — их не затирает производный расчёт.
function equipmentDisplayStatus(item, heldTotal) {
  if (item.status !== 'available') return item.status;
  if (heldTotal <= 0) return 'available';
  if (heldTotal >= item.quantity) return 'at_event';
  return 'partially_at_event';
}

function equipmentWithStock(item) {
  const allocations = equipmentAllocations(item.id);
  const allocatedTotal = allocations.reduce((sum, a) => sum + a.quantity, 0);
  const heldTotal = allocations.filter((a) => a.held).reduce((sum, a) => sum + a.quantity, 0);
  return Object.assign({}, item, {
    allocations,
    allocatedTotal,
    heldTotal,
    displayStatus: equipmentDisplayStatus(item, heldTotal),
    availableQuantity: item.status === 'available' ? Math.max(0, item.quantity - heldTotal) : 0,
  });
}

function totalNeeded(event) {
  return (event.requiredPositions || []).reduce((sum, r) => sum + r.count, 0);
}

function totalFilled(event) {
  return eventRequirementStatus(event).reduce((sum, r) => sum + r.approvedCount, 0);
}

module.exports = {
  userPoints,
  userPointsHistory,
  userEventsCompletedCount,
  userAcademiesAttendedCount,
  userAchievements,
  userBadges,
  topAchievements,
  userPositions,
  userSignups,
  userAcademies,
  leaderboard,
  activeSeason,
  eventRequirementStatus,
  eventWithDetails,
  canManageEvent,
  totalNeeded,
  totalFilled,
  AUTO_RULES,
  RARITY_ORDER,
  RARITY_LABELS,
  POSITION_CATEGORY_ORDER,
  POSITION_CATEGORY_LABELS,
  groupPositionsByCategory,
  equipmentCategories,
  equipmentCategoryLabel,
  groupEquipmentByCategory,
  ACADEMY_TOPICS,
  achievementMetricValue,
  qualifyingLevelIndex,
  evaluateAutoAchievements,
  evaluateAchievementForAllUsers,
  achievementProgress,
  EQUIPMENT_STATUS_ORDER,
  EQUIPMENT_STATUS_LABELS,
  equipmentAllocatedQuantity,
  equipmentAvailableQuantity,
  equipmentAllocations,
  equipmentHeldQuantity,
  equipmentWithStock,
  isHeld,
  CASE_TYPE_ORDER,
  CASE_TYPE_LABELS,
  caseCurrentEvent,
  caseHeldEvent,
  caseAllocations,
  isCaseAvailable,
  caseContentsInfo,
  caseWithAvailability,
  TRANSIT_LABELS,
  transitStatus,
  flagUnreturnedAsMissing,
  signupWindow,
  eventHeadcountSeries,
  eventChatMessages,
};
