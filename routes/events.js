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

function parseEquipmentAllocations(body) {
  // "equipment_<id>", а не "equipment[<id>]" — та же причина, что у positions_<id>
  const prefix = 'equipment_';
  return Object.keys(body)
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({
      equipmentId: Number(key.slice(prefix.length)),
      quantity: parseInt(body[key], 10) || 0,
    }))
    .filter((r) => Number.isFinite(r.equipmentId) && r.quantity > 0);
}

// Диапазон дат мероприятия из тела формы — для проверки доступности оборудования
// именно на эти даты, а не вообще (см. domain.equipmentAvailableQuantity).
function dateRangeFromBody(body) {
  if (!body.startsAt || !body.endsAt) return null;
  return { startsAt: body.startsAt, endsAt: body.endsAt };
}

// Сколько единиц позиции equipmentId уже упаковано в кейсах из набора caseIds
// (выбранных на ЭТОМ ЖЕ мероприятии) — если кейс и так едет целиком, те же
// единицы нельзя ещё раз взять отдельной строкой, иначе это задвоение одного
// и того же физического оборудования в рамках одного мероприятия.
function packedInSelectedCases(equipmentId, selectedCaseIds) {
  if (!selectedCaseIds || !selectedCaseIds.size) return 0;
  return store
    .all('cases')
    .filter((c) => selectedCaseIds.has(c.id))
    .reduce((sum, c) => {
      const row = (c.items || []).find((r) => r.equipmentId === equipmentId);
      return sum + (row ? row.quantity : 0);
    }, 0);
}

// Каталог оборудования со сколько ещё можно взять на эти даты мероприятия
// (excludeEventId — редактируемое мероприятие, его же текущая доля не в счёт)
// и сколько уже выбрано в текущей форме (selectedMap: equipmentId -> quantity).
// baseAvailable — доступность без учёта кейсов, выбранных на этом же
// мероприятии (нужна JS на клиенте, чтобы живо пересчитывать max при
// переключении кейсов); available — она же за минусом того, что уже
// упаковано в выбранные сейчас кейсы (чтобы не выбрать те же единицы дважды).
// Статус оборудования (на складе сейчас или нет) не важен для дат мероприятия
// в будущем — важно только отсутствие пересечения по датам с другой бронью
// (и что оборудование не на обслуживании/неисправно/утеряно).
function buildEquipmentRows(excludeEventId, selectedMap, dateRange, selectedCaseIds) {
  const allCases = store.all('cases');
  return store.all('equipment').map((item) => {
    // В каких кейсах каталога эта позиция уже упакована — чтобы на форме не
    // выбрать её ещё раз отдельно, если кейс с ней и так едет на мероприятие.
    const packedInCases = allCases
      .map((c) => {
        const row = (c.items || []).find((r) => r.equipmentId === item.id);
        return row ? { case: c, quantity: row.quantity } : null;
      })
      .filter(Boolean);
    const baseAvailable = domain.equipmentAvailableQuantity(item, excludeEventId, dateRange);
    const packed = packedInSelectedCases(item.id, selectedCaseIds);
    return {
      item,
      selected: (selectedMap && selectedMap[item.id]) || 0,
      baseAvailable,
      available: Math.max(0, baseAvailable - packed),
      packedInCases,
    };
  });
}

function equipmentAllocationsMap(allocations) {
  const map = {};
  allocations.forEach((r) => { map[r.equipmentId] = r.quantity; });
  return map;
}

function validateEquipmentAllocations(allocations, excludeEventId, dateRange, selectedCaseIds) {
  const errors = [];
  allocations.forEach((row) => {
    const item = store.find('equipment', row.equipmentId);
    if (!item) return;
    const baseAvailable = domain.equipmentAvailableQuantity(item, excludeEventId, dateRange);
    const packed = packedInSelectedCases(item.id, selectedCaseIds);
    const available = Math.max(0, baseAvailable - packed);
    if (row.quantity > available) {
      if (packed > 0) {
        errors.push(`«${item.name}»: запрошено ${row.quantity} отдельно, но ${packed} шт. уже упаковано в выбранных кейсах — всего на складе ${baseAvailable}, нельзя взять те же единицы дважды.`);
      } else {
        errors.push(`«${item.name}»: запрошено ${row.quantity}, доступно только ${available}.`);
      }
    }
  });
  return errors;
}

