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

  // Живой предпросмотр числового поля "нужно человек" в форме мероприятия
  document.querySelectorAll('.requirement-item input[type=number]').forEach(function (input) {
    input.addEventListener('input', function () {
      var item = input.closest('.requirement-item');
      if (!item) return;
      item.classList.toggle('is-active', Number(input.value) > 0);
    });
    input.dispatchEvent(new Event('input'));
  });
})();
