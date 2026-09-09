(function () {
  'use strict';

  // Подтверждение необратимых действий (удаление и т.п.)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.hasAttribute('data-confirm')) {
      var message = form.getAttribute('data-confirm') || 'Вы уверены?';
      if (!window.confirm(message)) {
        e.preventDefault();
      }
    }
  });

  // Кнопка "Показать все" — разворачивает свёрнутые по умолчанию карточки
  document.querySelectorAll('[data-show-all-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.querySelector(btn.getAttribute('data-show-all-target'));
      if (target) {
        target.querySelectorAll('.medal-collapsed').forEach(function (el) {
          el.classList.remove('medal-collapsed');
        });
      }
      btn.remove();
    });
  });

  // Автоскрытие флеш-уведомлений
  document.querySelectorAll('.flash').forEach(function (el) {
    setTimeout(function () {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 400);
    }, 6000);
  });

  // Показ выбранного имени файла в форме загрузки мануала
  document.querySelectorAll('input[type=file][data-filename-target]').forEach(function (input) {
    input.addEventListener('change', function () {
      var target = document.querySelector(input.getAttribute('data-filename-target'));
      if (target) {
        target.textContent = input.files.length ? input.files[0].name : 'Файл не выбран';
      }
    });
  });

  // Автоотправка формы сразу после выбора файла (смена аватара профиля)
  document.querySelectorAll('input[type=file][data-autosubmit]').forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.files.length) input.form.submit();
    });
  });

  // Форма ачивки: динамическое добавление/удаление уровней
  (function () {
    var container = document.getElementById('levels-container');
    var template = document.getElementById('level-row-template');
    var addBtn = document.getElementById('add-level-btn');
    if (!container || !template) return;

    function renumber() {
      var rows = container.querySelectorAll('.level-row');
      rows.forEach(function (row, i) {
        row.querySelectorAll('[data-field]').forEach(function (el) {
          el.name = 'level_' + i + '_' + el.getAttribute('data-field');
        });
        var title = row.querySelector('.level-row-title');
        if (title) title.textContent = 'Уровень ' + (i + 1);
      });
      var removeBtns = container.querySelectorAll('.level-row-remove');
      removeBtns.forEach(function (btn) {
        btn.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
      });
    }

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (container.querySelectorAll('.level-row').length >= 5) return;
        container.appendChild(template.content.cloneNode(true));
        renumber();
      });
    }
    container.addEventListener('click', function (e) {
      if (!e.target.classList.contains('level-row-remove')) return;
      var rows = container.querySelectorAll('.level-row');
      if (rows.length <= 1) return;
      var row = e.target.closest('.level-row');
      if (row) { row.remove(); renumber(); }
    });
    renumber();
  })();

  // Профиль: список уровней ачивки при ручном присвоении
  (function () {
    var achievementSelect = document.getElementById('achievementId');
    var levelSelect = document.getElementById('level');
    var dataEl = document.getElementById('achievements-data');
    if (!achievementSelect || !levelSelect || !dataEl) return;
    var byId = {};
    JSON.parse(dataEl.textContent || '[]').forEach(function (a) { byId[a.id] = a.levels; });
    function sync() {
      var levels = byId[achievementSelect.value] || [];
      levelSelect.innerHTML = '';
      levels.forEach(function (l) {
        var opt = document.createElement('option');
        opt.value = l.index;
        opt.textContent = l.label;
        levelSelect.appendChild(opt);
      });
    }
    achievementSelect.addEventListener('change', sync);
    sync();
  })();

  // Живой предпросмотр числового поля "нужно человек" в форме мероприятия
  document.querySelectorAll('.requirement-item input[type=number]').forEach(function (input) {
    input.addEventListener('input', function () {
      var item = input.closest('.requirement-item');
      if (!item) return;
      item.classList.toggle('is-active', Number(input.value) > 0);
    });
    input.dispatchEvent(new Event('input'));
  });

  // Лайтбокс — клик по фото с [data-lightbox] открывает его увеличенную копию
  function closeLightbox() {
    var overlay = document.querySelector('.lightbox-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', onLightboxKeydown);
  }
  function onLightboxKeydown(e) {
    if (e.key === 'Escape') closeLightbox();
  }
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-lightbox]');
    if (trigger) {
      var overlay = document.createElement('div');
      overlay.className = 'lightbox-overlay';
      overlay.innerHTML =
        '<button type="button" class="lightbox-close" aria-label="Закрыть">✕</button>' +
        '<img src="' + trigger.getAttribute('data-lightbox') + '" alt="">';
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onLightboxKeydown);
      return;
    }
    if (e.target.closest('.lightbox-overlay')) closeLightbox();
  });
})();
