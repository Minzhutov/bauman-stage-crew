'use strict';
const express = require('express');
const domain = require('../lib/domain');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = domain.leaderboard();
  res.render('leaderboard/index', { title: 'Таблица лидеров', rows });
});

module.exports = router;