function parseCaseIds(body) {
  const raw = body.caseIds;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((v) => Number(v)).filter((id) => Number.isFinite(id));
}

// Кейсы со статусом доступности на даты мероприятия (excludeEventId — само
// редактируемое мероприятие: его же текущий кейс не считается «занятым»).
function buildCaseRows(excludeEventId, dateRange) {
  return store.all('cases').map((item) => domain.caseWithContents(item, excludeEventId, dateRange));
}

function validateCaseSelection(caseIds, excludeEventId, dateRange) {
  const errors = [];
  caseIds.forEach((id) => {
    const item = store.find('cases', id);
    if (!item) return;
    if (item.status !== 'available') {
      errors.push(`Кейс «${item.name}»: ${domain.EQUIPMENT_STATUS_LABELS[item.status].toLowerCase()}.`);
      return;
    }
    const busyWith = domain.caseCurrentEvent(item.id, excludeEventId, dateRange);
    if (busyWith) {
      errors.push(`Кейс «${item.name}» на эти даты уже занят мероприятием «${busyWith.title}» (${format.formatDate(busyWith.startsAt)} – ${format.formatDate(busyWith.endsAt)}).`);
    }
  });
  return errors;
}

// При пересохранении формы переносим отметки «уехало/приехало» со старых
// строк на новые по тому же ключу (equipmentId/caseId) — форма мероприятия
// меняет только состав и количества, а не статус перемещения.
function mergeEquipmentTransit(allocations, oldRows) {
  const oldByKey = new Map((oldRows || []).map((r) => [r.equipmentId, r]));
  return allocations.map((r) => {
    const old = oldByKey.get(r.equipmentId);
    return {
      equipmentId: r.equipmentId,
      quantity: r.quantity,
      departedAt: old ? old.departedAt || null : null,
      returnedAt: old ? old.returnedAt || null : null,
    };
  });
}

function mergeCaseTransit(caseIds, oldRows) {
  const oldByKey = new Map((oldRows || []).map((r) => [r.caseId, r]));
  return caseIds.map((id) => {
    const old = oldByKey.get(id);
    return {
      caseId: id,
      departedAt: old ? old.departedAt || null : null,
      returnedAt: old ? old.returnedAt || null : null,
    };
  });
}

