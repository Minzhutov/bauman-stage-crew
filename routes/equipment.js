'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const domain = require('../lib/domain');
const format = require('../lib/format');
const { requireAuth, requireStaff, requireContentStaff } = require('../lib/auth');
const { imageUpload } = require('../lib/uploads');

const router = express.Router();

// Раздел целиком виден администраторам, техническим директорам и
// наставникам (только просмотр) — наставники не проходят requireStaff,
// который ниже навешан отдельно на все мутирующие маршруты и формы.
router.use(requireAuth, requireContentStaff);

const EQUIPMENT_PHOTO_DIR = path.join(__dirname, '..', 'public', 'uploads', 'equipment');
const equipmentPhotoUpload = imageUpload(EQUIPMENT_PHOTO_DIR);

const CASE_PHOTO_DIR = path.join(__dirname, '..', 'public', 'uploads', 'cases');
const casePhotoUpload = imageUpload(CASE_PHOTO_DIR);

// --- Инвентарь ---

function parseQuantity(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseCategoryId(raw) {
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return null;
  return store.find('equipmentCategories', id) ? id : null;
}

// Текстовое поле «по строке на пункт» — для списков «Особенности»/«Описание»
// на карточке товара, без отдельного JS для динамического добавления строк.
function parseLines(raw) {
  return (raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function equipmentFormLocals(overrides) {
  return Object.assign(
    {
      title: 'Новое оборудование',
      item: null,
      form: {},
      stock: null,
      statusOrder: domain.EQUIPMENT_STATUS_ORDER,
      statusLabels: domain.EQUIPMENT_STATUS_LABELS,
      categories: domain.equipmentCategories(),
    },
    overrides
  );
}

router.get('/', (req, res) => {
  const { category } = req.query;
  const categoryId = category && category !== 'all' ? Number(category) : null;
  let equipment = store.all('equipment').map(domain.equipmentWithStock);
  if (categoryId) {
    equipment = equipment.filter((eq) => eq.categoryId === categoryId);
  }
  equipment.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const categories = domain.equipmentCategories();
  const categoryCounts = {};
  store.all('equipment').forEach((eq) => {
    const key = eq.categoryId || 'none';
    categoryCounts[key] = (categoryCounts[key] || 0) + 1;
  });
  const categoryUsage = {};
  categories.forEach((c) => {
    categoryUsage[c.id] = store.where('equipment', (eq) => eq.categoryId === c.id).length;
  });
  res.render('equipment/list', {
    title: 'Оборудование',
    equipment,
    categoryFilter: categoryId || '',
    categoryCounts,
    categories,
    categoryUsage,
  });
});

router.get('/new', requireStaff, (req, res) => {
  res.render('equipment/form', equipmentFormLocals({ title: 'Новое оборудование' }));
});

router.post('/', requireStaff, (req, res) => {
  equipmentPhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить фото.');
      return res.redirect('/equipment/new');
    }
    const { name, categoryId, location, volume, weight, rackUnits, dimensions, description, features, specs, quantity } = req.body;
    if (!name || !name.trim()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      req.flash('error', 'Укажите название оборудования.');
      return res.status(400).render('equipment/form', equipmentFormLocals({ form: req.body }));
    }
    store.insert('equipment', {
      name: name.trim(),
      status: 'available',
      categoryId: parseCategoryId(categoryId),
      location: (location || '').trim(),
      quantity: parseQuantity(quantity, 1),
      volume: volume !== undefined && volume !== '' ? Number(volume) : null,
      weight: weight !== undefined && weight !== '' ? Number(weight) : null,
      rackUnits: rackUnits !== undefined && rackUnits !== '' ? Number(rackUnits) : null,
      dimensions: (dimensions || '').trim() || null,
      description: (description || '').trim(),
      features: parseLines(features),
      specs: parseLines(specs),
      photoFile: req.file ? req.file.filename : null,
      createdAt: new Date().toISOString(),
    });
    req.flash('success', 'Оборудование добавлено в каталог.');
    res.redirect('/equipment');
  });
});

