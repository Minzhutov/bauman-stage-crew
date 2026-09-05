'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { imageUpload } = require('../lib/uploads');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// --- Загрузка аватарок ачивок ---

const AVATAR_DIR = path.join(__dirname, '..', 'public', 'uploads', 'achievements');
const avatarUpload = imageUpload(AVATAR_DIR);

const AUTO_RULE_TYPES = Object.keys(domain.AUTO_RULES);

function parseAutoRule(body) {
  const type = AUTO_RULE_TYPES.includes(body.autoRuleType) ? body.autoRuleType : null;
  const threshold = parseInt(body.autoRuleThreshold, 10);
  if (!type || !Number.isFinite(threshold) || threshold < 1) {
    return { autoRuleType: null, autoRuleThreshold: null };
  }
  return { autoRuleType: type, autoRuleThreshold: threshold };
}

// --- Пользователи ---

router.get('/users', (req, res) => {
  const users = store
    .all('users')
    .map((u) => ({ user: u, points: domain.userPoints(u.id) }))
    .sort((a, b) => a.user.fullName.localeCompare(b.user.fullName, 'ru'));
  res.render('admin/users', { title: 'Пользователи' , users });
});

router.put('/users/:id/role', (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/admin/users');
  }
  const nextRole = req.body.role === 'admin' ? 'admin' : 'user';
  if (user.role === 'admin' && nextRole === 'user') {
    const adminCount = store.where('users', (u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      req.flash('error', 'Нельзя понизить последнего администратора.');
      return res.redirect('/admin/users');
    }
  }
  store.update('users', user.id, { role: nextRole });
  req.flash('success', `Роль пользователя ${user.fullName} изменена на «${nextRole === 'admin' ? 'администратор' : 'пользователь'}».`);
  res.redirect('/admin/users');
});

router.delete('/users/:id', (req, res) => {
  const user = store.find('users', req.params.id);
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect('/admin/users');
  }
  if (user.id === req.currentUser.id) {
    req.flash('error', 'Нельзя удалить собственную учётную запись.');
    return res.redirect('/admin/users');
  }
  if (user.role === 'admin') {
    const adminCount = store.where('users', (u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      req.flash('error', 'Нельзя удалить последнего администратора.');
      return res.redirect('/admin/users');
    }
  }
  store.removeWhere('eventSignups', (s) => s.userId === user.id);
  store.removeWhere('userAchievements', (ua) => ua.userId === user.id);
  store.removeWhere('pointsLog', (p) => p.userId === user.id);
  store.remove('users', user.id);
  req.flash('success', `Пользователь ${user.fullName} удалён.`);
  res.redirect('/admin/users');
});

// --- Должности (специалисты) ---

router.get('/positions', (req, res) => {
  const positions = store.all('positions').map((p) => ({
    position: p,
    usedByEvents: store.where('events', (e) => (e.requiredPositions || []).some((r) => r.positionId === p.id)).length,
    usedByUsers: store.where('users', (u) => (u.positionIds || []).includes(p.id)).length,
  }));
  res.render('admin/positions', { title: 'Должности', positions, form: {} });
});

router.post('/positions', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название должности.');
    return res.redirect('/admin/positions');
  }
  store.insert('positions', { name: name.trim(), description: (description || '').trim() });
  req.flash('success', 'Должность добавлена в каталог.');
  res.redirect('/admin/positions');
});

router.delete('/positions/:id', (req, res) => {
  const position = store.find('positions', req.params.id);
  if (!position) {
    req.flash('error', 'Должность не найдена.');
    return res.redirect('/admin/positions');
  }
  // Каскадная очистка ссылок — список специалистов можно свободно расширять и убавлять.
  store.where('users', (u) => (u.positionIds || []).includes(position.id)).forEach((u) => {
    store.update('users', u.id, { positionIds: u.positionIds.filter((id) => id !== position.id) });
  });
  store.where('events', (e) => (e.requiredPositions || []).some((r) => r.positionId === position.id)).forEach((e) => {
    store.update('events', e.id, {
      requiredPositions: e.requiredPositions.filter((r) => r.positionId !== position.id),
    });
  });
  store.removeWhere('eventSignups', (s) => s.positionId === position.id);
  store.remove('positions', position.id);
  req.flash('success', `Должность «${position.name}» удалена из каталога.`);
  res.redirect('/admin/positions');
});

