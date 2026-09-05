'use strict';
const express = require('express');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireAdmin } = require('../lib/auth');

const router = express.Router();

function parseRequiredPositions(body) {
  // "positions_<id>", а не "positions[<id>]" — иначе qs схлопывает id в массив
  const prefix = 'positions_';
  return Object.keys(body)
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({
      positionId: Number(key.slice(prefix.length)),
      count: parseInt(body[key], 10) || 0,
    }))
    .filter((r) => Number.isFinite(r.positionId) && r.count > 0);
}

function eventFormLocals(overrides) {
  return Object.assign(
    {
      title: 'Новое мероприятие',
      positions: store.all('positions'),
      venues: store.all('venues'),
      form: {},
      event: null,
      requiredMap: {},
    },
    overrides
  );
}

router.get('/', (req, res) => {
  const { status } = req.query;
  let events = store.all('events').map((e) => domain.eventWithDetails(e));
  if (status && ['planned', 'completed', 'cancelled'].includes(status)) {
    events = events.filter((e) => e.status === status);
  }
  events.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  res.render('events/list', {
    title: 'Мероприятия',
    events,
    statusFilter: status || '',
  });
});

router.get('/new', requireAuth, requireAdmin, (req, res) => {
  res.render('events/form', eventFormLocals({ title: 'Новое мероприятие' }));
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { title, description, venueId, startsAt, endsAt } = req.body;
  const errors = [];
  if (!title || !title.trim()) errors.push('Укажите название мероприятия.');
  if (!venueId) errors.push('Выберите место проведения.');
  if (!startsAt || !endsAt) errors.push('Укажите время начала и окончания.');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    errors.push('Время окончания должно быть позже времени начала.');
  }

  const requiredPositions = parseRequiredPositions(req.body);
  if (requiredPositions.length === 0) {
    errors.push('Укажите хотя бы одну требуемую должность и количество специалистов.');
  }

  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    const requiredMap = {};
    requiredPositions.forEach((r) => { requiredMap[r.positionId] = r.count; });
    return res.status(400).render(
      'events/form',
      eventFormLocals({ title: 'Новое мероприятие', form: req.body, requiredMap })
    );
  }

  const event = store.insert('events', {
    title: title.trim(),
    description: (description || '').trim(),
    venueId: Number(venueId),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    status: 'planned',
    requiredPositions,
    createdBy: req.currentUser.id,
    createdAt: new Date().toISOString(),
  });

  req.flash('success', 'Мероприятие опубликовано.');
  res.redirect(`/events/${event.id}`);
});

router.get('/:id', (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  const details = domain.eventWithDetails(event);

  let mySignups = [];
  let availablePositions = [];
  if (req.currentUser) {
    mySignups = store.where(
      'eventSignups',
      (s) => s.eventId === event.id && s.userId === req.currentUser.id
    );
    const takenPositionIds = new Set(mySignups.filter((s) => s.status !== 'rejected').map((s) => s.positionId));
    availablePositions = domain
      .userPositions(req.currentUser.id)
      .filter((p) => event.requiredPositions.some((r) => r.positionId === p.id))
      .filter((p) => !takenPositionIds.has(p.id));
  }

  res.render('events/detail', {
    title: event.title,
    event: details,
    mySignups,
    availablePositions,
  });
});

router.get('/:id/edit', requireAuth, requireAdmin, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  const requiredMap = {};
  (event.requiredPositions || []).forEach((r) => { requiredMap[r.positionId] = r.count; });
  res.render(
    'events/form',
    eventFormLocals({ title: 'Редактирование мероприятия', event, form: event, requiredMap })
  );
});

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  const { title, description, venueId, startsAt, endsAt, status } = req.body;
  const errors = [];
  if (!title || !title.trim()) errors.push('Укажите название мероприятия.');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    errors.push('Время окончания должно быть позже времени начала.');
  }
  const requiredPositions = parseRequiredPositions(req.body);
  if (requiredPositions.length === 0) {
    errors.push('Укажите хотя бы одну требуемую должность и количество специалистов.');
  }

  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    const requiredMap = {};
    requiredPositions.forEach((r) => { requiredMap[r.positionId] = r.count; });
    return res.status(400).render(
      'events/form',
      eventFormLocals({ title: 'Редактирование мероприятия', event, form: req.body, requiredMap })
    );
  }

  store.update('events', event.id, {
    title: title.trim(),
    description: (description || '').trim(),
    venueId: Number(venueId),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    status: status || event.status,
    requiredPositions,
  });

  req.flash('success', 'Мероприятие обновлено.');
  res.redirect(`/events/${event.id}`);
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  store.removeWhere('eventSignups', (s) => s.eventId === event.id);
  store.remove('events', event.id);
  req.flash('success', 'Мероприятие удалено.');
  res.redirect('/events');
});

