'use strict';
const express = require('express');
const store = require('../lib/store');
const domain = require('../lib/domain');

const router = express.Router();

router.get('/', (req, res) => {
  const seasons = store
    .all('seasons')
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));

  let selectedSeason = null;
  if (req.query.season && req.query.season !== 'all') {
    selectedSeason = store.find('seasons', req.query.season) || null;
  } else if (!req.query.season) {
    selectedSeason = domain.activeSeason();
  }

  // Штат (админы, технические директора, наставники) не соревнуется за баллы
  // с командой — общий рейтинг строится только по обычным участникам, а весь
  // штат выведен в отдельную справочную таблицу ниже.
  const rows = domain.leaderboard(selectedSeason || undefined, {
    includeRoles: ['user'],
  });
  const adminRows = domain.leaderboard(selectedSeason || undefined, {
    includeRoles: ['admin', 'tech_director', 'mentor'],
  });
  res.render('leaderboard/index', {
    title: 'Таблица лидеров',
    rows,
    adminRows,
    seasons,
    selectedSeason,
  });
});

module.exports = router;
