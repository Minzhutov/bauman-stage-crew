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
  function bindFlashAutoHide(root) {
    root.querySelectorAll('.flash').forEach(function (el) {
      setTimeout(function () {
        el.style.transition = 'opacity .4s ease';
        el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 400);
      }, 6000);
    });
  }
  bindFlashAutoHide(document);

  // Прокручивает чат мероприятия к последнему сообщению.
  function scrollChatToBottom(root) {
    var chat = (root || document).querySelector('#event-chat-messages');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }
  scrollChatToBottom(document);

  // Лёгкий поллинг чата мероприятия — подхватывает новые сообщения от
  // других пользователей без перезагрузки (раз в ~8 секунд). Без вебсокетов
  // и очередей, просто периодически перечитывает ленту сообщений этой же страницы.
  (function () {
    var chatEl = document.querySelector('#event-chat-messages');
    if (!chatEl) return;
    var pageUrl = window.location.pathname;
    setInterval(function () {
      fetch(pageUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (res) { return res.text(); })
        .then(function (html) {
          var fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('#event-chat-messages');
          var current = document.querySelector('#event-chat-messages');
          if (fresh && current && fresh.children.length !== current.children.length) {
            current.innerHTML = fresh.innerHTML;
            scrollChatToBottom(document);
          }
        })
        .catch(function () {});
    }, 8000);
  })();

  // Формы с data-ajax отправляются через fetch и подменяют только <main>,
  // без полной перезагрузки страницы (напр. "Закрыть смену" на мероприятии).
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.hasAttribute('data-ajax')) return;
    e.preventDefault();
    var submitBtn = form.querySelector('button[type=submit]');
    if (submitBtn) submitBtn.disabled = true;
    var isChatForm = form.closest('#event-chat') !== null;
    // URLSearchParams, а не FormData напрямую — fetch всегда шлёт FormData как
    // multipart/form-data, а сервер (express.urlencoded()) парсит только
    // application/x-www-form-urlencoded; с "сырым" FormData req.body приходит
    // пустым и запрос молча ничего не делает (ни файлов в этих формах нет).
    fetch(form.getAttribute('action'), {
      method: 'POST',
      body: new URLSearchParams(new FormData(form)),
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var newMain = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
        var oldMain = document.querySelector('main');
        if (newMain && oldMain) {
          oldMain.replaceWith(newMain);
          bindFlashAutoHide(newMain);
          if (isChatForm) scrollChatToBottom(newMain);
        } else {
          window.location.reload();
        }
      })
      .catch(function () {
        form.submit();
      });
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

  // Форма мероприятия: выбор кейса сразу уменьшает "доступно" у отдельного
  // оборудования, упакованного в этот кейс — чтобы нельзя было визуально
  // набрать те же физические единицы и кейсом, и отдельной строкой сразу.
  (function () {
    var dataEl = document.getElementById('cases-contents-data');
    var caseCheckboxes = document.querySelectorAll('.js-case-checkbox');
    var qtyInputs = document.querySelectorAll('.js-equipment-qty');
    if (!dataEl || !caseCheckboxes.length || !qtyInputs.length) return;
    var caseContents = JSON.parse(dataEl.textContent || '{}');
    function recompute() {
      var packedTotals = {};
      caseCheckboxes.forEach(function (cb) {
        if (!cb.checked) return;
        (caseContents[cb.value] || []).forEach(function (row) {
          packedTotals[row.equipmentId] = (packedTotals[row.equipmentId] || 0) + row.quantity;
        });
      });
      qtyInputs.forEach(function (input) {
        var eqId = input.getAttribute('data-equipment-id');
        var base = Number(input.getAttribute('data-base-available')) || 0;
        var packed = packedTotals[eqId] || 0;
        var newMax = Math.max(0, base - packed);
        input.setAttribute('max', newMax);
        if (Number(input.value) > newMax) {
          input.value = newMax;
          input.dispatchEvent(new Event('input'));
        }
        var hint = document.querySelector('[data-available-hint="' + eqId + '"]');
        if (hint) hint.textContent = newMax;
      });
    }
    caseCheckboxes.forEach(function (cb) { cb.addEventListener('change', recompute); });
  })();

  // Тултип для простых столбчатых графиков — элементы с [data-chart-tooltip]
  // (напр. "Явка по времени" на странице мероприятия).
  (function () {
    var tooltip = null;
    function ensureTooltip() {
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        document.body.appendChild(tooltip);
      }
      return tooltip;
    }
    function showTooltip(el, x, y) {
      var el2 = ensureTooltip();
      el2.textContent = el.getAttribute('data-chart-tooltip');
      el2.style.left = (x + 12) + 'px';
      el2.style.top = (y + 12) + 'px';
      el2.style.display = 'block';
    }
    function hideTooltip() {
      if (tooltip) tooltip.style.display = 'none';
    }
    document.addEventListener('pointermove', function (e) {
      var el = e.target.closest('[data-chart-tooltip]');
      if (el) showTooltip(el, e.clientX, e.clientY);
      else hideTooltip();
    });
    document.addEventListener('focusin', function (e) {
      var el = e.target.closest('[data-chart-tooltip]');
      if (!el) return;
      var rect = el.getBoundingClientRect();
      showTooltip(el, rect.left, rect.top);
    });
    document.addEventListener('focusout', function (e) {
      if (e.target.closest('[data-chart-tooltip]')) hideTooltip();
    });
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

  // Модалка с подробностями — клик по [data-modal-target] открывает содержимое
  // указанного <template> (напр. карточка оборудования на странице мероприятия)
  function closeModal() {
    var overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', onModalKeydown);
  }
  function onModalKeydown(e) {
    if (e.key === 'Escape') closeModal();
  }
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-modal-target]');
    if (trigger) {
      e.preventDefault();
      var template = document.querySelector(trigger.getAttribute('data-modal-target'));
      if (!template) return;
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      var box = document.createElement('div');
      box.className = 'modal-box';
      box.innerHTML = '<button type="button" class="modal-close" aria-label="Закрыть">✕</button>';
      box.appendChild(template.content.cloneNode(true));
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onModalKeydown);
      return;
    }
    if (e.target.closest('.modal-close') || (e.target.classList && e.target.classList.contains('modal-overlay'))) {
      closeModal();
    }
  });
})();
