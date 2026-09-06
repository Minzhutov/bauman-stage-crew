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

  const rows = domain.leaderboard(selectedSeason || undefined);
  res.render('leaderboard/index', {
    title: 'Таблица лидеров',
    rows,
    seasons,
    selectedSeason,
  });
});

module.exports = router;
