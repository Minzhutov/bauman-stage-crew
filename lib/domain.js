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
  return Object.assign({}, event, {
    venue: store.find('venues', event.venueId),
    creator: store.find('users', event.createdBy),
    techDirector: event.techDirectorId ? store.find('users', event.techDirectorId) : null,
    requirements: eventRequirementStatus(event),
    allSignups: store
      .where('eventSignups', (s) => s.eventId === event.id)
      .map((s) => Object.assign({}, s, {
        user: store.find('users', s.userId),
        position: store.find('positions', s.positionId),
      })),
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
  ACADEMY_TOPICS,
  achievementMetricValue,
  qualifyingLevelIndex,
  evaluateAutoAchievements,
  evaluateAchievementForAllUsers,
  achievementProgress,
};
