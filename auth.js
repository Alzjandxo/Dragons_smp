/* ============================================================
 * DRAGONS SMP — Auth con Discord vía Supabase Auth (OAuth2)
 * ------------------------------------------------------------
 * - Web estática: sin backend propio, sin secretos en frontend.
 * - El flujo OAuth2 lo gestiona Supabase: signInWithOAuth({ provider: 'discord' }).
 * - La sesión la persiste Supabase (localStorage) y la valida su servidor.
 * - Este módulo SOLO lee window.DRAGONS_SMP_CONFIG { SUPABASE_URL, SUPABASE_ANON_KEY }.
 * - Expone window.DragonsAuth { getProfile, isLoggedIn, login, logout } para
 *   futuras integraciones (Minecraft, rangos, tienda, estadísticas).
 * ============================================================ */
(function () {
  'use strict';

  var FALLBACK_AVATAR = 'assets/avatar-placeholder.svg';

  var els = {};
  var supabaseClient = null;
  var currentProfile = null; // { id, username, displayName, avatarUrl, supabaseUserId }
  var configMissing = false;

  function $(selector) {
    return document.querySelector(selector);
  }

  function getConfig() {
    var cfg = window.DRAGONS_SMP_CONFIG || {};
    return {
      url: (cfg.SUPABASE_URL || '').trim(),
      anonKey: (cfg.SUPABASE_ANON_KEY || '').trim()
    };
  }

  function showToastMessage(message) {
    var toast = document.querySelector('.toast');
    if (!toast) return;
    var original = toast.dataset.originalText || toast.textContent;
    toast.dataset.originalText = original;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showToastMessage._t);
    showToastMessage._t = window.setTimeout(function () {
      toast.classList.remove('is-visible');
      window.setTimeout(function () { toast.textContent = toast.dataset.originalText; }, 350);
    }, 2600);
  }

  function log(message, data) {
    if (!window.console || !console.log) return;
    if (data === undefined) console.log('[DragonsAuth] ' + message);
    else console.log('[DragonsAuth] ' + message, data);
  }

  function warn(message, err) {
    if (!window.console || !console.warn) return;
    if (err === undefined) console.warn('[DragonsAuth] ' + message);
    else console.warn('[DragonsAuth] ' + message, err && err.message ? err.message : err);
  }

  /* ---------- Normalización del perfil Discord ---------- */
  function normalizeProfile(user) {
    if (!user) return null;
    var meta = user.user_metadata || {};
    var identityData = null;
    if (Array.isArray(user.identities)) {
      for (var i = 0; i < user.identities.length; i += 1) {
        var ident = user.identities[i];
        if (ident && ident.provider === 'discord' && ident.identity_data) {
          identityData = ident.identity_data;
          break;
        }
      }
    }
    var data = identityData || meta || {};

    // Discord User ID: Supabase lo expone como provider_id / sub / id según versión.
    var discordId =
      data.provider_id || data.sub || data.id || meta.provider_id || meta.sub || '';

    var username =
      data.user_name || data.preferred_username || data.name || meta.user_name ||
      meta.preferred_username || meta.name || (user.email ? user.email.split('@')[0] : 'Dragón');

    var displayName =
      data.full_name || data.global_name || data.display_name || meta.full_name ||
      meta.global_name || meta.display_name || username;

    var avatarUrl =
      data.avatar_url || meta.avatar_url || meta.picture || '';

    return {
      id: String(discordId || ''),
      username: String(username || 'Dragón'),
      displayName: String(displayName || username || 'Dragón'),
      avatarUrl: avatarUrl || FALLBACK_AVATAR,
      supabaseUserId: user.id || ''
    };
  }

  /* ---------- Render UI ---------- */
  function renderLoggedOut() {
    currentProfile = null;
    setLoading(false);
    if (els.loginBtn) els.loginBtn.hidden = false;
    if (els.userWrap) els.userWrap.hidden = true;
    closeDropdown();
    fillProfileModal(null);
  }

  function renderLoggedIn(profile) {
    currentProfile = profile;
    setLoading(false);
    if (els.loginBtn) els.loginBtn.hidden = true;
    if (els.userWrap) els.userWrap.hidden = false;
    if (els.avatarImg) {
      els.avatarImg.src = profile.avatarUrl;
      els.avatarImg.alt = 'Avatar de ' + profile.displayName;
      els.avatarImg.onerror = function () {
        els.avatarImg.onerror = null;
        els.avatarImg.src = FALLBACK_AVATAR;
      };
    }
    if (els.usernameLabel) els.usernameLabel.textContent = profile.displayName || profile.username;
    if (els.dropName) els.dropName.textContent = profile.displayName || profile.username;
    if (els.dropUser) els.dropUser.textContent = '@' + profile.username;
    if (els.dropAvatar) {
      els.dropAvatar.src = profile.avatarUrl;
      els.dropAvatar.alt = 'Avatar de ' + profile.displayName;
      els.dropAvatar.onerror = function () {
        els.dropAvatar.onerror = null;
        els.dropAvatar.src = FALLBACK_AVATAR;
      };
    }
    fillProfileModal(profile);
  }

  function setLoading(isLoading) {
    if (!els.loginBtn) return;
    els.loginBtn.classList.toggle('is-loading', !!isLoading);
    els.loginBtn.disabled = !!isLoading;
    var label = els.loginBtn.querySelector('[data-login-label]');
    if (label) label.textContent = isLoading ? 'CONECTANDO…' : 'INICIAR SESIÓN';
  }

  /* ---------- Dropdown ---------- */
  function isDropdownOpen() {
    return !!els.dropdown && els.dropdown.classList.contains('is-open');
  }

  function openDropdown() {
    if (!els.dropdown || !els.userBtn) return;
    els.dropdown.classList.add('is-open');
    els.userBtn.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    if (!els.dropdown || !els.userBtn) return;
    els.dropdown.classList.remove('is-open');
    els.userBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleDropdown() {
    if (isDropdownOpen()) closeDropdown();
    else openDropdown();
  }

  /* ---------- Modal perfil / cuenta (estructura preparada) ---------- */
  function fillProfileModal(profile) {
    if (!els.modal) return;
    var name = profile ? (profile.displayName || profile.username) : 'Invitado';
    var username = profile ? ('@' + profile.username) : '@invitado';
    var discordId = profile && profile.id ? profile.id : '—';
    if (els.mAvatar) {
      els.mAvatar.src = profile ? profile.avatarUrl : FALLBACK_AVATAR;
      els.mAvatar.alt = 'Avatar de ' + name;
    }
    if (els.mName) els.mName.textContent = name;
    if (els.mUsername) els.mUsername.textContent = username;
    if (els.mDiscordId) els.mDiscordId.textContent = discordId;
    var dup = document.querySelector('#profile-discord-id-duplicate');
    if (dup) dup.textContent = discordId;
  }

  function openModal(view) {
    if (!els.modal) return;
    // view: 'perfil' | 'cuenta' — cambia el tab visible sin crear páginas nuevas.
    var target = view === 'cuenta' ? 'cuenta' : 'perfil';
    els.modal.dataset.view = target;
    var tabBtns = els.modal.querySelectorAll('[data-profile-tab]');
    tabBtns.forEach(function (btn) {
      var active = btn.dataset.profileTab === target;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    var panes = els.modal.querySelectorAll('[data-profile-pane]');
    panes.forEach(function (pane) {
      pane.hidden = pane.dataset.profilePane !== target;
    });
    els.modal.classList.add('is-open');
    els.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    if (!els.modal) return;
    els.modal.classList.remove('is-open');
    els.modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  /* ---------- Acciones Auth ---------- */
  async function refreshSessionUI() {
    if (!supabaseClient) {
      log('refreshSessionUI: sin cliente, no se puede leer la sesión');
      return;
    }
    try {
      var result = await supabaseClient.auth.getSession();
      if (result && result.error) {
        warn('getSession: error', result.error);
        renderLoggedOut();
        return;
      }
      var session = result && result.data ? result.data.session : null;
      if (session && session.user) {
        var profile = normalizeProfile(session.user);
        log('getSession: sesión encontrada', profile.username);
        renderLoggedIn(profile);
      } else {
        log('getSession: sin sesión activa');
        renderLoggedOut();
      }
    } catch (err) {
      warn('getSession: excepción', err);
      renderLoggedOut();
    }
  }

  async function login() {
    if (configMissing || !supabaseClient) {
      showToastMessage('Configura Supabase para activar el login con Discord');
      return;
    }
    var redirectTo = window.location.origin + window.location.pathname;
    log('OAuth: iniciando signInWithOAuth con Discord', redirectTo);
    setLoading(true);
    // Red de seguridad: si el navegador no llega a redirigir a Discord,
    // el botón nunca debe quedarse en "CONECTANDO…" (si redirige, la página
    // se descarga y este temporizador desaparece con ella).
    window.clearTimeout(login._safety);
    login._safety = window.setTimeout(function () {
      if (els.loginBtn && !els.loginBtn.hidden && els.loginBtn.classList.contains('is-loading')) {
        setLoading(false);
        warn('OAuth: sin redirección tras 20s, loading liberado');
        showToastMessage('No se abrió Discord, inténtalo de nuevo');
      }
    }, 20000);
    try {
      var result = await supabaseClient.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo: redirectTo, scopes: 'identify' }
      });
      if (result && result.error) throw result.error;
      log('OAuth: redirigiendo a Discord…');
      // Supabase redirige a Discord; no hay más que hacer aquí.
    } catch (err) {
      window.clearTimeout(login._safety);
      setLoading(false);
      warn('OAuth: error al iniciar', err);
      showToastMessage('No se pudo iniciar sesión con Discord');
    }
  }

  async function logout() {
    log('logout: cerrando sesión…');
    closeDropdown();
    setLoading(false);
    try {
      if (supabaseClient) {
        var result = await supabaseClient.auth.signOut();
        if (result && result.error) throw result.error;
      }
    } catch (err) {
      warn('logout: error, no se recarga la página', err);
      showToastMessage('No se pudo cerrar sesión. Inténtalo de nuevo.');
      return;
    }
    renderLoggedOut();
    log('logout: sesión cerrada correctamente, recargando…');
    window.location.reload();
  }

  /* ---------- Vuelta del callback OAuth (?code= / ?error=) ---------- */
  function cleanCallbackUrl() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      url.searchParams.delete('state');
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    } catch (err) { /* no crítico: la página sigue funcionando con los params */ }
  }

  async function handleOAuthCallback() {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (err) {
      return;
    }
    var oauthError = params.get('error');
    if (oauthError) {
      var desc = params.get('error_description');
      warn('callback: Discord devolvió error: ' + oauthError + (desc ? ' — ' + desc : ''));
      showToastMessage(oauthError === 'access_denied' ? 'Acceso cancelado en Discord' : 'Error al volver de Discord');
      cleanCallbackUrl();
      return;
    }
    if (!params.get('code')) return;
    log('callback: vuelta de Discord detectada (?code=), intercambiando por sesión…');
    try {
      if (supabaseClient && typeof supabaseClient.auth.exchangeCodeForSession === 'function') {
        var res = await supabaseClient.auth.exchangeCodeForSession(params.get('code'));
        if (res && res.error) throw res.error;
        log('callback: código intercambiado, sesión creada');
      } else {
        log('callback: intercambio delegado al auto-detect del SDK');
      }
    } catch (err) {
      // Tolerable: el SDK puede haber intercambiado el código ya (uso único).
      // La fuente de verdad es getSession(), que se lee justo después.
      warn('callback: intercambio manual no aplicado, se leerá la sesión existente', err);
    }
    cleanCallbackUrl();
  }

  /* ---------- Init ---------- */
  function cacheElements() {
    els.loginBtn = $('#auth-login-btn');
    els.userWrap = $('#auth-user');
    els.userBtn = $('#auth-user-btn');
    els.avatarImg = $('#auth-avatar');
    els.usernameLabel = $('#auth-username');
    els.dropdown = $('#auth-dropdown');
    els.dropAvatar = $('#auth-dropdown-avatar');
    els.dropName = $('#auth-dropdown-name');
    els.dropUser = $('#auth-dropdown-username');
    els.modal = $('#profile-modal');
    els.mAvatar = $('#profile-avatar');
    els.mName = $('#profile-display-name');
    els.mUsername = $('#profile-username');
    els.mDiscordId = $('#profile-discord-id');
  }

  function bindEvents() {
    if (els.loginBtn) els.loginBtn.addEventListener('click', login);
    if (els.userBtn) {
      els.userBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown();
      });
    }
    document.addEventListener('click', function (e) {
      if (!isDropdownOpen()) return;
      if (els.userWrap && !els.userWrap.contains(e.target)) closeDropdown();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeDropdown();
        closeModal();
      }
    });

    if (els.dropdown) {
      els.dropdown.addEventListener('click', function (e) {
        var actionBtn = e.target.closest('[data-action]');
        if (!actionBtn) return;
        var action = actionBtn.dataset.action;
        closeDropdown();
        // Cierra también el menú móvil para no tapar el modal.
        var mainNav = document.querySelector('.main-nav');
        if (mainNav) mainNav.classList.remove('is-open');
        if (action === 'logout') logout();
        else if (action === 'profile') openModal('perfil');
        else if (action === 'account') openModal('cuenta');
        // Estadísticas abre el modal "Mi perfil", donde están sus placeholders.
        else if (action === 'stats') openModal('perfil');
        else if (action === 'settings') {
          if (window.DragonsSettings) window.DragonsSettings.open();
          else openModal('cuenta');
        }
      });
    }

    if (els.modal) {
      els.modal.querySelectorAll('[data-close-profile]').forEach(function (btn) {
        btn.addEventListener('click', closeModal);
      });
      els.modal.querySelectorAll('[data-profile-tab]').forEach(function (btn) {
        btn.addEventListener('click', function () { openModal(btn.dataset.profileTab); });
      });
      // Botón "copiar ID" del modal.
      var copyIdBtn = els.modal.querySelector('[data-copy-discord-id]');
      if (copyIdBtn) {
        copyIdBtn.addEventListener('click', function () {
          var id = currentProfile && currentProfile.id ? currentProfile.id : '';
          if (!id) {
            showToastMessage('Inicia sesión para ver tu ID');
            return;
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(id).then(
              function () { showToastMessage('ID de Discord copiado'); },
              function () { showToastMessage(id); }
            );
          } else {
            showToastMessage(id);
          }
        });
      }
    }
  }

  async function init() {
    cacheElements();
    if (!els.loginBtn && !els.userWrap) return; // La página no tiene slot de auth.
    bindEvents();
    setLoading(false);
    renderLoggedOut();

    var cfg = getConfig();
    if (!cfg.url || !cfg.anonKey) {
      configMissing = true;
      warn('init: falta SUPABASE_URL o SUPABASE_ANON_KEY en supabase-config.js');
      return; // Diseño intacto en modo "sin configurar": muestra INICIAR SESIÓN.
    }
    if (!window.supabase || !window.supabase.createClient) {
      configMissing = true;
      warn('init: CDN de Supabase no cargado (window.supabase ausente)');
      return;
    }
    try {
      supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
    } catch (err) {
      configMissing = true;
      warn('init: no se pudo crear el cliente Supabase', err);
      return;
    }
    log('init: cliente Supabase listo');

    // Suscribirse ANTES de leer/intercambiar para no perder ningún evento
    // (INITIAL_SESSION, SIGNED_IN, SIGNED_OUT).
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      var who = session && session.user ? normalizeProfile(session.user).username : '(sin sesión)';
      log('onAuthStateChange: ' + event, who);
      setLoading(false);
      if (session && session.user) renderLoggedIn(normalizeProfile(session.user));
      else renderLoggedOut();
    });

    await handleOAuthCallback();
    await refreshSessionUI();
  }

  // API pública para futuras funciones (Minecraft, rangos, tienda, stats).
  window.DragonsAuth = {
    login: login,
    logout: logout,
    getProfile: function () { return currentProfile ? Object.assign({}, currentProfile) : null; },
    isLoggedIn: function () { return !!currentProfile; },
    openProfile: function () { openModal('perfil'); },
    openAccount: function () { openModal('cuenta'); },
    refresh: refreshSessionUI
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
