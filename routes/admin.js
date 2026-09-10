'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireAdmin, ROLE_LABELS } = require('../lib/auth');
const { imageUpload } = require('../lib/uploads');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// --- Загрузка аватарок ачивок ---

const AVATAR_DIR = path.join(__dirname, '..', 'public', 'uploads', 'achievements');
const avatarUpload = imageUpload(AVATAR_DIR);

const AUTO_RULE_TYPES = Object.keys(domain.AUTO_RULES);

function parseAutoRule(body) {
  return { autoRuleType: AUTO_RULE_TYPES.includes(body.autoRuleType) ? body.autoRuleType : null };
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
  const nextRole = ['user', 'tech_director', 'mentor', 'admin'].includes(req.body.role) ? req.body.role : 'user';
  if (user.role === 'admin' && nextRole !== 'admin') {
    const adminCount = store.where('users', (u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      req.flash('error', 'Нельзя понизить последнего администратора.');
      return res.redirect('/admin/users');
    }
  }
  store.update('users', user.id, { role: nextRole });
  req.flash('success', `Роль пользователя ${user.fullName} изменена на «${ROLE_LABELS[nextRole]}».`);
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
  const { name, description, category } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название должности.');
    return res.redirect('/admin/positions');
  }
  const validCategory = domain.POSITION_CATEGORY_LABELS[category] ? category : 'other';
  store.insert('positions', { name: name.trim(), description: (description || '').trim(), category: validCategory });
  req.flash('success', 'Должность добавлена в каталог.');
  res.redirect('/admin/positions');
});

router.put('/positions/:id', (req, res) => {
  const position = store.find('positions', req.params.id);
  if (!position) {
    req.flash('error', 'Должность не найдена.');
    return res.redirect('/admin/positions');
  }
  const { name, description, category } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название должности.');
    return res.redirect('/admin/positions');
  }
  const validCategory = domain.POSITION_CATEGORY_LABELS[category] ? category : 'other';
  store.update('positions', position.id, {
    name: name.trim(),
    description: (description || '').trim(),
    category: validCategory,
  });
  req.flash('success', `Должность «${name.trim()}» обновлена.`);
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

// --- Сезоны (лидеры месяца/периода) ---

router.get('/seasons', (req, res) => {
  const now = Date.now();
  const seasons = store
    .all('seasons')
    .map((s) => {
      const starts = new Date(s.startsAt).getTime();
      const ends = new Date(s.endsAt).getTime();
      const status = now < starts ? 'upcoming' : now > ends ? 'ended' : 'active';
      return { season: s, status };
    })
    .sort((a, b) => new Date(b.season.startsAt) - new Date(a.season.startsAt));
  res.render('admin/seasons', { title: 'Сезоны', seasons, form: {} });
});

router.post('/seasons', (req, res) => {
  const { name, startsAt, endsAt } = req.body;
  const errors = [];
  if (!name || !name.trim()) errors.push('Укажите название сезона.');
  if (!startsAt || !endsAt) errors.push('Укажите начало и окончание сезона.');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    errors.push('Окончание должно быть позже начала.');
  }
  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    return res.redirect('/admin/seasons');
  }
  store.insert('seasons', {
    name: name.trim(),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    createdBy: req.currentUser.id,
    createdAt: new Date().toISOString(),
  });
  req.flash('success', 'Сезон добавлен.');
  res.redirect('/admin/seasons');
});

router.delete('/seasons/:id', (req, res) => {
  const season = store.find('seasons', req.params.id);
  if (!season) {
    req.flash('error', 'Сезон не найден.');
    return res.redirect('/admin/seasons');
  }
  store.remove('seasons', season.id);
  req.flash('success', `Сезон «${season.name}» удалён.`);
  res.redirect('/admin/seasons');
});

// --- Ачивки ---

const RARITY_SET = new Set(domain.RARITY_ORDER);
const MAX_LEVELS = 5;

