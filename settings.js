/* ============================================================
 * DRAGONS SMP — Configuración (preferencias locales reales)
 * ------------------------------------------------------------
 * Una sola clave: dragons_settings (solo interfaz, jamás
 * secretos, tokens ni contraseñas). Cada opción cambia de
 * verdad el comportamiento vía clases en <body> + el sistema
 * de efectos existente (window.DragonsFX). Sin OAuth/Supabase.
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'dragons_settings';

  var DEFAULTS = {
    animations: true,
    visualEffects: true,
    particles: true,
    parallax: true,
    reducedMotion: false,
    highContrast: false,
    webNotifications: true,
    accountNotifications: true,
    rememberPreferences: true
  };

  var settings = {};
  var toastTimer = 0;

  function osWantsReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return false;
    }
  }

  function loadStored() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function current() {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = typeof settings[k] === 'boolean' ? settings[k] : DEFAULTS[k];
    });
    return out;
  }

  function persist() {
    if (!settings.rememberPreferences) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current()));
    } catch (err) { /* almacenamiento no disponible: sigue en memoria */ }
  }

  function fx() {
    return window.DragonsFX && window.DragonsFX.config ? window.DragonsFX.config : null;
  }

  function clearParallaxTransforms() {
    ['.hero-layout', '.hero-logo'].forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        el.style.translate = '';
      });
    });
  }

  var savedFxInit = null; // snapshot de lo que el dispositivo permite (móvil/tablet)

  function applyAll() {
    var s = current();
    var body = document.body;
    var cfg = fx();
    if (cfg && !savedFxInit) {
      savedFxInit = {
        parallax: cfg.parallax !== false,
        spotlight: cfg.spotlight !== false,
        magnetic: cfg.magnetic !== false,
        tilt: cfg.tilt !== false
      };
    }

    // Animaciones no esenciales (la navegación sigue funcional: todo hace snap).
    body.classList.toggle('set-noanim', !s.animations || s.reducedMotion);

    // Efectos visuales reducidos: sin spotlight ni halos decorativos.
    body.classList.toggle('set-lowfx', !s.visualEffects);
    if (cfg) {
      cfg.spotlight = savedFxInit.spotlight && s.visualEffects && !s.reducedMotion;
      // Parallax por cursor (también lo apaga Reducir movimiento).
      cfg.parallax = savedFxInit.parallax && s.parallax && !s.reducedMotion;
      // Reducir movimiento también calma magnéticos/tilt.
      cfg.magnetic = savedFxInit.magnetic && !s.reducedMotion;
      cfg.tilt = savedFxInit.tilt && !s.reducedMotion;
    }

    // Partículas ambientales.
    body.classList.toggle('set-noparticles', !s.particles);

    // Si el parallax queda apagado, limpia translates ya aplicados.
    if (cfg && !cfg.parallax) clearParallaxTransforms();

    // Alto contraste: variables + bordes.
    body.classList.toggle('set-contrast', !!s.highContrast);

    syncSwitches();
  }

  function syncSwitches() {
    var s = current();
    document.querySelectorAll('#settings-modal .switch[data-setting]').forEach(function (btn) {
      var on = !!s[btn.dataset.setting];
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
    });
  }

  function feedback(msg) {
    if (!current().webNotifications) return;
    var toast = document.querySelector('.toast');
    if (!toast) return;
    toast.textContent = msg || 'Configuración guardada';
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 1500);
  }

  function fillAccount() {
    var profile = null;
    try {
      profile = window.DragonsAuth && window.DragonsAuth.getProfile
        ? window.DragonsAuth.getProfile()
        : null;
    } catch (err) {
      profile = null;
    }
    var set = function (id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    if (profile) {
      set('settings-discord-state', 'Conectado');
      set('settings-discord-user', profile.displayName || profile.username || '—');
      set('settings-discord-id', profile.id || '—');
      var mcName = document.getElementById('minecraft-name');
      set('settings-minecraft', mcName && mcName.textContent && mcName.textContent !== '—'
        ? '🟢 ' + mcName.textContent
        : '⚪ No vinculada');
    } else {
      set('settings-discord-state', 'Desconectado');
      set('settings-discord-user', '—');
      set('settings-discord-id', '—');
      set('settings-minecraft', '⚪ No vinculada');
    }
  }

  function open() {
    fillAccount();
    syncSwitches();
    var modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function close() {
    var modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    var othersOpen = document.querySelectorAll('.profile-modal.is-open, #link-modal.is-open').length > 0;
    if (!othersOpen) document.body.classList.remove('modal-open');
    var confirm = document.getElementById('settings-confirm');
    if (confirm) confirm.hidden = true;
  }

  function setKey(key, value) {
    if (!(key in DEFAULTS)) return;
    settings[key] = !!value;
    // Si se apaga "recordar", se deja de persistir desde ya.
    if (key === 'rememberPreferences' && !value) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch (err) { /* nada */ }
    } else {
      persist();
    }
    applyAll();
    feedback();
  }

  function resetAll() {
    settings = Object.assign({}, DEFAULTS);
    // Respeta el SO solo si pedía reducir movimiento y no hay conflicto.
    if (osWantsReducedMotion()) settings.reducedMotion = true;
    persist();
    applyAll();
    feedback('Configuración restaurada');
  }

  function wipeLocal() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) { /* nada */ }
    settings = Object.assign({}, DEFAULTS);
    if (osWantsReducedMotion()) settings.reducedMotion = true;
    // NO toca la sesión de Discord ni Supabase: solo preferencias.
    applyAll();
    var confirm = document.getElementById('settings-confirm');
    if (confirm) confirm.hidden = true;
    feedback('Datos locales eliminados');
  }

  function bind() {
    document.querySelectorAll('#settings-modal .switch[data-setting]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setKey(btn.dataset.setting, !btn.classList.contains('is-on'));
      });
    });
    document.querySelectorAll('#settings-modal [data-close-settings]').forEach(function (el) {
      el.addEventListener('click', close);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    var resetBtn = document.getElementById('settings-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', resetAll);
    var wipeBtn = document.getElementById('settings-wipe-btn');
    var confirm = document.getElementById('settings-confirm');
    var cancelBtn = document.getElementById('settings-wipe-cancel');
    var confirmBtn = document.getElementById('settings-wipe-confirm');
    if (wipeBtn && confirm) {
      wipeBtn.addEventListener('click', function () {
        confirm.hidden = false;
      });
    }
    if (cancelBtn && confirm) {
      cancelBtn.addEventListener('click', function () {
        confirm.hidden = true;
      });
    }
    if (confirmBtn) confirmBtn.addEventListener('click', wipeLocal);
  }

  function init() {
    var stored = loadStored();
    settings = Object.assign({}, DEFAULTS, stored || {});
    if (!stored && osWantsReducedMotion()) settings.reducedMotion = true;
    bind();
    applyAll();
  }

  window.DragonsSettings = {
    open: open,
    close: close,
    get: current,
    reset: resetAll,
    shouldNotify: function (kind) {
      var s = current();
      return kind === 'account' ? !!s.accountNotifications : !!s.webNotifications;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
