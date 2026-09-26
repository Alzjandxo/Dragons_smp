/* ============================================================
 * DRAGONS SMP — Votación simple de comunidad (sin moderación)
 * ------------------------------------------------------------
 * ESTADO ÚNICO: `currentVote` es la única fuente de verdad.
 *   null            → no votado (4 opciones habilitadas)
 *   "Muy bueno"...  → votado (solo esa selected, resto disabled)
 * `renderVisual()` es el ÚNICO lugar que pinta el DOM desde
 * `currentVote`. Tras INSERT/DELETE se reconsulta a Supabase y
 * la UI se actualiza solo con datos reales (las respuestas
 * obsoletas se descartan por número de secuencia).
 * - Stats: RPC get_community_vote_stats() (nunca user_id).
 * - Voto propio: RPC get_my_community_vote().
 * - Módulo independiente: no toca auth.js (cliente propio con
 *   la misma config, por lo que comparte la sesión).
 * ============================================================ */
(function () {
  'use strict';

  var OPTIONS = ['Excelente', 'Muy bueno', 'Bueno', 'Regular'];

  var els = {};
  var supabaseClient = null;
  var sessionUser = null;
  var currentVote = null; // ÚNICA fuente de verdad. null = no votado.
  var busy = false; // INSERT en curso.
  var removing = false; // DELETE en curso.
  var removeArmed = false;
  var removeTimer = null;
  var refreshSeq = 0; // Descarta respuestas de red obsoletas.
  var hasStats = false; // true tras la primera carga real de stats.

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function getConfig() {
    var cfg = window.DRAGONS_SMP_CONFIG || {};
    return {
      url: (cfg.SUPABASE_URL || '').trim(),
      anonKey: (cfg.SUPABASE_ANON_KEY || '').trim()
    };
  }

  function formatPct(value) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(n)) n = 0;
    return (Math.round(n * 10) / 10).toString().replace(/\.0$/, '') + '%';
  }

  function formatNum(value) {
    var n = typeof value === 'number' ? value : parseInt(value, 10);
    return isNaN(n) ? 0 : n;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(html, isLoginPrompt) {
    if (!els.status) return;
    if (!html) {
      els.status.hidden = true;
      els.status.innerHTML = '';
      els.status.classList.remove('is-login');
      return;
    }
    els.status.hidden = false;
    els.status.innerHTML = html;
    els.status.classList.toggle('is-login', !!isLoginPrompt);
    var loginBtn = els.status.querySelector('[data-votes-login]');
    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        if (window.DragonsAuth && typeof window.DragonsAuth.login === 'function') {
          window.DragonsAuth.login();
        }
      });
    }
    var removeBtn = els.status.querySelector('[data-votes-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () { handleRemove(removeBtn); });
    }
  }

  function disarmRemove() {
    removeArmed = false;
    if (removeTimer) {
      window.clearTimeout(removeTimer);
      removeTimer = null;
    }
  }

  function showVotedStatus(extraHtml) {
    if (currentVote === null) {
      setStatus(extraHtml || null);
      return;
    }
    disarmRemove();
    setStatus(
      'Ya has votado: <strong>' + currentVote + '</strong>.' +
      (extraHtml || '') +
      '<br><button type="button" class="votes-remove-btn" data-votes-remove>Quitar mi voto</button>'
    );
  }

  function renderStats(rows) {
    var byVote = {};
    var total = 0;
    (rows || []).forEach(function (row) {
      if (!row || OPTIONS.indexOf(row.vote) === -1) return;
      byVote[row.vote] = {
        count: formatNum(row.count),
        pct: typeof row.percentage === 'number' ? row.percentage : parseFloat(row.percentage) || 0
      };
      total += byVote[row.vote].count;
    });
    els.cards.forEach(function (card) {
      var vote = card.dataset.vote;
      var data = byVote[vote] || { count: 0, pct: 0 };
      var countEl = card.querySelector('[data-vote-count]');
      var pctEl = card.querySelector('[data-vote-pct]');
      var fillEl = card.querySelector('.vote-fill');
      if (countEl) countEl.textContent = data.count;
      if (pctEl) pctEl.textContent = formatPct(data.pct);
      if (fillEl) fillEl.style.width = Math.max(0, Math.min(100, data.pct)) + '%';
    });
    if (els.total) {
      els.total.textContent = total + (total === 1 ? ' voto en total' : ' votos en total');
    }
  }

  // ÚNICO pintado visual: deriva TODO de `currentVote`.
  // null → 4 habilitadas, ninguna selected. No null → solo esa
  // selected, las demás disabled. Sin excepciones.
  function renderVisual() {
    els.cards.forEach(function (card) {
      var isChosen = currentVote !== null && card.dataset.vote === currentVote;
      card.classList.toggle('is-chosen', isChosen);
      card.setAttribute('aria-pressed', isChosen ? 'true' : 'false');
      card.disabled = currentVote !== null || busy || removing;
    });
  }

  async function getFreshSession() {
    try {
      var res = await supabaseClient.auth.getSession();
      return res && res.data ? res.data.session : null;
    } catch (err) {
      return null;
    }
  }

  // Recarga stats + voto real y aplica SOLO si es la respuesta
  // más reciente (las obsoletas se descartan).
  async function refreshState() {
    if (!supabaseClient) return;
    var seq = ++refreshSeq;
    var rows = null;
    var statsOk = false;
    try {
      var statsRes = await supabaseClient.rpc('get_community_vote_stats');
      if (statsRes.error) throw statsRes.error;
      rows = statsRes.data;
      statsOk = true;
    } catch (err) {
      if (window.console && console.warn) console.warn('[CommunityVotes] stats error', err);
    }
    var serverVote = null;
    if (sessionUser) {
      try {
        var voteRes = await supabaseClient.rpc('get_my_community_vote');
        if (!voteRes.error && OPTIONS.indexOf(voteRes.data) !== -1) {
          serverVote = voteRes.data;
        }
      } catch (err) {
        if (window.console && console.warn) console.warn('[CommunityVotes] my vote error', err);
      }
    }
    if (seq !== refreshSeq) return; // Obsoleta: no tocar el estado.
    currentVote = serverVote;
    if (statsOk) {
      hasStats = true;
      renderStats(rows);
    }
    renderVisual();
    if (currentVote !== null) {
      showVotedStatus();
    } else if (!hasStats) {
      setStatus('No se pudieron cargar los votos. Inténtalo de nuevo más tarde.');
    } else {
      setStatus(null);
    }
  }

  function flashCard(vote) {
    for (var i = 0; i < els.cards.length; i += 1) {
      if (els.cards[i].dataset.vote === vote) {
        var fill = els.cards[i].querySelector('.vote-fill');
        if (!fill) return;
        fill.classList.remove('is-flash');
        void fill.offsetWidth; // Reinicia la animación.
        fill.classList.add('is-flash');
        window.setTimeout(function () { fill.classList.remove('is-flash'); }, 900);
        return;
      }
    }
  }

  async function handleVote(card) {
    if (busy || removing || !card) return;
    if (!supabaseClient) {
      setStatus('Votación no disponible temporalmente.');
      return;
    }
    // El valor a insertar sale SIEMPRE del botón pulsado, nunca de currentVote.
    var selectedVote = card.dataset.vote;
    if (OPTIONS.indexOf(selectedVote) === -1) return;
    var session = await getFreshSession();
    if (!session || !session.user) {
      setStatus(
        '🔒 Inicia sesión con Discord para votar. ' +
        '<button type="button" class="votes-login-btn" data-votes-login>Iniciar sesión</button>',
        true
      );
      return;
    }
    sessionUser = session.user;
    if (currentVote !== null) {
      showVotedStatus(); // Ya votó: no reinsertar, reafirmar estado real.
      return;
    }
    busy = true;
    renderVisual();
    try {
      var res = await supabaseClient
        .from('community_votes')
        .insert({
          user_id: session.user.id,
          vote: selectedVote
        });
      if (res.error && res.error.code !== '23505') {
        // TEMPORAL (diagnóstico): no ocultar el error real de Supabase.
        if (window.console && console.error) console.error('[CommunityVotes] insert error:', res.error);
        setStatus('No se pudo guardar tu voto. Inténtalo de nuevo.<br><small>Error: ' + escapeHtml(res.error.message) + '</small>');
        return;
      }
      // 23505 = UNIQUE(user_id): ya existía; el servidor dirá cuál.
      currentVote = selectedVote;
      renderVisual();
      showVotedStatus();
      flashCard(selectedVote);
      await refreshState(); // Confirma stats + voto real desde Supabase.
    } catch (err) {
      if (window.console && console.error) console.error('[CommunityVotes] insert error:', err);
      setStatus('No se pudo guardar tu voto. Inténtalo de nuevo.<br><small>Error: ' + escapeHtml(err && err.message ? err.message : err) + '</small>');
    } finally {
      busy = false;
      renderVisual();
    }
  }

  async function handleRemove(btn) {
    if (removing || busy || !btn) return;
    if (!supabaseClient) return;
    // Confirmación discreta en el propio botón (sin modal).
    if (!removeArmed) {
      removeArmed = true;
      btn.textContent = 'Pulsa de nuevo para confirmar';
      btn.classList.add('is-confirm');
      if (removeTimer) window.clearTimeout(removeTimer);
      removeTimer = window.setTimeout(function () {
        removeArmed = false;
        removeTimer = null;
        if (document.contains(btn)) {
          btn.textContent = 'Quitar mi voto';
          btn.classList.remove('is-confirm');
        }
      }, 4000);
      return;
    }
    disarmRemove();
    var session = await getFreshSession();
    if (!session || !session.user) {
      setStatus(
        '🔒 Inicia sesión con Discord para votar. ' +
        '<button type="button" class="votes-login-btn" data-votes-login>Iniciar sesión</button>',
        true
      );
      return;
    }
    sessionUser = session.user;
    removing = true;
    var deleteError = null;
    try {
      // Eliminación SOLO vía RPC segura (sin DELETE directo).
      // La función solo borra where user_id = auth.uid().
      var res = await supabaseClient.rpc('delete_my_community_vote');
      if (res.error) deleteError = res.error;
    } catch (err) {
      deleteError = err;
    }
    if (deleteError) {
      // TEMPORAL (diagnóstico): no ocultar el error real de Supabase.
      if (window.console && console.error) console.error('[CommunityVotes] delete RPC error:', deleteError);
      removing = false;
      renderVisual();
      showVotedStatus('<br><small>Error: ' + escapeHtml(deleteError.message || deleteError) + '</small>');
      return;
    }
    // RPC exitoso: limpieza total inmediata.
    currentVote = null;
    removing = false;
    renderVisual();
    setStatus(null);
    // Relectura obligatoria: stats + voto real desde Supabase.
    // La UI solo usa estos datos (nunca se resta a mano).
    await refreshState();
    // Si el voto siguiera existiendo, refreshState lo restaura con
    // los datos reales; sin error y null, todo queda a 0.
  }

  function bindEvents() {
    els.cards.forEach(function (card) {
      card.addEventListener('click', function () { handleVote(card); });
    });
  }

  function cacheElements() {
    var section = $('#opiniones');
    if (!section) return false;
    els.cards = Array.prototype.slice.call(section.querySelectorAll('.vote-card'));
    els.total = section.querySelector('[data-votes-total]');
    els.status = section.querySelector('.votes-status');
    return els.cards.length === OPTIONS.length && !!els.total && !!els.status;
  }

  async function init() {
    if (!cacheElements()) return;
    bindEvents();
    renderStats(null);
    renderVisual();

    var cfg = getConfig();
    if (!cfg.url || !cfg.anonKey) {
      setStatus('Votación no disponible temporalmente.');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      setStatus('Votación no disponible temporalmente.');
      return;
    }
    try {
      supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
    } catch (err) {
      setStatus('Votación no disponible temporalmente.');
      return;
    }

    var session = await getFreshSession();
    sessionUser = session && session.user ? session.user : null;

    supabaseClient.auth.onAuthStateChange(function (_event, nextSession) {
      var nextId = nextSession && nextSession.user ? nextSession.user.id : null;
      var prevId = sessionUser ? sessionUser.id : null;
      sessionUser = nextSession && nextSession.user ? nextSession.user : null;
      if (nextId === prevId) return;
      if (nextId === null) {
        // Sesión cerrada: limpiar TODO el estado anterior de inmediato.
        refreshSeq += 1; // Invalida respuestas en vuelo.
        currentVote = null;
        disarmRemove();
        renderVisual();
        setStatus(null);
      }
      refreshState();
    });

    await refreshState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
