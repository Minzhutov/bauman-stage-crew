'use strict';
const store = require('./store');
const { hashPassword } = require('./auth');

function inDays(days, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function seed() {
  if (store.all('users').length > 0) return; // уже наполнено

  console.log('[seed] База пуста — наполняю демо-данными…');

  // ---- Должности (специалисты), нужные и мероприятиям, и профилям ----
  const positionDefs = [
    ['Звукорежиссёр', 'Настройка и сведение звука на площадке'],
    ['Системный инженер', 'Настройка и сведение линейных массивов и акустики'],
    ['Техник по звуку', 'Коммутация звукового оборудования и микрофонов на площадке'],
    ['Художник по свету', 'Программирование и управление световым шоу'],
    ['Техник по свету', 'Монтаж, коммутация и фокусировка светового оборудования'],
    ['Пушкарь', 'Управление следящим прожектором (пушкой) по ходу шоу'],
    ['Видеоинженер / экранщик', 'LED-экраны, видеоконтент, трансляция'],
    ['Техник по экранам', 'Монтаж и обслуживание LED-экранов и проекционного оборудования'],
    ['Оператор', 'Съёмка мероприятия и трансляция в прямом эфире'],
    ['Режиссёр трансляции', 'Переключение камер и видеопотоков в прямом эфире'],
    ['Плэйбекер', 'Воспроизведение фонограмм и медиаконтента по партитуре шоу'],
    ['Dante-менеджер', 'Настройка и маршрутизация аудиосети Dante'],
    ['Риггер', 'Сборка, подвес и демонтаж сценических конструкций'],
    ['Монтировщик', 'Погрузка, монтаж и демонтаж оборудования'],
    ['Электрик', 'Силовая коммутация и электробезопасность площадки'],
    ['Пиротехник', 'Пиротехнические и спецэффекты'],
    ['Стейдж-менеджер', 'Координация команды и тайминга на площадке'],
    ['Бэклайн-техник', 'Обслуживание инструментов и бэклайн-оборудования'],
    ['Райдер-менеджер', 'Логистика и техническое сопровождение райдера'],
  ];
  const positions = positionDefs.map(([name, description]) =>
    store.insert('positions', { name, description })
  );
  const byName = (n) => positions.find((p) => p.name === n);

  // ---- Площадки ----
  ['БЗДК', 'Конгресс', 'Спектр', 'Бауманец', 'Нога', '417к', '2-й этаж ДК'].forEach((name) =>
    store.insert('venues', { name, address: '' })
  );

  // ---- Каталог ачивок ----
  [
    ['🚀', 'Первый запуск', 'Отработал(а) первое мероприятие в составе команды', 'events_completed', 1],
    ['🌟', 'Быстрый старт', 'Получил(а) первые 100 баллов', 'points_total', 100],
    ['🏆', 'Мастер смены', 'Отработал(а) 10 мероприятий', 'events_completed', 10],
    ['🎓', 'Наставник', 'Провёл(а) лекцию в Академии', null, null],
    ['🪐', 'Легенда тура', 'Отработал(а) 50 мероприятий', 'events_completed', 50],
    ['🛰️', 'Универсал', 'Освоил(а) три и более технических должности', 'positions_count', 3],
  ].forEach(([icon, name, description, autoRuleType, autoRuleThreshold]) =>
    store.insert('achievements', { icon, name, description, avatarFile: null, autoRuleType, autoRuleThreshold })
  );

  // ---- Пользователи ----
  const admin = store.insert('users', {
    email: 'minzhutov@gmail.com',
    passwordHash: hashPassword('changeme123'),
    fullName: 'Матвей Инжутов',
    phone: '+7 900 000-00-00',
    studyGroup: 'СМ3-72',
    bio: 'Producer & Co-founder BSC.',
    role: 'admin',
    positionIds: [byName('Стейдж-менеджер').id],
    createdAt: new Date().toISOString(),
  });

  const crewDefs = [
    ['Иван Петров', 'ivan.petrov@example.com', 'РК6-51', ['Звукорежиссёр', 'Бэклайн-техник']],
    ['Мария Соколова', 'maria.sokolova@example.com', 'СМ8-31', ['Художник по свету']],
    ['Дмитрий Орлов', 'dmitry.orlov@example.com', 'МТ4-21', ['Риггер', 'Монтировщик', 'Электрик']],
    ['Анна Кузнецова', 'anna.kuznetsova@example.com', 'ИУ5-42', ['Видеоинженер / экранщик']],
  ];
  const crew = crewDefs.map(([fullName, email, studyGroup, posNames]) =>
    store.insert('users', {
      email,
      passwordHash: hashPassword('changeme123'),
      fullName,
      phone: '',
      studyGroup,
      bio: '',
      role: 'user',
      positionIds: posNames.map((n) => byName(n).id),
      createdAt: new Date().toISOString(),
    })
  );

  // ---- Мероприятия ----
  // Список пуст по умолчанию — администраторы публикуют мероприятия сами.

  store.insert('pointsLog', {
    userId: crew[2].id,
    amount: 15,
    reason: 'Оперативная замена на монтаже',
    eventId: null,
    awardedBy: admin.id,
    awardedAt: inDays(-5, 9, 0),
  });
  store.insert('pointsLog', {
    userId: crew[0].id,
    amount: 20,
    reason: 'Активное участие в подготовке саундчека',
    eventId: null,
    awardedBy: admin.id,
    awardedAt: inDays(-1, 9, 0),
  });

  // ---- Академия (лекции) ----
  store.insert('academies', {
    title: 'Основы коммутации сценического звука',
    topic: 'Звук',
    description: 'Разбираем стандартные схемы коммутации, стейдж-боксы, цифровые снейки.',
    room: 'Учебный класс 1',
    speaker: 'Иван Петров',
    startsAt: inDays(3, 18, 0),
    endsAt: inDays(3, 19, 30),
    createdBy: admin.id,
    createdAt: new Date().toISOString(),
  });
  store.insert('academies', {
    title: 'Техника безопасности при монтаже сцены',
    topic: 'Безопасность',
    description: 'Обязательный инструктаж для всех новых монтировщиков и техников сцены.',
    room: 'Учебный класс 2',
    speaker: 'Дмитрий Орлов',
    startsAt: inDays(8, 17, 0),
    endsAt: inDays(8, 18, 0),
    createdBy: admin.id,
    createdAt: new Date().toISOString(),
  });
  const academyPast = store.insert('academies', {
    title: 'Работа с LED-экранами и медиасерверами',
    topic: 'Видео',
    description: 'Прошедшая лекция: настройка медиасервера, синхронизация с таймкодом шоу.',
    room: 'Учебный класс 1',
    speaker: 'Анна Кузнецова',
    startsAt: inDays(-7, 18, 0),
    endsAt: inDays(-7, 19, 30),
    createdBy: admin.id,
    createdAt: inDays(-10, 10, 0),
  });
  store.insert('pointsLog', {
    userId: crew[1].id, // Мария Соколова — посетила лекцию Анны
    amount: 10,
    reason: `Лекция: ${academyPast.title}`,
    eventId: null,
    academyId: academyPast.id,
    awardedBy: admin.id,
    awardedAt: inDays(-7, 20, 0),
  });

  // ---- Мануалы (без файла — просто заглушка-описание, файлы грузятся через форму) ----
  store.insert('manuals', {
    title: 'Регламент монтажа сцены (шаблон)',
    description:
      'Загрузите актуальный PDF/DOCX через форму ниже — это лишь пример карточки мануала.',
    fileName: null,
    originalName: null,
    mimeType: null,
    size: null,
    uploadedBy: admin.id,
    createdAt: new Date().toISOString(),
    placeholder: true,
  });

  store.persist();
  console.log('[seed] Готово. Администратор:', admin.email, '(пароль: changeme123)');
}

module.exports = { seed };
