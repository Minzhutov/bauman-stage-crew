'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { imageUpload } = require('../lib/uploads');

const router = express.Router();

const AVATAR_DIR = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
const avatarUpload = imageUpload(AVATAR_DIR, { maxSizeMB: 3 });

function canManage(req, user) {
  return req.currentUser.id === user.id || req.currentUser.role === 'admin';
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
    signups: domain.userSignups(user.id),
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
  if (!isOwner && !isAdmin) {
    req.flash('error', 'Профиль доступен только владельцу и администраторам.');
    return res.redirect('/leaderboard');
  }
  res.render('profile/show', {
    title: data.user.fullName,
    profile: data,
    isOwner,
    isAdmin,
    allPositions: store.all('positions'),
    allAchievements: store.all('achievements'),
  });
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
  const { fullName, phone, studyGroup, bio } = req.body;
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

// --- Админ-действия над профилем ---

router.post('/:id/points', requireAuth, requireAdmin, (req, res) => {
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
  store.insert('userAchievements', {
    userId: user.id,
    achievementId: achievement.id,
    awardedBy: req.currentUser.id,
    awardedAt: new Date().toISOString(),
    comment: (req.body.comment || '').trim(),
  });
  req.flash('success', `Ачивка «${achievement.name}» присвоена пользователю ${user.fullName}.`);
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