router.get('/:id/edit', requireStaff, (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  res.render('equipment/form', equipmentFormLocals({
    title: 'Редактирование оборудования',
    item,
    form: item,
    stock: domain.equipmentWithStock(item),
  }));
});

router.put('/:id', requireStaff, (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  const { name, status, categoryId, location, volume, weight, rackUnits, dimensions, description, features, specs, quantity } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название оборудования.');
    return res.status(400).render('equipment/form', equipmentFormLocals({ title: 'Редактирование оборудования', item, form: req.body }));
  }
  const validStatus = domain.EQUIPMENT_STATUS_LABELS[status] ? status : item.status;
  store.update('equipment', item.id, {
    name: name.trim(),
    status: validStatus,
    categoryId: parseCategoryId(categoryId),
    location: (location || '').trim(),
    quantity: parseQuantity(quantity, item.quantity),
    volume: volume !== undefined && volume !== '' ? Number(volume) : null,
    weight: weight !== undefined && weight !== '' ? Number(weight) : null,
    rackUnits: rackUnits !== undefined && rackUnits !== '' ? Number(rackUnits) : null,
    dimensions: (dimensions || '').trim() || null,
    description: (description || '').trim(),
    features: parseLines(features),
    specs: parseLines(specs),
  });
  req.flash('success', `Оборудование «${name.trim()}» обновлено.`);
  res.redirect('/equipment');
});

// Быстрая смена статуса в один клик — прямо с карточки в списке, без перехода
// в полную форму редактирования (напр. вручную занять дибокс под внезапную
// задачу — сразу становится недоступным для бронирования на мероприятия).
router.put('/:id/status', requireStaff, (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  const { status } = req.body;
  if (!domain.EQUIPMENT_STATUS_LABELS[status]) {
    req.flash('error', 'Неизвестный статус.');
    return res.redirect(req.get('Referrer') || '/equipment');
  }
  store.update('equipment', item.id, { status });
  req.flash('success', `Статус «${item.name}»: ${domain.EQUIPMENT_STATUS_LABELS[status].toLowerCase()}.`);
  res.redirect(req.get('Referrer') || '/equipment');
});

// --- Категории оборудования (редактируемый каталог — не фиксированный список) ---

router.post('/categories', requireStaff, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название категории.');
    return res.redirect('/equipment');
  }
  store.insert('equipmentCategories', { name: name.trim() });
  req.flash('success', `Категория «${name.trim()}» добавлена.`);
  res.redirect('/equipment');
});

router.put('/categories/:id', requireStaff, (req, res) => {
  const cat = store.find('equipmentCategories', req.params.id);
  if (!cat) {
    req.flash('error', 'Категория не найдена.');
    return res.redirect('/equipment');
  }
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название категории.');
    return res.redirect('/equipment');
  }
  store.update('equipmentCategories', cat.id, { name: name.trim() });
  req.flash('success', `Категория «${name.trim()}» обновлена.`);
  res.redirect('/equipment');
});

router.delete('/categories/:id', requireStaff, (req, res) => {
  const cat = store.find('equipmentCategories', req.params.id);
  if (!cat) {
    req.flash('error', 'Категория не найдена.');
    return res.redirect('/equipment');
  }
  const usedCount = store.where('equipment', (eq) => eq.categoryId === cat.id).length;
  if (usedCount > 0) {
    req.flash('error', `Нельзя удалить категорию «${cat.name}»: назначена ${usedCount} позициям оборудования. Сначала смените им категорию.`);
    return res.redirect('/equipment');
  }
  store.remove('equipmentCategories', cat.id);
  req.flash('success', `Категория «${cat.name}» удалена.`);
  res.redirect('/equipment');
});