// Уровни приходят плоскими полями level_0_rarity/level_0_threshold/level_0_icon
// (+ файл level_0_avatar) — та же причина, что и с positions_<id> в форме
// мероприятия: express/qs теряет числовые id при парсинге bracket-нотации.
// Никаких fs-операций здесь — только вычисляем итоговые уровни и что удалить
// с диска в каждом из двух исходов (сохранили / откатили), чтобы при ошибке
// валидации не потерять одновременно и старый, и новый файл уровня.
function parseLevels(body, files, existingLevels) {
  const levels = [];
  const filesToDeleteOnCommit = [];
  const filesToDeleteOnAbort = [];
  for (let i = 0; i < MAX_LEVELS; i += 1) {
    const rarityRaw = body[`level_${i}_rarity`];
    if (rarityRaw === undefined) break;
    const rarity = RARITY_SET.has(rarityRaw) ? rarityRaw : 'common';
    const thresholdRaw = body[`level_${i}_threshold`];
    const threshold = thresholdRaw !== undefined && thresholdRaw !== '' ? parseInt(thresholdRaw, 10) : null;
    const icon = (body[`level_${i}_icon`] || '🏅').trim().slice(0, 4) || '🏅';
    const file = (files || []).find((f) => f.fieldname === `level_${i}_avatar`);
    const removeAvatar = body[`level_${i}_removeAvatar`] === '1';
    const existing = (existingLevels || [])[i];
    let avatarFile = existing ? existing.avatarFile : null;
    if (file) {
      if (existing && existing.avatarFile) filesToDeleteOnCommit.push(path.join(AVATAR_DIR, existing.avatarFile));
      filesToDeleteOnAbort.push(file.path);
      avatarFile = file.filename;
    } else if (removeAvatar && avatarFile) {
      filesToDeleteOnCommit.push(path.join(AVATAR_DIR, avatarFile));
      avatarFile = null;
    }
    levels.push({ rarity, threshold: Number.isFinite(threshold) ? threshold : null, icon, avatarFile });
  }
  return { levels, filesToDeleteOnCommit, filesToDeleteOnAbort };
}

function validateLevels(levels, autoRuleType) {
  const errors = [];
  if (!levels.length) {
    errors.push('Добавьте хотя бы один уровень.');
    return errors;
  }
  if (autoRuleType) {
    let prevThreshold = 0;
    levels.forEach((lvl, i) => {
      if (!Number.isFinite(lvl.threshold) || lvl.threshold < 1) {
        errors.push(`Уровень ${i + 1}: укажите порог (целое число ≥ 1).`);
      } else if (lvl.threshold <= prevThreshold) {
        errors.push(`Уровень ${i + 1}: порог должен быть больше, чем у предыдущего уровня.`);
      } else {
        prevThreshold = lvl.threshold;
      }
    });
  }
  return errors;
}

function unlinkLevelAvatars(levels) {
  (levels || []).forEach((lvl) => {
    if (lvl.avatarFile) fs.unlink(path.join(AVATAR_DIR, lvl.avatarFile), () => {});
  });
}

router.get('/achievements', (req, res) => {
  const achievements = store.all('achievements').map((a) => ({
    achievement: a,
    awardedCount: store.where('userAchievements', (ua) => ua.achievementId === a.id).length,
  }));
  res.render('admin/achievements', {
    title: 'Ачивки',
    achievements,
    achievement: null,
    autoRuleTypes: domain.AUTO_RULES,
    rarityOrder: domain.RARITY_ORDER,
    rarityLabels: domain.RARITY_LABELS,
  });
});

router.get('/achievements/:id/edit', (req, res) => {
  const achievement = store.find('achievements', req.params.id);
  if (!achievement) {
    req.flash('error', 'Ачивка не найдена.');
    return res.redirect('/admin/achievements');
  }
  const achievements = store.all('achievements').map((a) => ({
    achievement: a,
    awardedCount: store.where('userAchievements', (ua) => ua.achievementId === a.id).length,
  }));
  res.render('admin/achievements', {
    title: 'Редактирование ачивки',
    achievements,
    achievement,
    autoRuleTypes: domain.AUTO_RULES,
    rarityOrder: domain.RARITY_ORDER,
    rarityLabels: domain.RARITY_LABELS,
  });
});