// --- Заявки на участие ---

router.post('/:id/signups', requireAuth, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  const positionId = Number(req.body.positionId);
  const isRequired = (event.requiredPositions || []).some((r) => r.positionId === positionId);
  const userHasPosition = domain.userPositions(req.currentUser.id).some((p) => p.id === positionId);

  if (!isRequired) {
    req.flash('error', 'Эта должность не требуется для мероприятия.');
    return res.redirect(`/events/${event.id}`);
  }
  if (!userHasPosition) {
    req.flash('error', 'Эта должность недоступна в вашем профиле. Обратитесь к администратору.');
    return res.redirect(`/events/${event.id}`);
  }
  const existing = store.where(
    'eventSignups',
    (s) => s.eventId === event.id && s.userId === req.currentUser.id && s.positionId === positionId && s.status !== 'rejected'
  );
  if (existing.length > 0) {
    req.flash('error', 'Вы уже откликнулись на эту должность.');
    return res.redirect(`/events/${event.id}`);
  }

  store.insert('eventSignups', {
    eventId: event.id,
    userId: req.currentUser.id,
    positionId,
    status: 'pending',
    pointsAwarded: 0,
    createdAt: new Date().toISOString(),
  });

  req.flash('success', 'Заявка отправлена. Ожидайте подтверждения администратора.');
  res.redirect(`/events/${event.id}`);
});

router.delete('/:id/signups/:signupId', requireAuth, (req, res) => {
  const signup = store.find('eventSignups', req.params.signupId);
  if (!signup || signup.eventId !== Number(req.params.id)) {
    req.flash('error', 'Заявка не найдена.');
    return res.redirect(`/events/${req.params.id}`);
  }
  const isOwner = signup.userId === req.currentUser.id;
  const isAdmin = req.currentUser.role === 'admin';
  if (!isOwner && !isAdmin) {
    req.flash('error', 'Недостаточно прав для отмены этой заявки.');
    return res.redirect(`/events/${req.params.id}`);
  }
  if (isOwner && !isAdmin && signup.status !== 'pending') {
    req.flash('error', 'Отменить можно только заявку в статусе ожидания.');
    return res.redirect(`/events/${req.params.id}`);
  }
  store.remove('eventSignups', signup.id);
  req.flash('success', 'Заявка отменена.');
  res.redirect(`/events/${req.params.id}`);
});

router.put('/:id/signups/:signupId', requireAuth, requireAdmin, (req, res) => {
  const signup = store.find('eventSignups', req.params.signupId);
  if (!signup || signup.eventId !== Number(req.params.id)) {
    req.flash('error', 'Заявка не найдена.');
    return res.redirect(`/events/${req.params.id}`);
  }
  const { action, points } = req.body;
  const event = store.find('events', req.params.id);

  if (action === 'approve') {
    store.update('eventSignups', signup.id, {
      status: 'approved',
      respondedBy: req.currentUser.id,
      respondedAt: new Date().toISOString(),
    });
    req.flash('success', 'Заявка подтверждена.');
  } else if (action === 'reject') {
    store.update('eventSignups', signup.id, {
      status: 'rejected',
      respondedBy: req.currentUser.id,
      respondedAt: new Date().toISOString(),
    });
    req.flash('success', 'Заявка отклонена.');
  } else if (action === 'complete') {
    const amount = parseInt(points, 10) || 0;
    store.update('eventSignups', signup.id, {
      status: 'done',
      pointsAwarded: amount,
      respondedBy: req.currentUser.id,
      respondedAt: new Date().toISOString(),
    });
    if (amount > 0) {
      store.insert('pointsLog', {
        userId: signup.userId,
        amount,
        reason: `Мероприятие: ${event ? event.title : 'без названия'}`,
        eventId: event ? event.id : null,
        awardedBy: req.currentUser.id,
        awardedAt: new Date().toISOString(),
      });
    }
    const newAchievements = domain.evaluateAutoAchievements(signup.userId);
    let extra = '';
    if (newAchievements.length) {
      extra = ` Автоматически выданы ачивки: ${newAchievements.map((a) => a.achievement.name).join(', ')}.`;
    }
    req.flash('success', `Смена закрыта, начислено ${amount} баллов.${extra}`);
  } else {
    req.flash('error', 'Неизвестное действие.');
  }
  res.redirect(`/events/${req.params.id}`);
});

module.exports = router;
