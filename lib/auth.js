'use strict';
const bcrypt = require('bcryptjs');
const store = require('./store');

const SALT_ROUNDS = 10;

function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

function verifyPassword(password, hash) {
  try {
    return bcrypt.compareSync(password, hash);
  } catch (err) {
    return false;
  }
}

function loadCurrentUser(req, res, next) {
  req.currentUser = null;
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = store.find('users', req.session.userId);
    if (user) {
      req.currentUser = user;
      res.locals.currentUser = user;
    } else {
      req.session.userId = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'Сначала войдите в систему.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    req.flash('error', 'Раздел доступен только администраторам.');
    return res.redirect(req.get('Referrer') || '/');
  }
  next();
}

// «Технический директор» — операционная роль между участником и админом:
// может публиковать мероприятия и лекции Академии и начислять баллы, но не
// управляет каталогами (должности/площадки/ачивки/сезоны) и ролями пользователей.
const ROLE_LABELS = {
  user: 'Участник команды',
  tech_director: 'Технический директор',
  admin: 'Администратор',
};
const STAFF_ROLES = new Set(['admin', 'tech_director']);

function isStaff(user) {
  return Boolean(user && STAFF_ROLES.has(user.role));
}

function requireStaff(req, res, next) {
  if (!isStaff(req.currentUser)) {
    req.flash('error', 'Раздел доступен администраторам и техническим директорам.');
    return res.redirect(req.get('Referrer') || '/');
  }
  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.currentUser) return res.redirect('/');
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  loadCurrentUser,
  requireAuth,
  requireAdmin,
  requireStaff,
  isStaff,
  ROLE_LABELS,
  redirectIfAuthenticated,
};
