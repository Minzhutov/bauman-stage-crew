'use strict';
const express = require('express');
const store = require('../lib/store');
const domain = require('../lib/domain');

const router = express.Router();

router.get('/', (req, res) => {
  const now = Date.now();

  const upcomingEvents = store
    .all('events')
    .filter((e) => e.status !== 'cancelled')
    .map((e) => domain.eventWithDetails(e))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .filter((e) => new Date(e.startsAt).getTime() >= now || e.status === 'planned')
    .slice(0, 3);

  const upcomingAcademies = store
    .all('academies')
    .filter((a) => new Date(a.startsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .slice(0, 3);

  const topLeaders = domain.leaderboard().slice(0, 5);

  const stats = {
    events: store.all('events').length,
    crew: store.all('users').length,
    manuals: store.all('manuals').filter((m) => !m.placeholder || m.fileName).length,
    academies: store.all('academies').length,
  };

  let personal = null;
  if (req.currentUser) {
    const signups = domain.userSignups(req.currentUser.id);
    personal = {
      points: domain.userPoints(req.currentUser.id),
      positions: domain.userPositions(req.currentUser.id),
      achievements: domain.userAchievements(req.currentUser.id),
      nextEvent: signups.find(
        (s) => s.event && new Date(s.event.startsAt).getTime() >= now && s.status !== 'rejected'
      ),
    };
  }

  res.render('index', {
    title: 'Главная',
    upcomingEvents,
    upcomingAcademies,
    topLeaders,
    stats,
    personal,
  });
});

module.exports = router;
