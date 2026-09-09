'use strict';
const store = require('./store');
const { hashPassword } = require('./auth');

function inDays(days, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const monthNameFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

function monthSeason(offset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59);
  const name = monthNameFormatter.format(start).replace(/\s*г\.$/, '');
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

function seed() {
  if (store.all('users').length > 0) return; // уже наполнено

  console.log('[seed] База пуста — наполняю демо-данными…');

  // ---- Должности (специалисты), нужные и мероприятиям, и профилям ----
  const positionDefs = [
    ['Звукорежиссёр', 'Настройка и сведение звука на площадке', 'sound'],
    ['Системный инженер', 'Настройка и сведение линейных массивов и акустики', 'sound'],
    ['Плэйбекер', 'Воспроизведение фонограмм и медиаконтента по партитуре шоу', 'sound'],
    ['Dante-менеджер', 'Настройка и маршрутизация аудиосети Dante', 'sound'],
    ['DJ', 'Диджей-сет и музыкальное сопровождение мероприятия', 'dj'],
    ['Художник по свету', 'Программирование и управление световым шоу', 'light'],
    ['Оператор пушки', 'Управление следящим прожектором (пушкой) по ходу шоу', 'light'],
    ['Видеоинженер / экранщик', 'LED-экраны, видеоконтент, трансляция', 'screens'],
    ['Оператор', 'Съёмка мероприятия и трансляция в прямом эфире', 'broadcast'],
    ['Режиссёр трансляции', 'Переключение камер и видеопотоков в прямом эфире', 'broadcast'],
    ['Риггер', 'Сборка, подвес и демонтаж сценических конструкций', 'stage'],
    ['Техник', 'Базовая техническая должность — назначается всем новым участникам по умолчанию', 'stage'],
    ['Электрик', 'Силовая коммутация и электробезопасность площадки', 'stage'],
    ['Пиротехник', 'Пиротехнические и спецэффекты', 'stage'],
    ['Бэклайн-техник', 'Обслуживание инструментов и бэклайн-оборудования', 'stage'],
    ['Стейдж-менеджер', 'Координация команды и тайминга на площадке', 'management'],
    ['Райдер-менеджер', 'Логистика и техническое сопровождение райдера', 'management'],
  ];
  const positions = positionDefs.map(([name, description, category]) =>
    store.insert('positions', { name, description, category })
  );
  const byName = (n) => positions.find((p) => p.name === n);

  // ---- Площадки ----
  ['БЗДК', 'Конгресс', 'Спектр', 'Бауманец', 'Нога', '417к', '2-й этаж ДК'].forEach((name) =>
    store.insert('venues', { name, address: '' })
  );

  // ---- Каталог ачивок ----
  // levels[] — лестница уровней (редкость + порог для авто-ачивок); при
  // достижении следующего порога ачивка апгрейдится, а не выдаётся заново.
  const achievementDefs = [
    {
      name: 'Мастер смены',
      description: 'Отрабатывает мероприятия в составе команды — чем больше закрытых смен, тем выше уровень.',
      autoRuleType: 'events_completed',
      levels: [
        { rarity: 'common', threshold: 1, icon: '🥉', avatarFile: null },
        { rarity: 'rare', threshold: 10, icon: '🥈', avatarFile: null },
        { rarity: 'epic', threshold: 30, icon: '🥇', avatarFile: null },
        { rarity: 'legendary', threshold: 50, icon: '💎', avatarFile: null },
      ],
    },
    {
      name: 'Универсал',
      description: 'Осваивает всё больше технических должностей в профиле.',
      autoRuleType: 'positions_count',
      levels: [
        { rarity: 'common', threshold: 3, icon: '🛰️', avatarFile: null },
        { rarity: 'rare', threshold: 6, icon: '🛰️', avatarFile: null },
        { rarity: 'epic', threshold: 10, icon: '🛰️', avatarFile: null },
      ],
    },
    {
      name: 'Быстрый старт',
      description: 'Получил(а) первые 100 баллов.',
      autoRuleType: 'points_total',
      levels: [{ rarity: 'rare', threshold: 100, icon: '🌟', avatarFile: null }],
    },
    {
      name: 'Завсегдатай Академии',
      description: 'Начислены баллы за посещение трёх и более лекций Академии.',
      autoRuleType: 'academies_attended',
      levels: [{ rarity: 'rare', threshold: 3, icon: '📚', avatarFile: null }],
    },
    {
      name: 'Наставник',
      description: 'Провёл(а) лекцию в Академии — присваивается администратором вручную.',
      autoRuleType: null,
      levels: [{ rarity: 'epic', threshold: null, icon: '🎓', avatarFile: null }],
    },
  ];
  achievementDefs.forEach((a) => store.insert('achievements', a));

  // ---- Пользователи ----
  const admin = store.insert('users', {
    email: 'minzhutov@gmail.com',
    passwordHash: hashPassword('Bauman2025!'),
    fullName: 'Матвей Инжутов',
    phone: '+7 900 000-00-00',
    telegram: 'minzhutov',
    studyGroup: 'СМ3-72',
    bio: 'Producer & Co-founder BSC.',
    role: 'admin',
    positionIds: [byName('Стейдж-менеджер').id],
    createdAt: new Date().toISOString(),
  });

  const crewDefs = [
    ['Иван Петров', 'ivan.petrov@example.com', 'РК6-51', ['Звукорежиссёр', 'Бэклайн-техник'], 'tech_director'],
    ['Мария Соколова', 'maria.sokolova@example.com', 'СМ8-31', ['Художник по свету'], 'user'],
    ['Дмитрий Орлов', 'dmitry.orlov@example.com', 'МТ4-21', ['Риггер', 'Техник', 'Электрик'], 'user'],
    ['Анна Кузнецова', 'anna.kuznetsova@example.com', 'ИУ5-42', ['Видеоинженер / экранщик'], 'user'],
  ];
  const crew = crewDefs.map(([fullName, email, studyGroup, posNames, role]) =>
    store.insert('users', {
      email,
      passwordHash: hashPassword('changeme123'),
      fullName,
      phone: '',
      telegram: '',
      studyGroup,
      bio: '',
      role,
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
      'Загрузите актуальный PDF/DOCX через форму — это лишь пример карточки мануала.',
    category: 'stage',
    content: '',
    videoLinks: [],
    fileName: null,
    originalName: null,
    mimeType: null,
    size: null,
    uploadedBy: admin.id,
    createdAt: new Date().toISOString(),
    placeholder: true,
  });

  // ---- Сезоны (лидеры месяца) ----
  [monthSeason(-1), monthSeason(0)].forEach((s) =>
    store.insert('seasons', { ...s, createdBy: admin.id, createdAt: new Date().toISOString() })
  );

  store.persist();
  console.log('[seed] Готово. Администратор:', admin.email, '(пароль: changeme123)');
}

module.exports = { seed };