router.post('/:id/photo', requireStaff, (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  equipmentPhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить фото.');
      return res.redirect(`/equipment/${item.id}/edit`);
    }
    if (!req.file) {
      req.flash('error', 'Файл не выбран.');
      return res.redirect(`/equipment/${item.id}/edit`);
    }
    if (item.photoFile) fs.unlink(path.join(EQUIPMENT_PHOTO_DIR, item.photoFile), () => {});
    store.update('equipment', item.id, { photoFile: req.file.filename });
    req.flash('success', 'Фото обновлено.');
    res.redirect(`/equipment/${item.id}/edit`);
  });
});

router.delete('/:id/photo', requireStaff, (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  if (item.photoFile) {
    fs.unlink(path.join(EQUIPMENT_PHOTO_DIR, item.photoFile), () => {});
    store.update('equipment', item.id, { photoFile: null });
  }
  req.flash('success', 'Фото удалено.');
  res.redirect(`/equipment/${item.id}/edit`);
});

router.delete('/:id', requireStaff, (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  store.where('events', (e) => (e.equipment || []).some((r) => r.equipmentId === item.id)).forEach((e) => {
    store.update('events', e.id, { equipment: e.equipment.filter((r) => r.equipmentId !== item.id) });
  });
  store.where('events', (e) => (e.cases || []).some((r) => (r.items || []).some((i) => i.equipmentId === item.id))).forEach((e) => {
    store.update('events', e.id, {
      cases: e.cases.map((r) => Object.assign({}, r, { items: (r.items || []).filter((i) => i.equipmentId !== item.id) })),
    });
  });
  if (item.photoFile) fs.unlink(path.join(EQUIPMENT_PHOTO_DIR, item.photoFile), () => {});
  store.remove('equipment', item.id);
  req.flash('success', `Оборудование «${item.name}» удалено из каталога.`);
  res.redirect('/equipment');
});

// --- Кейсы (рэки, «гробы» на колёсах и т.п. — пустые физические контейнеры;
// что в них упаковано — свойство привязки к конкретному мероприятию, см.
// раздел «Комплекты» ниже) ---

function caseFormLocals(overrides) {
  return Object.assign(
    {
      title: 'Новый кейс',
      item: null,
      form: {},
      stock: null,
      typeOrder: domain.CASE_TYPE_ORDER,
      typeLabels: domain.CASE_TYPE_LABELS,
      statusOrder: domain.EQUIPMENT_STATUS_ORDER,
      statusLabels: domain.EQUIPMENT_STATUS_LABELS,
    },
    overrides
  );
}

router.get('/cases', (req, res) => {
  const cases = store
    .all('cases')
    .map((c) => domain.caseWithAvailability(c, null))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  res.render('equipment/cases', { title: 'Кейсы', cases });
});

router.get('/cases/new', requireStaff, (req, res) => {
  res.render('equipment/case_form', caseFormLocals({ title: 'Новый кейс' }));
});

router.post('/cases', requireStaff, (req, res) => {
  casePhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить фото.');
      return res.redirect('/equipment/cases/new');
    }
    const { name, type, location, capacity, weight, description } = req.body;
    if (!name || !name.trim()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      req.flash('error', 'Укажите название кейса.');
      return res.status(400).render('equipment/case_form', caseFormLocals({ form: req.body }));
    }
    const validType = domain.CASE_TYPE_LABELS[type] ? type : 'rack';
    store.insert('cases', {
      name: name.trim(),
      type: validType,
      status: 'available',
      location: (location || '').trim(),
      capacity: capacity !== undefined && capacity !== '' ? Number(capacity) : null,
      weight: weight !== undefined && weight !== '' ? Number(weight) : null,
      description: (description || '').trim(),
      photoFile: req.file ? req.file.filename : null,
      createdAt: new Date().toISOString(),
    });
    req.flash('success', 'Кейс добавлен в каталог.');
    res.redirect('/equipment/cases');
  });
});

router.get('/cases/:id/edit', requireStaff, (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  res.render('equipment/case_form', caseFormLocals({
    title: 'Редактирование кейса',
    item,
    form: item,
    stock: domain.caseWithAvailability(item),
  }));
});

