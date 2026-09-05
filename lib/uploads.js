'use strict';
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function imageUpload(destDir, { maxSizeMB = 5 } = {}) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, destDir),
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
