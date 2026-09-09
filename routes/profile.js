'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireAdmin, requireStaff, isStaff } = require('../lib/auth');
const { imageUpload } = require('../lib/uploads');
const { renderEventsPdf } = require('../lib/pdf');
const format = require('../lib/format');

const router = express.Router();

const AVATAR_DIR = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
const avatarUpload = imageUpload(AVATAR_DIR, { maxSizeMB: 3 });

const BADGE_DIR = path.join(__dirname, '..', 'public', 'uploads', 'badges');
const badgeUpload = imageUpload(BADGE_DIR, { maxSizeMB: 8 });

function canManage(req, user) {
  return req.currentUser.id === user.id || req.currentUser.role === 'admin';
}

function parseTelegram(raw) {
  const trimmed = (raw || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
  return trimmed;
}

router.get('/', requireAuth, (req, res) => {
  res.redirect(`/profile/${req.currentUser.id}`);
});

function loadProfileData(userId) {
  const user = store.find('users', userId);
  if (!user) return null;
  return {
    user,
    points: domain.userPoints(user.id),
    pointsHistory: domain.userPointsHistory(user.id),
    positions: domain.userPositions(user.id),
    achievements: domain.userAchievements(user.id),
    topAchievements: domain.topAchievements(user.id, 6),
    achievementProgress: domain.achievementProgress(user.id),
    signups: domain.userSignups(user.id),
    academies: domain.userAcademies(user.id),
    badges: domain.userBadges(user.id),
    stats: {
      eventsCompleted: domain.userEventsCompletedCount(user.id),
      academiesAttended: domain.userAcademiesAttendedCount(user.id),
    },
  };
}

router.get('/:id', requireAuth, (req, res) => {
  const data = loadProfileData(req.params.id);
  if (!data) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  const isOwner = req.currentUser.id === data.user.id;
  const isAdmin = req.currentUser.role === 'admin';
  const staff = isStaff(req.currentUser);
  res.render('profile/show', {
    title: data.user.fullName,
    profile: data,
    isOwner,
    isAdmin,
    isStaff: staff,
    allPositions: store.all('positions'),
    allAchievements: store.all('achievements'),
  });
});

router.get('/:id/events.pdf', requireAuth, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  const rows = domain.userSignups(user.id).map((s) => {
    const venue = s.event.venueId ? store.find('venues', s.event.venueId) : null;
    return {
      date: format.formatDate(s.event.startsAt),
      title: s.event.title,
      venue: venue ? venue.name : '',
      position: s.position ? s.position.name : '',
    };
  });
  renderEventsPdf(res, { user, rows });
});

router.put('/:id', requireAuth, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  const isOwner = req.currentUser.id === user.id;
  const isAdmin = req.currentUser.role === 'admin';
  if (!isOwner && !isAdmin) {
    req.flash('error', 'Недостаточно прав.');
    return res.redirect('/leaderboard');
  }
  const { fullName, phone, studyGroup, bio, telegram } = req.body;
  if (!fullName || !fullName.trim()) {
    req.flash('error', 'Имя не может быть пустым.');
    return res.redirect(`/profile/${user.id}`);
  }
  if (!studyGroup || !studyGroup.trim()) {
    req.flash('error', 'Учебная группа не может быть пустой.');
    return res.redirect(`/profile/${user.id}`);
  }
  store.update('users', user.id, {
    fullName: fullName.trim(),
    phone: (phone || '').trim(),
    studyGroup: studyGroup.trim(),
    bio: (bio || '').trim(),
    telegram: parseTelegram(telegram),
  });
  req.flash('success', 'Контактные данные обновлены.');
  res.redirect(`/profile/${user.id}`);
});

router.post('/:id/avatar', requireAuth, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  if (!canManage(req, user)) {
    req.flash('error', 'Недостаточно прав.');
    return res.redirect('/leaderboard');
  }
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить аватар.');
      return res.redirect(`/profile/${user.id}`);
    }
    if (!req.file) {
      req.flash('error', 'Выберите файл изображения.');
      return res.redirect(`/profile/${user.id}`);
    }
    if (user.avatarFile) {
      fs.unlink(path.join(AVATAR_DIR, user.avatarFile), () => {});
    }
    store.update('users', user.id, { avatarFile: req.file.filename });
    req.flash('success', 'Аватар обновлён.');
    res.redirect(`/profile/${user.id}`);
  });
});

router.delete('/:id/avatar', requireAuth, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  if (!canManage(req, user)) {
    req.flash('error', 'Недостаточно прав.');
    return res.redirect('/leaderboard');
  }
  if (user.avatarFile) {
    fs.unlink(path.join(AVATAR_DIR, user.avatarFile), () => {});
    store.update('users', user.id, { avatarFile: null });
    req.flash('success', 'Аватар удалён.');
  }
  res.redirect(`/profile/${user.id}`);
});