router.put('/cases/:id', requireStaff, (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  const { name, type, status, location, capacity, weight, description } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название кейса.');
    return res.status(400).render('equipment/case_form', caseFormLocals({
      title: 'Редактирование кейса', item, form: req.body,
    }));
  }
  const validType = domain.CASE_TYPE_LABELS[type] ? type : item.type;
  const validStatus = domain.EQUIPMENT_STATUS_LABELS[status] ? status : item.status;
  store.update('cases', item.id, {
    name: name.trim(),
    type: validType,
    status: validStatus,
    location: (location || '').trim(),
    capacity: capacity !== undefined && capacity !== '' ? Number(capacity) : null,
    weight: weight !== undefined && weight !== '' ? Number(weight) : null,
    description: (description || '').trim(),
  });
  req.flash('success', `Кейс «${name.trim()}» обновлён.`);
  res.redirect('/equipment/cases');
});

// Быстрая смена статуса в один клик — та же логика, что и у оборудования.
router.put('/cases/:id/status', requireStaff, (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  const { status } = req.body;
  if (!domain.EQUIPMENT_STATUS_LABELS[status]) {
    req.flash('error', 'Неизвестный статус.');
    return res.redirect(req.get('Referrer') || '/equipment/cases');
  }
  store.update('cases', item.id, { status });
  req.flash('success', `Статус «${item.name}»: ${domain.EQUIPMENT_STATUS_LABELS[status].toLowerCase()}.`);
  res.redirect(req.get('Referrer') || '/equipment/cases');
});

router.post('/cases/:id/photo', requireStaff, (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  casePhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить фото.');
      return res.redirect(`/equipment/cases/${item.id}/edit`);
    }
    if (!req.file) {
      req.flash('error', 'Файл не выбран.');
      return res.redirect(`/equipment/cases/${item.id}/edit`);
    }
    if (item.photoFile) fs.unlink(path.join(CASE_PHOTO_DIR, item.photoFile), () => {});
    store.update('cases', item.id, { photoFile: req.file.filename });
    req.flash('success', 'Фото обновлено.');
    res.redirect(`/equipment/cases/${item.id}/edit`);
  });
});

router.delete('/cases/:id/photo', requireStaff, (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  if (item.photoFile) {
    fs.unlink(path.join(CASE_PHOTO_DIR, item.photoFile), () => {});
    store.update('cases', item.id, { photoFile: null });
  }
  req.flash('success', 'Фото удалено.');
  res.redirect(`/equipment/cases/${item.id}/edit`);
});

router.delete('/cases/:id', requireStaff, (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  store.where('events', (e) => (e.cases || []).some((r) => r.caseId === item.id)).forEach((e) => {
    store.update('events', e.id, { cases: e.cases.filter((r) => r.caseId !== item.id) });
  });
  if (item.photoFile) fs.unlink(path.join(CASE_PHOTO_DIR, item.photoFile), () => {});
  store.remove('cases', item.id);
  req.flash('success', `Кейс «${item.name}» удалён из каталога.`);
  res.redirect('/equipment/cases');
});

// --- Комплекты: сборка оборудования и кейсов под конкретное мероприятие ---
// В отличие от старой схемы, где состав кейса был общим свойством каталога,
// здесь для каждого мероприятия отдельно выбираются кейсы и указывается, что
// именно в них упаковано — один и тот же кейс может иметь разный состав на
// разных мероприятиях. Отдельное (не в кейсе) оборудование — тоже здесь.

function parseLooseEquipment(body) {
  // "equipment_<id>", а не "equipment[<id>]" — иначе qs схлопывает id в массив
  const prefix = 'equipment_';
  return Object.keys(body)
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({
      equipmentId: Number(key.slice(prefix.length)),
      quantity: parseInt(body[key], 10) || 0,
    }))
    .filter((r) => Number.isFinite(r.equipmentId) && r.quantity > 0);
}

