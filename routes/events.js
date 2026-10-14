'use strict';
const express = require('express');
const store = require('../lib/store');
const domain = require('../lib/domain');
const format = require('../lib/format');
const { requireAuth, requireAdmin, requireStaff } = require('../lib/auth');

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
      techDirectors: store.where('users', (u) => u.role === 'tech_director' || u.role === 'admin'),
      form: {},
      event: null,
      requiredMap: {},
    },
    overrides
  );
}

function parseTechDirectorId(body) {
  const id = parseInt(body.techDirectorId, 10);
  if (!Number.isFinite(id)) return null;
  const user = store.find('users', id);
  return user && (user.role === 'tech_director' || user.role === 'admin') ? id : null;
}

// Когда участник реально будет на площадке + комментарий к отклику. Не
// указано/вне рамок мероприятия — подрезаем до startsAt/endsAt, а не
// отклоняем заявку из-за опечатки во времени.
function parseSignupSchedule(body, event) {
  const comment = (body.comment || '').trim().slice(0, 500);
  const eventStart = new Date(event.startsAt);
  const eventEnd = new Date(event.endsAt);
  let arrivesAt = body.arrivesAt ? format.fromMoscowInput(body.arrivesAt) : null;
  let departsAt = body.departsAt ? format.fromMoscowInput(body.departsAt) : null;
  if (!arrivesAt || Number.isNaN(arrivesAt.getTime()) || arrivesAt < eventStart || arrivesAt > eventEnd) {
    arrivesAt = eventStart;
  }
  if (!departsAt || Number.isNaN(departsAt.getTime()) || departsAt > eventEnd || departsAt <= arrivesAt) {
    departsAt = eventEnd;
  }
  return { comment, arrivesAt: arrivesAt.toISOString(), departsAt: departsAt.toISOString() };
}

// По умолчанию (и на любое нераспознанное значение status) показываем только
// предстоящие — запланированные мероприятия, дата которых ещё не прошла.
// Прошедшие по дате, но так и не закрытые (status всё ещё 'planned') —
// отдельным фильтром «Прошедшие», а не свалены вместе с предстоящими.
router.get('/', (req, res) => {
  const { status } = req.query;
  const validFilters = ['upcoming', 'past', 'completed', 'cancelled', 'all'];
  const filter = validFilters.includes(status) ? status : 'upcoming';
  const now = Date.now();
  let events = store.all('events').map((e) => domain.eventWithDetails(e));

  if (filter === 'upcoming') {
    events = events.filter((e) => e.status === 'planned' && new Date(e.endsAt).getTime() >= now);
  } else if (filter === 'past') {
    events = events.filter((e) => e.status === 'planned' && new Date(e.endsAt).getTime() < now);
  } else if (filter === 'completed' || filter === 'cancelled') {
    events = events.filter((e) => e.status === filter);
  }
  // filter === 'all' — без фильтрации

  if (filter === 'past') {
    events.sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  } else {
    events.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }

  res.render('events/list', {
    title: 'Мероприятия',
    events,
    statusFilter: filter,
  });
});

router.get('/new', requireAuth, requireStaff, (req, res) => {
  res.render('events/form', eventFormLocals({ title: 'Новое мероприятие' }));
});

