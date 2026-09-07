'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const store = require('../lib/store');
const domain = require('../lib/domain');
const { requireAuth, requireAdmin } = require('../lib/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'manuals');
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.rtf', '.zip', '.png', '.jpg', '.jpeg',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 МБ
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error('Недопустимый тип файла.'));
    }
    cb(null, true);
  },
});

function withUploader(m) {
  return Object.assign({}, m, { uploader: store.find('users', m.uploadedBy) });
}

function parseCategory(raw) {
  return domain.POSITION_CATEGORY_LABELS[raw] ? raw : 'other';
}

// Ссылки на видео — по одной в строке; строгую проверку на валидный URL
// не делаем (формой пользуются только админы), просто чистим пробелы и пустые строки.
function parseVideoLinks(raw) {
  return (raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

router.get('/', (req, res) => {
  const { category } = req.query;
  let manuals = store
    .all('manuals')
    .map(withUploader)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (category && category !== 'all') {
    manuals = manuals.filter((m) => (m.category || 'other') === category);
  }
  const categoryCounts = {};
  store.all('manuals').forEach((m) => {
    const key = m.category || 'other';
    categoryCounts[key] = (categoryCounts[key] || 0) + 1;
  });
  res.render('manuals/list', {
    title: 'Мануалы',
    manuals,
    categoryFilter: category && category !== 'all' ? category : '',
    categoryCounts,
    categoryOrder: domain.POSITION_CATEGORY_ORDER,
    categoryLabels: domain.POSITION_CATEGORY_LABELS,
  });
});

router.get('/new', requireAuth, requireAdmin, (req, res) => {
  res.render('manuals/form', {
    title: 'Новый мануал',
    form: {},
    categoryOrder: domain.POSITION_CATEGORY_ORDER,
    categoryLabels: domain.POSITION_CATEGORY_LABELS,
  });
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить файл.');
      return res.redirect('/manuals');
    }
    const { title, description, content, videoLinks, category } = req.body;
    const errors = [];
    if (!title || !title.trim()) errors.push('Укажите название мануала.');
    const links = parseVideoLinks(videoLinks);
    const hasContent = Boolean((content || '').trim());
    if (!req.file && !hasContent && !links.length) {
      errors.push('Добавьте хотя бы одно: файл, подробный текст или ссылку на видео.');
    }
    if (errors.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      errors.forEach((e) => req.flash('error', e));
      return res.status(400).render('manuals/form', {
        title: 'Новый мануал',
        form: req.body,
        categoryOrder: domain.POSITION_CATEGORY_ORDER,
        categoryLabels: domain.POSITION_CATEGORY_LABELS,
      });
    }

    const manual = store.insert('manuals', {
      title: title.trim(),
      description: (description || '').trim(),
      content: (content || '').trim(),
      videoLinks: links,
      category: parseCategory(category),
      fileName: req.file ? req.file.filename : null,
      originalName: req.file ? req.file.originalname : null,
      mimeType: req.file ? req.file.mimetype : null,
      size: req.file ? req.file.size : null,
      uploadedBy: req.currentUser.id,
      createdAt: new Date().toISOString(),
      placeholder: false,
    });

    req.flash('success', 'Мануал опубликован.');
    res.redirect(`/manuals/${manual.id}`);
  });
});

router.get('/:id', (req, res) => {
  const manual = store.find('manuals', req.params.id);
  if (!manual) {
    req.flash('error', 'Мануал не найден.');
    return res.redirect('/manuals');
  }
  res.render('manuals/detail', {
    title: manual.title,
    manual: withUploader(manual),
    categoryLabels: domain.POSITION_CATEGORY_LABELS,
  });
});

router.get('/:id/download', requireAuth, (req, res) => {
  const manual = store.find('manuals', req.params.id);
  if (!manual || !manual.fileName) {
    req.flash('error', 'Файл недоступен.');
    return res.redirect('/manuals');
  }
  const filePath = path.join(UPLOAD_DIR, manual.fileName);
  if (!fs.existsSync(filePath)) {
    req.flash('error', 'Файл не найден на сервере.');
    return res.redirect('/manuals');
  }
  res.download(filePath, manual.originalName || manual.fileName);
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const manual = store.find('manuals', req.params.id);
  if (!manual) {
    req.flash('error', 'Мануал не найден.');
    return res.redirect('/manuals');
  }
  if (manual.fileName) {
    const filePath = path.join(UPLOAD_DIR, manual.fileName);
    fs.unlink(filePath, () => {});
  }
  store.remove('manuals', manual.id);
  req.flash('success', 'Мануал удалён.');
  res.redirect('/manuals');
});

module.exports = router;