function parseCaseIds(body) {
  const raw = body.caseIds;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((v) => Number(v)).filter((id) => Number.isFinite(id));
}

// "caseitem_<caseId>_<equipmentId>" → Map<caseId, [{equipmentId, quantity}]>
function parseCaseContents(body) {
  const prefix = 'caseitem_';
  const byCaseId = new Map();
  Object.keys(body)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => {
      const rest = key.slice(prefix.length);
      const sep = rest.indexOf('_');
      if (sep < 0) return;
      const caseId = Number(rest.slice(0, sep));
      const equipmentId = Number(rest.slice(sep + 1));
      const quantity = parseInt(body[key], 10) || 0;
      if (!Number.isFinite(caseId) || !Number.isFinite(equipmentId) || quantity <= 0) return;
      if (!byCaseId.has(caseId)) byCaseId.set(caseId, []);
      byCaseId.get(caseId).push({ equipmentId, quantity });
    });
  return byCaseId;
}

function equipmentAllocationsMap(allocations) {
  const map = {};
  allocations.forEach((r) => { map[r.equipmentId] = r.quantity; });
  return map;
}

// Сам кейс занят/свободен на эти даты (статус каталога + пересечение с чужим
// мероприятием) — не путать с проверкой того, что в него напихали (ниже).
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

// Суммарно по комплекту (отдельное оборудование + всё, что упаковано в
// выбранные кейсы) каждая позиция не должна запрашиваться больше, чем
// доступно на складе на даты мероприятия — иначе те же физические единицы
// случайно попадут и в один кейс, и в другой, и/или отдельной строкой.
function validateKitAllocations(event, dateRange, looseAllocations, caseContentsByCaseId, selectedCaseIds) {
  const totals = new Map();
  looseAllocations.forEach((r) => totals.set(r.equipmentId, (totals.get(r.equipmentId) || 0) + r.quantity));
  selectedCaseIds.forEach((caseId) => {
    (caseContentsByCaseId.get(caseId) || []).forEach((r) => {
      totals.set(r.equipmentId, (totals.get(r.equipmentId) || 0) + r.quantity);
    });
  });
  const errors = [];
  totals.forEach((quantity, equipmentId) => {
    const item = store.find('equipment', equipmentId);
    if (!item) return;
    const available = domain.equipmentAvailableQuantity(item, event.id, dateRange);
    if (quantity > available) {
      errors.push(`«${item.name}»: в сумме по комплекту (кейсы + отдельно) запрошено ${quantity}, доступно на складе ${available}.`);
    }
  });
  return errors;
}

// Сохраняет отметки «собрано/уехало/приехало» со старых строк при пересохранении.
function mergeEquipmentTransit(allocations, oldRows) {
  const oldByKey = new Map((oldRows || []).map((r) => [r.equipmentId, r]));
  return allocations.map((r) => {
    const old = oldByKey.get(r.equipmentId);
    return {
      equipmentId: r.equipmentId,
      quantity: r.quantity,
      confirmedAt: old ? old.confirmedAt || null : null,
      departedAt: old ? old.departedAt || null : null,
      returnedAt: old ? old.returnedAt || null : null,
    };
  });
}