router.post('/', requireAuth, requireStaff, (req, res) => {
  const { title, description, venueId, startsAt, endsAt } = req.body;
  const startsAtDate = format.fromMoscowInput(startsAt);
  const endsAtDate = format.fromMoscowInput(endsAt);
  const errors = [];
  if (!title || !title.trim()) errors.push('Укажите название мероприятия.');
  if (!venueId) errors.push('Выберите место проведения.');
  if (!startsAt || !endsAt) errors.push('Укажите время начала и окончания.');
  if (startsAtDate && endsAtDate && endsAtDate <= startsAtDate) {
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

  // Технический директор, создавший мероприятие сам, автоматически становится
  // его куратором — иначе он не смог бы потом его редактировать (canManageEvent
  // пускает только админа и назначенного техдира). Админ выбирает куратора сам.
  const techDirectorId = req.currentUser.role === 'admin'
    ? parseTechDirectorId(req.body)
    : req.currentUser.id;

  const event = store.insert('events', {
    title: title.trim(),
    description: (description || '').trim(),
    venueId: Number(venueId),
    startsAt: startsAtDate.toISOString(),
    endsAt: endsAtDate.toISOString(),
    status: 'planned',
    requiredPositions,
    // Комплект (кейсы и отдельное оборудование) собирается отдельно на
    // странице «Комплекты» — после создания мероприятия, когда уже есть его id.
    equipment: [],
    cases: [],
    techDirectorId,
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

router.get('/:id/edit', requireAuth, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  if (!domain.canManageEvent(req.currentUser, event)) {
    req.flash('error', 'Редактировать это мероприятие может только администратор или назначенный технический директор.');
    return res.redirect(`/events/${event.id}`);
  }
  const requiredMap = {};
  (event.requiredPositions || []).forEach((r) => { requiredMap[r.positionId] = r.count; });
  res.render(
    'events/form',
    eventFormLocals({
      title: 'Редактирование мероприятия',
      event: domain.eventWithDetails(event),
      form: event,
      requiredMap,
    })
  );
});

router.put('/:id', requireAuth, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  if (!domain.canManageEvent(req.currentUser, event)) {
    req.flash('error', 'Редактировать это мероприятие может только администратор или назначенный технический директор.');
    return res.redirect(`/events/${event.id}`);
  }
  const { title, description, venueId, startsAt, endsAt, status } = req.body;
  const startsAtDate = format.fromMoscowInput(startsAt);
  const endsAtDate = format.fromMoscowInput(endsAt);
  const errors = [];
  if (!title || !title.trim()) errors.push('Укажите название мероприятия.');
  if (startsAtDate && endsAtDate && endsAtDate <= startsAtDate) {
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

  // технического директора назначает только админ — заявку от тех.директора на смену назначения игнорируем
  const techDirectorId = req.currentUser.role === 'admin' ? parseTechDirectorId(req.body) : event.techDirectorId;
  const nextStatus = status || event.status;

  // Комплект (кейсы и отдельное оборудование) эта форма не трогает — он
  // собирается отдельно на странице «Комплекты», поэтому ниже просто
  // переиспользуем уже сохранённые event.equipment/event.cases как есть.
  // Мероприятие закрывается/отменяется — если что-то отмечено «уехало», но
  // не «вернулось», это потеря: статус в каталоге автоматически — «Утеряно».
  const flaggedMissing = (nextStatus === 'completed' || nextStatus === 'cancelled')
    ? domain.flagUnreturnedAsMissing(event.equipment, event.cases)
    : [];

  store.update('events', event.id, {
    title: title.trim(),
    description: (description || '').trim(),
    venueId: Number(venueId),
    startsAt: startsAtDate.toISOString(),
    endsAt: endsAtDate.toISOString(),
    status: nextStatus,
    requiredPositions,
    techDirectorId,
  });

  req.flash(
    'success',
    `Мероприятие обновлено.${flaggedMissing.length ? ` Внимание: не подтверждён возврат — ${flaggedMissing.join(', ')}. Статус в каталоге изменён на «Утеряно».` : ''}`
  );
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

// --- Отметки «собрано» / «уехало» / «приехало» — отслеживание перемещения
// оборудования и кейсов. «Собрано» — отдельный шаг до «уехало»: именно он
// переводит позицию из «запланировано» в «реально отложено под мероприятие»
// и только с этого момента она пропадает из «на складе» в каталоге (см.
// domain.isHeld) — планирование на будущую дату само по себе склад не трогает.

function applyTransitAction(row, action) {
  if (action === 'confirm') {
    row.confirmedAt = new Date().toISOString();
  } else if (action === 'depart') {
    // «Уехало» без явного «собрано» перед этим — считаем собранным задним
    // числом: раз оно уехало, значит точно было физически отложено.
    if (!row.confirmedAt) row.confirmedAt = new Date().toISOString();
    row.departedAt = new Date().toISOString();
    row.returnedAt = null;
  } else if (action === 'arrive') {
    row.returnedAt = new Date().toISOString();
  } else if (action === 'reset') {
    row.confirmedAt = null;
    row.departedAt = null;
    row.returnedAt = null;
  }
}

router.put('/:id/equipment/:equipmentId/transit', requireAuth, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  if (!domain.canManageEvent(req.currentUser, event)) {
    req.flash('error', 'Отмечать перемещение оборудования может только администратор или назначенный технический директор.');
    return res.redirect(`/events/${event.id}`);
  }
  const equipmentId = Number(req.params.equipmentId);
  const rows = event.equipment || [];
  const row = rows.find((r) => r.equipmentId === equipmentId);
  if (!row) {
    req.flash('error', 'Позиция не найдена в списке мероприятия.');
    return res.redirect(`/events/${event.id}`);
  }
  applyTransitAction(row, req.body.action);
  store.update('events', event.id, { equipment: rows });
  req.flash('success', 'Статус перемещения обновлён.');
  res.redirect(`/events/${event.id}`);
});

router.put('/:id/cases/:caseId/transit', requireAuth, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  if (!domain.canManageEvent(req.currentUser, event)) {
    req.flash('error', 'Отмечать перемещение оборудования может только администратор или назначенный технический директор.');
    return res.redirect(`/events/${event.id}`);
  }
  const caseId = Number(req.params.caseId);
  const rows = event.cases || [];
  const row = rows.find((r) => r.caseId === caseId);
  if (!row) {
    req.flash('error', 'Кейс не найден в списке мероприятия.');
    return res.redirect(`/events/${event.id}`);
  }
  applyTransitAction(row, req.body.action);
  store.update('events', event.id, { cases: rows });
  req.flash('success', 'Статус перемещения обновлён.');
  res.redirect(`/events/${event.id}`);
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

  const { comment, arrivesAt, departsAt } = parseSignupSchedule(req.body, event);
  store.insert('eventSignups', {
    eventId: event.id,
    userId: req.currentUser.id,
    positionId,
    status: 'pending',
    pointsAwarded: 0,
    comment,
    arrivesAt,
    departsAt,
    createdAt: new Date().toISOString(),
  });

  req.flash('success', 'Заявка отправлена. Ожидайте подтверждения администратора.');
  res.redirect(`/events/${event.id}`);
});

router.put('/:id/signups/:signupId/schedule', requireAuth, (req, res) => {
  const signup = store.find('eventSignups', req.params.signupId);
  if (!signup || signup.eventId !== Number(req.params.id)) {
    req.flash('error', 'Заявка не найдена.');
    return res.redirect(`/events/${req.params.id}`);
  }
  if (signup.userId !== req.currentUser.id) {
    req.flash('error', 'Изменить можно только своё время и комментарий.');
    return res.redirect(`/events/${req.params.id}`);
  }
  if (signup.status !== 'pending' && signup.status !== 'approved') {
    req.flash('error', 'Эту заявку уже нельзя изменить.');
    return res.redirect(`/events/${req.params.id}`);
  }
  const event = store.find('events', req.params.id);
  const { comment, arrivesAt, departsAt } = parseSignupSchedule(req.body, event);
  store.update('eventSignups', signup.id, { comment, arrivesAt, departsAt });
  req.flash('success', 'Время и комментарий обновлены.');
  res.redirect(`/events/${req.params.id}`);
});

router.delete('/:id/signups/:signupId', requireAuth, (req, res) => {
  const signup = store.find('eventSignups', req.params.signupId);
  if (!signup || signup.eventId !== Number(req.params.id)) {
    req.flash('error', 'Заявка не найдена.');
    return res.redirect(`/events/${req.params.id}`);
  }
  const event = store.find('events', req.params.id);
  const isOwner = signup.userId === req.currentUser.id;
  const canManage = domain.canManageEvent(req.currentUser, event);
  // сам участник может отменить заявку или отказаться от уже подтверждённой
  // должности — но не задним числом отменить выполненную (с начисленными баллами)
  const ownerCancellable = signup.status === 'pending' || signup.status === 'approved';
  if (!isOwner && !canManage) {
    req.flash('error', 'Недостаточно прав для отмены этой заявки.');
    return res.redirect(`/events/${req.params.id}`);
  }
  if (isOwner && !canManage && !ownerCancellable) {
    req.flash('error', 'Эту заявку уже нельзя отменить самостоятельно — обратитесь к администратору.');
    return res.redirect(`/events/${req.params.id}`);
  }
  const wasApproved = signup.status === 'approved';
  store.remove('eventSignups', signup.id);
  req.flash('success', isOwner && wasApproved ? 'Вы отказались от участия в мероприятии — место освободилось.' : 'Заявка отменена.');
  res.redirect(`/events/${req.params.id}`);
});

router.put('/:id/signups/:signupId', requireAuth, (req, res) => {
  const signup = store.find('eventSignups', req.params.signupId);
  if (!signup || signup.eventId !== Number(req.params.id)) {
    req.flash('error', 'Заявка не найдена.');
    return res.redirect(`/events/${req.params.id}`);
  }
  const event = store.find('events', req.params.id);
  if (!domain.canManageEvent(req.currentUser, event)) {
    req.flash('error', 'Управлять заявками этого мероприятия может только администратор или назначенный технический директор.');
    return res.redirect(`/events/${req.params.id}`);
  }
  const { action, points } = req.body;

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

// --- Чат мероприятия ---

router.post('/:id/chat', requireAuth, (req, res) => {
  const event = store.find('events', req.params.id);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/events');
  }
  const text = (req.body.text || '').trim().slice(0, 2000);
  if (!text) {
    req.flash('error', 'Введите сообщение.');
    return res.redirect(`/events/${event.id}`);
  }
  store.insert('eventMessages', {
    eventId: event.id,
    userId: req.currentUser.id,
    text,
    createdAt: new Date().toISOString(),
  });
  res.redirect(`/events/${event.id}`);
});

router.delete('/:id/chat/:messageId', requireAuth, requireAdmin, (req, res) => {
  const message = store.find('eventMessages', req.params.messageId);
  if (!message || message.eventId !== Number(req.params.id)) {
    req.flash('error', 'Сообщение не найдено.');
    return res.redirect(`/events/${req.params.id}`);
  }
  store.remove('eventMessages', message.id);
  req.flash('success', 'Сообщение удалено.');
  res.redirect(`/events/${req.params.id}`);
});

module.exports = router;
