'use strict';
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');

const store = require('./lib/store');
const { seed } = require('./lib/seed');
const { loadCurrentUser } = require('./lib/auth');
const format = require('./lib/format');
const domain = require('./lib/domain');

seed();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // за обратным прокси (nginx/Caddy)

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'bsc.sid',
    secret: process.env.SESSION_SECRET || 'bauman-stage-crew-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 дней
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto', // Secure только когда реально HTTPS, иначе (жёсткое true) кука пропадёт без прокси
    },
  })
);
app.use(flash());
app.use(loadCurrentUser);

// Доступно во всех шаблонах без явной передачи
app.locals.h = format;
app.locals.domain = domain;
app.locals.APP_NAME = 'Bauman Stage Crew';
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  // читаем flash перед самим рендером, а не здесь сразу — некоторые роуты
  // (/register и т.п.) рендерят без redirect, уже после req.flash('error', ...)
  const originalRender = res.render.bind(res);
  res.render = (view, options, callback) => {
    res.locals.successMessages = req.flash('success');
    res.locals.errorMessages = req.flash('error');
    originalRender(view, options, callback);
  };
  next();
});

app.use('/', require('./routes/home'));
app.use('/', require('./routes/auth'));
app.use('/events', require('./routes/events'));
app.use('/academies', require('./routes/academies'));
app.use('/manuals', require('./routes/manuals'));
app.use('/leaderboard', require('./routes/leaderboard'));
app.use('/profile', require('./routes/profile'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Страница не найдена' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('errors/500', {
    title: 'Ошибка сервера',
    message: process.env.NODE_ENV === 'production' ? null : err.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`Bauman Stage Crew запущен: http://localhost:${PORT}`);
});

// graceful shutdown для pm2/systemd
function shutdown(signal) {
  console.log(`[server] Получен ${signal}, завершаю работу...`);
  server.close(() => {
    console.log('[server] Сервер остановлен.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