function buildKitCaseRows(event, dateRange, overrideSelectedCaseIds, overrideContentsByCaseId) {
  const existingByCaseId = new Map((event.cases || []).map((r) => [r.caseId, r]));
  return store
    .all('cases')
    .map((c) => {
      const existingRow = existingByCaseId.get(c.id);
      const selected = overrideSelectedCaseIds ? overrideSelectedCaseIds.has(c.id) : Boolean(existingRow);
      const rawItems = overrideContentsByCaseId
        ? (overrideContentsByCaseId.get(c.id) || [])
        : (existingRow ? existingRow.items : []);
      const info = domain.caseContentsInfo(c, rawItems);
      const selectedMap = {};
      (rawItems || []).forEach((r) => { selectedMap[r.equipmentId] = r.quantity; });
      return Object.assign(
        {},
        domain.caseWithAvailability(c, event.id, dateRange),
        info,
        { selected, selectedMap, transit: existingRow ? domain.transitStatus(existingRow) : null }
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function buildKitEquipmentRows(event, dateRange, overrideSelectedMap) {
  const existingByEquipmentId = new Map((event.equipment || []).map((r) => [r.equipmentId, r]));
  const selectedLoose = overrideSelectedMap || equipmentAllocationsMap(event.equipment || []);
  return store
    .all('equipment')
    .map((item) => {
      const existingRow = existingByEquipmentId.get(item.id);
      return {
        item,
        selected: selectedLoose[item.id] || 0,
        baseAvailable: domain.equipmentAvailableQuantity(item, event.id, dateRange),
        transit: existingRow ? domain.transitStatus(existingRow) : null,
      };
    });
}

router.get('/plans', (req, res) => {
  const events = store
    .all('events')
    .filter((e) => e.status === 'planned')
    .map((e) => domain.eventWithDetails(e))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  res.render('equipment/plans', { title: 'Комплекты', events });
});

router.get('/plans/:eventId', (req, res) => {
  const event = store.find('events', req.params.eventId);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/equipment/plans');
  }
  const dateRange = { startsAt: event.startsAt, endsAt: event.endsAt };
  res.render('equipment/plan_form', {
    title: `Комплект: ${event.title}`,
    event,
    equipmentRows: buildKitEquipmentRows(event, dateRange),
    caseRows: buildKitCaseRows(event, dateRange),
  });
});

router.put('/plans/:eventId', requireStaff, (req, res) => {
  const event = store.find('events', req.params.eventId);
  if (!event) {
    req.flash('error', 'Мероприятие не найдено.');
    return res.redirect('/equipment/plans');
  }
  const dateRange = { startsAt: event.startsAt, endsAt: event.endsAt };
  const caseIds = parseCaseIds(req.body);
  const selectedCaseIds = new Set(caseIds);
  const looseAllocations = parseLooseEquipment(req.body);
  const caseContentsByCaseId = parseCaseContents(req.body);

  const errors = [
    ...validateCaseSelection(caseIds, event.id, dateRange),
    ...validateKitAllocations(event, dateRange, looseAllocations, caseContentsByCaseId, selectedCaseIds),
  ];

  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    return res.status(400).render('equipment/plan_form', {
      title: `Комплект: ${event.title}`,
      event,
      equipmentRows: buildKitEquipmentRows(event, dateRange, equipmentAllocationsMap(looseAllocations)),
      caseRows: buildKitCaseRows(event, dateRange, selectedCaseIds, caseContentsByCaseId),
    });
  }

  const mergedEquipment = mergeEquipmentTransit(looseAllocations, event.equipment);
  const oldCasesByCaseId = new Map((event.cases || []).map((r) => [r.caseId, r]));
  const mergedCases = caseIds.map((id) => {
    const old = oldCasesByCaseId.get(id);
    return {
      caseId: id,
      items: caseContentsByCaseId.get(id) || [],
      confirmedAt: old ? old.confirmedAt || null : null,
      departedAt: old ? old.departedAt || null : null,
      returnedAt: old ? old.returnedAt || null : null,
    };
  });

  store.update('events', event.id, { equipment: mergedEquipment, cases: mergedCases });
  req.flash('success', 'Комплект обновлён.');
  res.redirect(`/equipment/plans/${event.id}`);
});

// --- Карточка товара (подробное описание оборудования) ---
// Регистрируется последним среди GET-маршрутов этого раздела: /:id — общий
// шаблон из одного сегмента, и его нельзя регистрировать раньше литеральных
// путей того же вида (/new, /cases, /plans) — иначе он их перехватит.

router.get('/:id', (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  res.render('equipment/show', {
    title: item.name,
    item: domain.equipmentWithStock(item),
  });
});

module.exports = router;
