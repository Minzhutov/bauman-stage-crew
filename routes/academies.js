'use strict';
const express = require('express');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireStaff } = require('../lib/auth');

const router = express.Router();

function withSpeakerInfo(a) {
  return Object.assign({}, a, { creator: store.find('users', a.createdBy) });
}

router.get('/', (req, res) => {
  const academies = store
    .all('academies')
    .map(withSpeakerInfo)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  res.render('academies/list', { title: 'Академии', academies });
});

router.get('/new', requireAuth, requireStaff, (req, res) => {
  res.render('academies/form', { title: 'Новая лекция', academy: null, form: {} });
});

router.post('/', requireAuth, requireStaff, (req, res) => {
  const { title, topic, description, room, speaker, startsAt, endsAt } = req.body;
  const errors = [];
  if (!title || !title.trim()) errors.push('Укажите тему лекции.');
  if (!room || !room.trim()) errors.push('Укажите аудиторию.');
  if (!startsAt || !endsAt) errors.push('Укажите время начала и окончания.');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    errors.push('Время окончания должно быть позже времени начала.');
  }
  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    return res.status(400).render('academies/form', {
      title: 'Новая лекция',
      academy: null,
      form: req.body,
    });
  }

  const academy = store.insert('academies', {
    title: title.trim(),
    topic: (topic || '').trim(),
    description: (description || '').trim(),
    room: room.trim(),
    speaker: (speaker || '').trim(),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    createdBy: req.currentUser.id,
    createdAt: new Date().toISOString(),
  });

  req.flash('success', 'Лекция опубликована в Академии.');
  res.redirect(`/academies/${academy.id}`);
});

router.get('/:id', (req, res) => {
  const academy = store.find('academies', req.params.id);
  if (!academy) {
    req.flash('error', 'Лекция не найдена.');
    return res.redirect('/academies');
  }
  const pointsAwards = store
    .where('pointsLog', (p) => p.academyId === academy.id)
    .map((p) => Object.assign({}, p, { user: store.find('users', p.userId) }))
    .sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt));

  const signups = store
    .where('academySignups', (s) => s.academyId === academy.id)
    .map((s) => Object.assign({}, s, { user: store.find('users', s.userId) }))
    .filter((s) => s.user)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const isSignedUp = Boolean(
    req.currentUser && signups.some((s) => s.userId === req.currentUser.id)
  );

  res.render('academies/detail', {
    title: academy.title,
    academy: withSpeakerInfo(academy),
    pointsAwards,
    signups,
    isSignedUp,
    allUsers: store.all('users').sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
  });
});

router.post('/:id/signup', requireAuth, (req, res) => {
  const academy = store.find('academies', req.params.id);
  if (!academy) {
    req.flash('error', 'Лекция не найдена.');
    return res.redirect('/academies');
  }
  const already = store.where(
    'academySignups',
    (s) => s.academyId === academy.id && s.userId === req.currentUser.id
  )[0];
  if (already) {
    req.flash('error', 'Вы уже записаны на эту лекцию.');
    return res.redirect(`/academies/${academy.id}`);
  }
  store.insert('academySignups', {
    academyId: academy.id,
    userId: req.currentUser.id,
    createdAt: new Date().toISOString(),
  });
  req.flash('success', 'Вы записались на лекцию.');
  res.redirect(`/academies/${academy.id}`);
});

router.delete('/:id/signup', requireAuth, (req, res) => {
  const academy = store.find('academies', req.params.id);
  if (!academy) {
    req.flash('error', 'Лекция не найдена.');
    return res.redirect('/academies');
  }
  const signup = store.where(
    'academySignups',
    (s) => s.academyId === academy.id && s.userId === req.currentUser.id
  )[0];
  if (!signup) {
    req.flash('error', 'Вы не были записаны на эту лекцию.');
    return res.redirect(`/academies/${academy.id}`);
  }
  store.remove('academySignups', signup.id);
  req.flash('success', 'Вы отписались от лекции.');
  res.redirect(`/academies/${academy.id}`);
});

router.get('/:id/edit', requireAuth, requireStaff, (req, res) => {
  const academy = store.find('academies', req.params.id);
  if (!academy) {
    req.flash('error', 'Лекция не найдена.');
    return res.redirect('/academies');
  }
  res.render('academies/form', { title: 'Редактирование лекции', academy, form: academy });
});

router.put('/:id', requireAuth, requireStaff, (req, res) => {
  const academy = store.find('academies', req.params.id);
  if (!academy) {
    req.flash('error', 'Лекция не найдена.');
    return res.redirect('/academies');
  }
  const { title, topic, description, room, speaker, startsAt, endsAt } = req.body;
  const errors = [];
  if (!title || !title.trim()) errors.push('Укажите тему лекции.');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    errors.push('Время окончания должно быть позже времени начала.');
  }
  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    return res.status(400).render('academies/form', {
      title: 'Редактирование лекции',
      academy,
      form: req.body,
    });
  }

  store.update('academies', academy.id, {
    title: title.trim(),
    topic: (topic || '').trim(),
    description: (description || '').trim(),
    room: room.trim(),
    speaker: (speaker || '').trim(),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
  });

  req.flash('success', 'Лекция обновлена.');
  res.redirect(`/academies/${academy.id}`);
});

router.delete('/:id', requireAuth, requireStaff, (req, res) => {
  const academy = store.find('academies', req.params.id);
  if (!academy) {
    req.flash('error', 'Лекция не найдена.');
    return res.redirect('/academies');
  }
  store.removeWhere('academySignups', (s) => s.academyId === academy.id);
  store.remove('academies', academy.id);
  req.flash('success', 'Лекция удалена.');
  res.redirect('/academies');
});

// --- Начисление баллов по итогам лекции ---

router.post('/:id/points', requireAuth, requireStaff, (req, res) => {
  const academy = store.find('academies', req.params.id);
  const user = store.find('users', req.body.userId);
  if (!academy) {
    req.flash('error', 'Лекция не найдена.');
    return res.redirect('/academies');
  }
  if (!user) {
    req.flash('error', 'Пользователь не найден.');
    return res.redirect(`/academies/${academy.id}`);
  }
  const amount = parseInt(req.body.amount, 10);
  if (!Number.isFinite(amount) || amount === 0) {
    req.flash('error', 'Укажите ненулевое количество баллов.');
    return res.redirect(`/academies/${academy.id}`);
  }
  const reason = (req.body.reason || '').trim() || `Лекция: ${academy.title}`;

  store.insert('pointsLog', {
    userId: user.id,
    amount,
    reason,
    eventId: null,
    academyId: academy.id,
    awardedBy: req.currentUser.id,
    awardedAt: new Date().toISOString(),
  });

  const newAchievements = domain.evaluateAutoAchievements(user.id);
  let extra = '';
  if (newAchievements.length) {
    extra = ` Автоматически выданы ачивки: ${newAchievements.map((a) => a.achievement.name).join(', ')}.`;
  }
  req.flash('success', `Начислено ${amount > 0 ? '+' : ''}${amount} баллов пользователю ${user.fullName} за лекцию.${extra}`);
  res.redirect(`/academies/${academy.id}`);
});

module.exports = router;