function eventFormLocals(overrides) {
  return Object.assign(
    {
      title: 'Новое мероприятие',
      positions: store.all('positions'),
      venues: store.all('venues'),
      equipmentRows: [],
      caseRows: [],
      selectedCaseIds: new Set(),
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
  let arrivesAt = body.arrivesAt ? new Date(body.arrivesAt) : null;
  let departsAt = body.departsAt ? new Date(body.departsAt) : null;
  if (!arrivesAt || Number.isNaN(arrivesAt.getTime()) || arrivesAt < eventStart || arrivesAt > eventEnd) {
    arrivesAt = eventStart;
  }
  if (!departsAt || Number.isNaN(departsAt.getTime()) || departsAt > eventEnd || departsAt <= arrivesAt) {
    departsAt = eventEnd;
  }
  return { comment, arrivesAt: arrivesAt.toISOString(), departsAt: departsAt.toISOString() };
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

router.get('/new', requireAuth, requireStaff, (req, res) => {
  res.render('events/form', eventFormLocals({
    title: 'Новое мероприятие',
    equipmentRows: buildEquipmentRows(null, {}, null, new Set()),
    caseRows: buildCaseRows(null),
  }));
});

router.post('/', requireAuth, requireStaff, (req, res) => {
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

  const dateRange = dateRangeFromBody(req.body);
  const caseIds = parseCaseIds(req.body);
  const selectedCaseIds = new Set(caseIds);
  const equipmentAllocations = parseEquipmentAllocations(req.body);
  errors.push(...validateEquipmentAllocations(equipmentAllocations, null, dateRange, selectedCaseIds));
  errors.push(...validateCaseSelection(caseIds, null, dateRange));

  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    const requiredMap = {};
    requiredPositions.forEach((r) => { requiredMap[r.positionId] = r.count; });
    return res.status(400).render(
      'events/form',
      eventFormLocals({
        title: 'Новое мероприятие',
        form: req.body,
        requiredMap,
        equipmentRows: buildEquipmentRows(null, equipmentAllocationsMap(equipmentAllocations), dateRange, selectedCaseIds),
        caseRows: buildCaseRows(null, dateRange),
        selectedCaseIds,
      })
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
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    status: 'planned',
    requiredPositions,
    equipment: equipmentAllocations.map((r) => ({ ...r, departedAt: null, returnedAt: null })),
    cases: caseIds.map((id) => ({ caseId: id, departedAt: null, returnedAt: null })),
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
      equipmentRows: buildEquipmentRows(
        event.id,
        equipmentAllocationsMap(event.equipment || []),
        { startsAt: event.startsAt, endsAt: event.endsAt },
        new Set((event.cases || []).map((r) => r.caseId))
      ),
      caseRows: buildCaseRows(event.id, { startsAt: event.startsAt, endsAt: event.endsAt }),
      selectedCaseIds: new Set((event.cases || []).map((r) => r.caseId)),
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
  const errors = [];
  if (!title || !title.trim()) errors.push('Укажите название мероприятия.');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    errors.push('Время окончания должно быть позже времени начала.');
  }
  const requiredPositions = parseRequiredPositions(req.body);
  if (requiredPositions.length === 0) {
    errors.push('Укажите хотя бы одну требуемую должность и количество специалистов.');
  }

  const dateRange = dateRangeFromBody(req.body) || { startsAt: event.startsAt, endsAt: event.endsAt };
  const caseIds = parseCaseIds(req.body);
  const selectedCaseIds = new Set(caseIds);
  const equipmentAllocations = parseEquipmentAllocations(req.body);
  errors.push(...validateEquipmentAllocations(equipmentAllocations, event.id, dateRange, selectedCaseIds));
  errors.push(...validateCaseSelection(caseIds, event.id, dateRange));

  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    const requiredMap = {};
    requiredPositions.forEach((r) => { requiredMap[r.positionId] = r.count; });
    return res.status(400).render(
      'events/form',
      eventFormLocals({
        title: 'Редактирование мероприятия',
        event,
        form: req.body,
        requiredMap,
        equipmentRows: buildEquipmentRows(event.id, equipmentAllocationsMap(equipmentAllocations), dateRange, selectedCaseIds),
        caseRows: buildCaseRows(event.id, dateRange),
        selectedCaseIds,
      })
    );
  }

  // технического директора назначает только админ — заявку от тех.директора на смену назначения игнорируем
  const techDirectorId = req.currentUser.role === 'admin' ? parseTechDirectorId(req.body) : event.techDirectorId;
  const nextStatus = status || event.status;

  // Сохраняет отметки «уехало/приехало» со старых строк — эта форма меняет
  // только состав и количества, а не статус перемещения (см. /transit).
  const mergedEquipment = mergeEquipmentTransit(equipmentAllocations, event.equipment);
  const mergedCases = mergeCaseTransit(caseIds, event.cases);

  // Мероприятие закрывается/отменяется — если что-то отмечено «уехало», но
  // не «вернулось», это потеря: статус в каталоге автоматически — «Утеряно».
  const flaggedMissing = (nextStatus === 'completed' || nextStatus === 'cancelled')
    ? domain.flagUnreturnedAsMissing(mergedEquipment, mergedCases)
    : [];

  store.update('events', event.id, {
    title: title.trim(),
    description: (description || '').trim(),
    venueId: Number(venueId),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    status: nextStatus,
    requiredPositions,
    // Хранится независимо от статуса (история «что ехало») — в резерв идёт
    // только у запланированных мероприятий, см. equipmentAllocatedQuantity.
    equipment: mergedEquipment,
    cases: mergedCases,
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

// --- Отметки «уехало» / «приехало» — отслеживание перемещения оборудования и кейсов ---

function applyTransitAction(row, action) {
  if (action === 'depart') {
    row.departedAt = new Date().toISOString();
    row.returnedAt = null;
  } else if (action === 'arrive') {
    row.returnedAt = new Date().toISOString();
  } else if (action === 'reset') {
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

module.exports = router;