router.post('/achievements', (req, res) => {
  avatarUpload.any()(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить файлы.');
      return res.redirect('/admin/achievements');
    }
    const { name, description } = req.body;
    const { autoRuleType } = parseAutoRule(req.body);
    const { levels, filesToDeleteOnAbort } = parseLevels(req.body, req.files, null);

    if (!name || !name.trim()) {
      filesToDeleteOnAbort.forEach((f) => fs.unlink(f, () => {}));
      req.flash('error', 'Укажите название ачивки.');
      return res.redirect('/admin/achievements');
    }
    const errors = validateLevels(levels, autoRuleType);
    if (errors.length) {
      filesToDeleteOnAbort.forEach((f) => fs.unlink(f, () => {}));
      errors.forEach((e) => req.flash('error', e));
      return res.redirect('/admin/achievements');
    }

    const achievement = store.insert('achievements', {
      name: name.trim(),
      description: (description || '').trim(),
      autoRuleType,
      levels,
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

router.put('/achievements/:id', (req, res) => {
  const achievement = store.find('achievements', req.params.id);
  if (!achievement) {
    req.flash('error', 'Ачивка не найдена.');
    return res.redirect('/admin/achievements');
  }
  avatarUpload.any()(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить файлы.');
      return res.redirect(`/admin/achievements/${achievement.id}/edit`);
    }
    const { name, description } = req.body;
    const { autoRuleType } = parseAutoRule(req.body);
    const { levels, filesToDeleteOnCommit, filesToDeleteOnAbort } = parseLevels(req.body, req.files, achievement.levels);

    if (!name || !name.trim()) {
      filesToDeleteOnAbort.forEach((f) => fs.unlink(f, () => {}));
      req.flash('error', 'Укажите название ачивки.');
      return res.redirect(`/admin/achievements/${achievement.id}/edit`);
    }
    const errors = validateLevels(levels, autoRuleType);
    if (errors.length) {
      filesToDeleteOnAbort.forEach((f) => fs.unlink(f, () => {}));
      errors.forEach((e) => req.flash('error', e));
      return res.redirect(`/admin/achievements/${achievement.id}/edit`);
    }

    // старые файлы уровней, замененных/убранных при редактировании — подчищаем
    filesToDeleteOnCommit.forEach((f) => fs.unlink(f, () => {}));
    (achievement.levels || []).slice(levels.length).forEach((lvl) => {
      if (lvl.avatarFile) fs.unlink(path.join(AVATAR_DIR, lvl.avatarFile), () => {});
    });

    store.update('achievements', achievement.id, {
      name: name.trim(),
      description: (description || '').trim(),
      autoRuleType,
      levels,
    });

    let extra = '';
    if (autoRuleType) {
      const backAwarded = domain.evaluateAchievementForAllUsers(store.find('achievements', achievement.id));
      if (backAwarded.length) {
        extra = ` Пересчитано и повышено/начислено ${backAwarded.length} участник(ам).`;
      }
    }
    req.flash('success', `Ачивка «${name.trim()}» обновлена.${extra}`);
    res.redirect('/admin/achievements');
  });
});

router.delete('/achievements/:id', (req, res) => {
  const achievement = store.find('achievements', req.params.id);
  if (!achievement) {
    req.flash('error', 'Ачивка не найдена.');
    return res.redirect('/admin/achievements');
  }
  unlinkLevelAvatars(achievement.levels);
  store.removeWhere('userAchievements', (ua) => ua.achievementId === achievement.id);
  store.remove('achievements', achievement.id);
  req.flash('success', `Ачивка «${achievement.name}» удалена из каталога.`);
  res.redirect('/admin/achievements');
});

module.exports = router;
