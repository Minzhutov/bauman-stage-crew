'use strict';
const store = require('./store');

function userPoints(userId) {
  return store
    .where('pointsLog', (p) => p.userId === Number(userId))
    .reduce((sum, p) => sum + p.amount, 0);
}

function userPointsHistory(userId) {
  return store
    .where('pointsLog', (p) => p.userId === Number(userId))
    .map((p) => Object.assign({}, p, {
      event: p.eventId ? store.find('events', p.eventId) : null,
      academy: p.academyId ? store.find('academies', p.academyId) : null,
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

function achievementMetricValue(userId, achievement) {
  const rule = AUTO_RULES[achievement.autoRuleType];
  return rule ? rule.metric(userId) : null;
}

// вызывается после начисления баллов / закрытия смены / смены должностей;
// отозванная вручную ачивка может выдаться заново, если условие ещё верно
function evaluateAutoAchievements(userId) {
  const already = new Set(store.where('userAchievements', (ua) => ua.userId === Number(userId)).map((ua) => ua.achievementId));
  const newlyAwarded = [];
  store
    .all('achievements')
    .filter((a) => a.autoRuleType && AUTO_RULES[a.autoRuleType] && !already.has(a.id))
    .forEach((a) => {
      const current = achievementMetricValue(userId, a);
      if (current >= a.autoRuleThreshold) {
        const record = store.insert('userAchievements', {
          userId: Number(userId),
          achievementId: a.id,
          awardedBy: null,
          awardedAt: new Date().toISOString(),
          comment: `Автоматически: ${AUTO_RULES[a.autoRuleType].label.toLowerCase()} ≥ ${a.autoRuleThreshold}`,
        });
        newlyAwarded.push(Object.assign({}, record, { achievement: a }));
      }
    });
  return newlyAwarded;
}

// начисление задним числом при создании новой ачивки с автоправилом
function evaluateAchievementForAllUsers(achievement) {
  if (!achievement.autoRuleType || !AUTO_RULES[achievement.autoRuleType]) return [];
  const awarded = [];
  store.all('users').forEach((u) => {
    const already = store.where(
      'userAchievements',
      (ua) => ua.userId === u.id && ua.achievementId === achievement.id
    ).length > 0;
    if (already) return;
    const current = achievementMetricValue(u.id, achievement);
    if (current >= achievement.autoRuleThreshold) {
      const record = store.insert('userAchievements', {
        userId: u.id,
        achievementId: achievement.id,
        awardedBy: null,
        awardedAt: new Date().toISOString(),
        comment: `Автоматически: ${AUTO_RULES[achievement.autoRuleType].label.toLowerCase()} ≥ ${achievement.autoRuleThreshold}`,
      });
      awarded.push(record);
    }
  });
  return awarded;
}

function userAchievements(userId) {
  return store
    .where('userAchievements', (ua) => ua.userId === Number(userId))
    .map((ua) => Object.assign({}, ua, { achievement: store.find('achievements', ua.achievementId) }))
    .filter((ua) => ua.achievement)
    .sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt));
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

function leaderboard() {
  return store
    .all('users')
    .map((u) => ({
      user: u,
      points: userPoints(u.id),
      achievementsCount: userAchievements(u.id).length,
      completedEvents: store.where(
        'eventSignups',
        (s) => s.userId === u.id && s.status === 'done'
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

function eventWithDetails(event) {
  if (!event) return null;
  return Object.assign({}, event, {
    venue: store.find('venues', event.venueId),
    creator: store.find('users', event.createdBy),
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
  userPositions,
  userSignups,
  leaderboard,
  eventRequirementStatus,
  eventWithDetails,
  totalNeeded,
  totalFilled,
  AUTO_RULES,
  achievementMetricValue,
  evaluateAutoAchievements,
  evaluateAchievementForAllUsers,
};
