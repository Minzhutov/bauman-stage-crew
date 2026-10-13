'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireStaff } = require('../lib/auth');
const { imageUpload } = require('../lib/uploads');

const router = express.Router();

// Раздел целиком — только для администраторов и технических директоров.
router.use(requireAuth, requireStaff);

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

router.get('/new', (req, res) => {
  res.render('equipment/form', equipmentFormLocals({ title: 'Новое оборудование' }));
});

router.post('/', (req, res) => {
  equipmentPhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить фото.');
      return res.redirect('/equipment/new');
    }
    const { name, categoryId, location, volume, weight, rackUnits, description, quantity } = req.body;
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
      description: (description || '').trim(),
      photoFile: req.file ? req.file.filename : null,
      createdAt: new Date().toISOString(),
    });
    req.flash('success', 'Оборудование добавлено в каталог.');
    res.redirect('/equipment');
  });
});

router.get('/:id/edit', (req, res) => {
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

router.put('/:id', (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  const { name, status, categoryId, location, volume, weight, rackUnits, description, quantity } = req.body;
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
    description: (description || '').trim(),
  });
  req.flash('success', `Оборудование «${name.trim()}» обновлено.`);
  res.redirect('/equipment');
});

// --- Категории оборудования (редактируемый каталог — не фиксированный список) ---

router.post('/categories', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название категории.');
    return res.redirect('/equipment');
  }
  store.insert('equipmentCategories', { name: name.trim() });
  req.flash('success', `Категория «${name.trim()}» добавлена.`);
  res.redirect('/equipment');
});

router.put('/categories/:id', (req, res) => {
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

router.delete('/categories/:id', (req, res) => {
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

router.post('/:id/photo', (req, res) => {
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

router.delete('/:id/photo', (req, res) => {
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

router.delete('/:id', (req, res) => {
  const item = store.find('equipment', req.params.id);
  if (!item) {
    req.flash('error', 'Оборудование не найдено.');
    return res.redirect('/equipment');
  }
  store.where('events', (e) => (e.equipment || []).some((r) => r.equipmentId === item.id)).forEach((e) => {
    store.update('events', e.id, { equipment: e.equipment.filter((r) => r.equipmentId !== item.id) });
  });
  store.where('cases', (c) => (c.items || []).some((r) => r.equipmentId === item.id)).forEach((c) => {
    store.update('cases', c.id, { items: c.items.filter((r) => r.equipmentId !== item.id) });
  });
  if (item.photoFile) fs.unlink(path.join(EQUIPMENT_PHOTO_DIR, item.photoFile), () => {});
  store.remove('equipment', item.id);
  req.flash('success', `Оборудование «${item.name}» удалено из каталога.`);
  res.redirect('/equipment');
});

// --- Кейсы (рэки, «гробы» на колёсах и т.п. — физические контейнеры) ---

function parseCaseItems(body) {
  const prefix = 'caseitem_';
  return Object.keys(body)
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({
      equipmentId: Number(key.slice(prefix.length)),
      quantity: parseInt(body[key], 10) || 0,
    }))
    .filter((r) => Number.isFinite(r.equipmentId) && r.quantity > 0);
}

function caseSelectedMap(items) {
  const map = {};
  (items || []).forEach((r) => { map[r.equipmentId] = r.quantity; });
  return map;
}

function caseFormLocals(overrides) {
  return Object.assign(
    {
      title: 'Новый кейс',
      item: null,
      form: {},
      stock: null,
      equipmentList: store.all('equipment'),
      selectedMap: {},
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
    .map((c) => domain.caseWithContents(c, null))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  res.render('equipment/cases', { title: 'Кейсы', cases });
});

router.get('/cases/new', (req, res) => {
  res.render('equipment/case_form', caseFormLocals({ title: 'Новый кейс' }));
});

router.post('/cases', (req, res) => {
  casePhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить фото.');
      return res.redirect('/equipment/cases/new');
    }
    const { name, type, location, capacity, weight, description } = req.body;
    const items = parseCaseItems(req.body);
    if (!name || !name.trim()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      req.flash('error', 'Укажите название кейса.');
      return res.status(400).render('equipment/case_form', caseFormLocals({ form: req.body, selectedMap: caseSelectedMap(items) }));
    }
    const validType = domain.CASE_TYPE_LABELS[type] ? type : 'other';
    store.insert('cases', {
      name: name.trim(),
      type: validType,
      status: 'available',
      location: (location || '').trim(),
      capacity: capacity !== undefined && capacity !== '' ? Number(capacity) : null,
      weight: weight !== undefined && weight !== '' ? Number(weight) : null,
      description: (description || '').trim(),
      items,
      photoFile: req.file ? req.file.filename : null,
      createdAt: new Date().toISOString(),
    });
    req.flash('success', 'Кейс добавлен в каталог.');
    res.redirect('/equipment/cases');
  });
});

router.get('/cases/:id/edit', (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  res.render('equipment/case_form', caseFormLocals({
    title: 'Редактирование кейса',
    item,
    form: item,
    selectedMap: caseSelectedMap(item.items),
    stock: domain.caseWithContents(item),
  }));
});

router.put('/cases/:id', (req, res) => {
  const item = store.find('cases', req.params.id);
  if (!item) {
    req.flash('error', 'Кейс не найден.');
    return res.redirect('/equipment/cases');
  }
  const { name, type, status, location, capacity, weight, description } = req.body;
  const items = parseCaseItems(req.body);
  if (!name || !name.trim()) {
    req.flash('error', 'Укажите название кейса.');
    return res.status(400).render('equipment/case_form', caseFormLocals({
      title: 'Редактирование кейса', item, form: req.body, selectedMap: caseSelectedMap(items),
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
    items,
  });
  req.flash('success', `Кейс «${name.trim()}» обновлён.`);
  res.redirect('/equipment/cases');
});

router.post('/cases/:id/photo', (req, res) => {
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

router.delete('/cases/:id/photo', (req, res) => {
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

router.delete('/cases/:id', (req, res) => {
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

// --- Комплекты: сводка кейсов и оборудования по всем мероприятиям ---
// Ничего не создаёт само — только собирает то, что уже указано в форме
// каждого мероприятия (вкладка «Мероприятия»), в одно место для склада.

router.get('/plans', (req, res) => {
  const events = store
    .all('events')
    .filter((e) => e.status === 'planned' && ((e.cases && e.cases.length) || (e.equipment && e.equipment.length)))
    .map((e) => domain.eventWithDetails(e))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  res.render('equipment/plans', { title: 'Комплекты', events });
});

module.exports = router;