// --- Площадки ---

router.get('/venues', (req, res) => {
  const venues = store.all('venues').map((v) => ({
    venue: v,
    usedByEvents: store.where('events', (e) => e.venueId === v.id).length,
  }));
  res.render('admin/venues', { title: 'Площадки', venues, form: {} });
});

router.post('/venues', (req, res) => {
  const { name, address } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название площадки.');
    return res.redirect('/admin/venues');
  }
  store.insert('venues', { name: name.trim(), address: (address || '').trim() });
  req.flash('success', 'Площадка добавлена.');
  res.redirect('/admin/venues');
});

router.delete('/venues/:id', (req, res) => {
  const venue = store.find('venues', req.params.id);
  if (!venue) {
    req.flash('error', 'Площадка не найдена.');
    return res.redirect('/admin/venues');
  }
  const usedByEvents = store.where('events', (e) => e.venueId === venue.id).length;
  if (usedByEvents > 0) {
    req.flash('error', `Нельзя удалить площадку: на неё ссылаются мероприятия (${usedByEvents}). Сначала измените или удалите эти мероприятия.`);
    return res.redirect('/admin/venues');
  }
  store.remove('venues', venue.id);
  req.flash('success', `Площадка «${venue.name}» удалена.`);
  res.redirect('/admin/venues');
});

// --- Ачивки ---

router.get('/achievements', (req, res) => {
  const achievements = store.all('achievements').map((a) => ({
    achievement: a,
    awardedCount: store.where('userAchievements', (ua) => ua.achievementId === a.id).length,
  }));
  res.render('admin/achievements', {
    title: 'Ачивки',
    achievements,
    form: {},
    autoRuleTypes: domain.AUTO_RULES,
  });
});

router.post('/achievements', (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить аватарку.');
      return res.redirect('/admin/achievements');
    }
    const { icon, name, description } = req.body;
    if (!name || !name.trim()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      req.flash('error', 'Укажите название ачивки.');
      return res.redirect('/admin/achievements');
    }

    const { autoRuleType, autoRuleThreshold } = parseAutoRule(req.body);
    const achievement = store.insert('achievements', {
      icon: (icon || '🏅').trim(),
      name: name.trim(),
      description: (description || '').trim(),
      avatarFile: req.file ? req.file.filename : null,
      autoRuleType,
      autoRuleThreshold,
    });

    let extra = '';
    if (autoRuleType) {
      const backAwarded = domain.evaluateAchievementForAllUsers(achievement);
      if (backAwarded.length) {
        extra = ` Начислена задним числом ${backAwarded.length} участник(ам), уже соответствующим условию.`;
      }
    }
    req.flash('success', `Ачивка добавлена в каталог.${extra}`);
    res.redirect('/admin/achievements');
  });
});

router.delete('/achievements/:id', (req, res) => {
  const achievement = store.find('achievements', req.params.id);
  if (!achievement) {
    req.flash('error', 'Ачивка не найдена.');
    return res.redirect('/admin/achievements');
  }
  if (achievement.avatarFile) {
    fs.unlink(path.join(AVATAR_DIR, achievement.avatarFile), () => {});
  }
  store.removeWhere('userAchievements', (ua) => ua.achievementId === achievement.id);
  store.remove('achievements', achievement.id);
  req.flash('success', `Ачивка «${achievement.name}» удалена из каталога.`);
  res.redirect('/admin/achievements');
});

module.exports = router;
