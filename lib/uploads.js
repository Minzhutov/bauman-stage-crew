'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function imageUpload(destDir, { maxSizeMB = 5 } = {}) {
  // На проде папка может не существовать на диске (пересборка контейнера,
  // примонтированный поверх public/uploads пустой volume и т.п.) — multer
  // сам её не создаёт и падает с ENOENT прямо при записи файла.
  fs.mkdirSync(destDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(destDir, { recursive: true });
        cb(null, destDir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: maxSizeMB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!IMAGE_EXT.has(ext)) return cb(new Error('Недопустимый формат изображения.'));
      cb(null, true);
    },
  });
}

module.exports = { imageUpload, IMAGE_EXT };
