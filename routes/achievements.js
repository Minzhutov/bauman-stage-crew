'use strict';
const express = require('express');
const store = require('../lib/store');
const domain = require('../lib/domain');

const router = express.Router();

router.get('/', (req, res) => {
  const achievements = store.all('achievements');
  const myLevels = {};
  const myProgress = {};
  if (req.currentUser) {
    domain.userAchievements(req.currentUser.id).forEach((ua) => {
      myLevels[ua.achievementId] = ua.levelIndex;
    });
    domain.achievementProgress(req.currentUser.id).forEach((p) => {
      myProgress[p.achievement.id] = p;
    });
  }
  res.render('achievements/list', {
    title: 'Все ачивки',
    achievements,
    myLevels,
    myProgress,
    autoRuleTypes: domain.AUTO_RULES,
  });
});

module.exports = router;
