'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const store = require('../lib/store');
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

router.get('/', (req, res) => {
  const manuals = store
    .all('manuals')
    .map(withUploader)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.render('manuals/list', { title: 'Мануалы', manuals });
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Не удалось загрузить файл.');
      return res.redirect('/manuals');
    }
    const { title, description } = req.body;
    if (!req.file) {
      req.flash('error', 'Выберите файл для загрузки.');
      return res.redirect('/manuals');
    }
    if (!title || !title.trim()) {
      fs.unlink(req.file.path, () => {});
      req.flash('error', 'Укажите название мануала.');
      return res.redirect('/manuals');
    }

    store.insert('manuals', {
      title: title.trim(),
      description: (description || '').trim(),
      fileName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.currentUser.id,
      createdAt: new Date().toISOString(),
      placeholder: false,
    });

    req.flash('success', 'Мануал загружен.');
    res.redirect('/manuals');
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
