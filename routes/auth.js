'use strict';
const express = require('express');
const crypto = require('crypto');
const store = require('../lib/store');
const mailer = require('../lib/mailer');
const { hashPassword, verifyPassword, redirectIfAuthenticated } = require('../lib/auth');

const router = express.Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 час

function findUserByValidResetToken(token) {
  if (!token) return null;
  return (
    store.all('users').find(
      (u) => u.resetToken === token && u.resetTokenExpiry && new Date(u.resetTokenExpiry) > new Date()
    ) || null
  );
}

function defaultPositionIds() {
  const montirovshchik = store.where('positions', (p) => p.name === 'Монтировщик')[0];
  return montirovshchik ? [montirovshchik.id] : [];
}

router.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('auth/register', { title: 'Регистрация', form: {} });
});

router.post('/register', redirectIfAuthenticated, (req, res) => {
  const { email, password, passwordConfirm, fullName, phone, studyGroup } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const errors = [];

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    errors.push('Введите корректный email.');
  }
  if (!fullName || fullName.trim().length < 2) {
    errors.push('Укажите имя и фамилию.');
  }
  if (!studyGroup || !studyGroup.trim()) {
    errors.push('Укажите учебную группу.');
  }
  if (!password || password.length < 6) {
    errors.push('Пароль должен быть не короче 6 символов.');
  }
  if (password !== passwordConfirm) {
    errors.push('Пароли не совпадают.');
  }
  if (cleanEmail && store.where('users', (u) => u.email === cleanEmail).length > 0) {
    errors.push('Пользователь с таким email уже зарегистрирован.');
  }

  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    return res.status(400).render('auth/register', {
      title: 'Регистрация',
      form: { email, fullName, phone, studyGroup },
    });
  }

  const isFirstUser = store.all('users').length === 0;
  const user = store.insert('users', {
    email: cleanEmail,
    passwordHash: hashPassword(password),
    fullName: fullName.trim(),
    phone: (phone || '').trim(),
    studyGroup: studyGroup.trim(),
    bio: '',
    role: isFirstUser ? 'admin' : 'user',
    positionIds: defaultPositionIds(),
    createdAt: new Date().toISOString(),
  });

  req.session.userId = user.id;
  req.flash(
    'success',
    isFirstUser
      ? 'Регистрация завершена. Вы — первый пользователь и назначены администратором.'
      : 'Регистрация завершена. Добро пожаловать в команду!'
  );
  res.redirect('/');
});

router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('auth/login', { title: 'Вход', form: {} });
});

router.post('/login', redirectIfAuthenticated, (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const user = store.where('users', (u) => u.email === cleanEmail)[0];

  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    req.flash('error', 'Неверный email или пароль.');
    return res.status(401).render('auth/login', { title: 'Вход', form: { email } });
  }

  req.session.userId = user.id;
  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  req.flash('success', `С возвращением, ${user.fullName}!`);
  res.redirect(returnTo || '/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// --- Восстановление пароля по email ---

router.get('/forgot-password', redirectIfAuthenticated, (req, res) => {
  res.render('auth/forgot_password', { title: 'Восстановление пароля', form: {} });
});

router.post('/forgot-password', redirectIfAuthenticated, async (req, res) => {
  const cleanEmail = (req.body.email || '').trim().toLowerCase();

  if (!cleanEmail) {
    req.flash('error', 'Введите email.');
    return res.status(400).render('auth/forgot_password', {
      title: 'Восстановление пароля',
      form: { email: cleanEmail },
    });
  }

  // не палим, зарегистрирован ли email — сообщение одинаковое в любом случае
  const user = store.where('users', (u) => u.email === cleanEmail)[0];
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    store.update('users', user.id, {
      resetToken: token,
      resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
    });
    const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
    await mailer.sendMail({
      to: user.email,
      subject: 'Bauman Stage Crew — сброс пароля',
      text:
        `Здравствуйте, ${user.fullName}!\n\n` +
        'Вы (или кто-то другой) запросили сброс пароля для аккаунта на портале Bauman Stage Crew.\n\n' +
        `Ссылка для установки нового пароля (действительна 1 час):\n${resetLink}\n\n` +
        'Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.',
    });
  }

  req.flash('success', 'Если такой email зарегистрирован на портале, на него отправлена ссылка для сброса пароля.');
  res.redirect('/login');
});

router.get('/reset-password/:token', redirectIfAuthenticated, (req, res) => {
  const user = findUserByValidResetToken(req.params.token);
  if (!user) {
    req.flash('error', 'Ссылка для сброса пароля недействительна или устарела. Запросите новую.');
    return res.redirect('/forgot-password');
  }
  res.render('auth/reset_password', { title: 'Новый пароль', token: req.params.token });
});

router.post('/reset-password/:token', redirectIfAuthenticated, (req, res) => {
  const user = findUserByValidResetToken(req.params.token);
  if (!user) {
    req.flash('error', 'Ссылка для сброса пароля недействительна или устарела. Запросите новую.');
    return res.redirect('/forgot-password');
  }

  const { password, passwordConfirm } = req.body;
  const errors = [];
  if (!password || password.length < 6) errors.push('Пароль должен быть не короче 6 символов.');
  if (password !== passwordConfirm) errors.push('Пароли не совпадают.');

  if (errors.length) {
    errors.forEach((e) => req.flash('error', e));
    return res.status(400).render('auth/reset_password', { title: 'Новый пароль', token: req.params.token });
  }

  store.update('users', user.id, {
    passwordHash: hashPassword(password),
    resetToken: null,
    resetTokenExpiry: null,
  });
  req.flash('success', 'Пароль обновлён. Теперь можно войти с новым паролем.');
  res.redirect('/login');
});

module.exports = router;
