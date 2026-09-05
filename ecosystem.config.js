// Конфигурация pm2 для продакшена: держит процесс живым, перезапускает при
// падении, шлёт логи в файлы. Установить pm2 (глобально на сервере):
//   npm install -g pm2
// Запуск/управление:
//   pm2 start ecosystem.config.js --env production
//   pm2 save              # чтобы список процессов пережил перезагрузку сервера
//   pm2 startup           # печатает команду для автозапуска pm2 при старте ОС
//   pm2 logs bauman-stage-crew
//   pm2 restart bauman-stage-crew
'use strict';

module.exports = {
  apps: [
    {
      name: 'bauman-stage-crew',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      // pm2 сам не подставляет .env — server.js уже вызывает dotenv.config(),
      // так что переменные достаточно один раз задать в .env рядом с проектом.
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