router.post('/:id/badges', requireAuth, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  if (!canManage(req, user)) {
    req.flash('error', 'Недостаточно прав.');
    return res.redirect('/leaderboard');
  }
  badgeUpload.single('badge')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить бейдж.');
      return res.redirect(`/profile/${user.id}`);
    }
    if (!req.file) {
      req.flash('error', 'Выберите файл — фото бейджа или вырезку из PDF.');
      return res.redirect(`/profile/${user.id}`);
    }
    store.insert('userBadges', {
      userId: user.id,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      title: (req.body.title || '').trim(),
      uploadedBy: req.currentUser.id,
      createdAt: new Date().toISOString(),
    });
    req.flash('success', 'Бейдж добавлен.');
    res.redirect(`/profile/${user.id}`);
  });
});

router.delete('/:id/badges/:badgeId', requireAuth, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  if (!canManage(req, user)) {
    req.flash('error', 'Недостаточно прав.');
    return res.redirect('/leaderboard');
  }
  const badge = store.find('userBadges', req.params.badgeId);
  if (badge && badge.userId === user.id) {
    fs.unlink(path.join(BADGE_DIR, badge.fileName), () => {});
    store.remove('userBadges', badge.id);
    req.flash('success', 'Бейдж удалён.');
  }
  res.redirect(`/profile/${user.id}`);
});

// --- Админ-действия над профилем ---

router.post('/:id/points', requireAuth, requireStaff, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  const amount = parseInt(req.body.amount, 10);
  const reason = (req.body.reason || '').trim();
  if (!Number.isFinite(amount) || amount === 0) {
    req.flash('error', 'Укажите ненулевое количество баллов.');
    return res.redirect(`/profile/${user.id}`);
  }
  if (!reason) {
    req.flash('error', 'Укажите причину начисления.');
    return res.redirect(`/profile/${user.id}`);
  }
  store.insert('pointsLog', {
    userId: user.id,
    amount,
    reason,
    eventId: null,
    academyId: null,
    awardedBy: req.currentUser.id,
    awardedAt: new Date().toISOString(),
  });
  const newAchievements = domain.evaluateAutoAchievements(user.id);
  let extra = '';
  if (newAchievements.length) {
    extra = ` Автоматически выданы ачивки: ${newAchievements.map((a) => a.achievement.name).join(', ')}.`;
  }
  req.flash('success', `Начислено ${amount > 0 ? '+' : ''}${amount} баллов пользователю ${user.fullName}.${extra}`);
  res.redirect(`/profile/${user.id}`);
});

router.post('/:id/achievements', requireAuth, requireAdmin, (req, res) => {
  const user = store.find('users', req.params.id);
  const achievement = store.find('achievements', req.body.achievementId);
  if (!user || !achievement) {
    req.flash('error', 'Пользователь или ачивка не найдены.');
    return res.redirect(`/profile/${req.params.id}`);
  }
  const levelIndex = Math.min(Math.max(parseInt(req.body.level, 10) || 0, 0), achievement.levels.length - 1);
  const existing = store.where('userAchievements', (ua) => ua.userId === user.id && ua.achievementId === achievement.id)[0];
  const comment = (req.body.comment || '').trim();
  if (existing) {
    store.update('userAchievements', existing.id, {
      level: levelIndex,
      awardedBy: req.currentUser.id,
      awardedAt: new Date().toISOString(),
      comment,
    });
  } else {
    store.insert('userAchievements', {
      userId: user.id,
      achievementId: achievement.id,
      level: levelIndex,
      awardedBy: req.currentUser.id,
      awardedAt: new Date().toISOString(),
      comment,
    });
  }
  const levelLabel = achievement.levels.length > 1 ? ` (уровень ${levelIndex + 1}: ${domain.RARITY_LABELS[achievement.levels[levelIndex].rarity]})` : '';
  req.flash('success', `Ачивка «${achievement.name}»${levelLabel} присвоена пользователю ${user.fullName}.`);
  res.redirect(`/profile/${user.id}`);
});

router.delete('/:id/achievements/:userAchievementId', requireAuth, requireAdmin, (req, res) => {
  store.remove('userAchievements', req.params.userAchievementId);
  req.flash('success', 'Ачивка отозвана.');
  res.redirect(`/profile/${req.params.id}`);
});

router.post('/:id/positions', requireAuth, requireAdmin, (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/leaderboard');
  }
  const raw = req.body.positionIds;
  const ids = Array.isArray(raw) ? raw.map(Number) : raw ? [Number(raw)] : [];
  store.update('users', user.id, { positionIds: ids });
  const newAchievements = domain.evaluateAutoAchievements(user.id);
  let extra = '';
  if (newAchievements.length) {
    extra = ` Автоматически выданы ачивки: ${newAchievements.map((a) => a.achievement.name).join(', ')}.`;
  }
  req.flash('success', `Доступные должности обновлены для ${user.fullName}.${extra}`);
  res.redirect(`/profile/${user.id}`);
});

module.exports = router;
