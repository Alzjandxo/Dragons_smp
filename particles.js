/* ============================================================
 * DRAGONS SMP — Sistema de partículas DOM (único sistema activo)
 * ------------------------------------------------------------
 * 70 partículas HTML + 5 destellos, visibles de forma garantizada:
 * sin canvas, sin z-index negativo, sin opacidades bajas.
 * La capa va fija a viewport (visible en hero y al hacer scroll).
 * NO toca layout, textos, login ni Supabase.
 * ============================================================ */
(function () {
  'use strict';

  var LAYER_ID = 'particles-layer';
  var COUNT = 16; // fondo Sakura: pocas motas discretas
  var STAR_COUNT = 3;

  function init() {
    var layer = document.getElementById(LAYER_ID);
    if (!layer) return;
    if (layer.childElementCount > 0) return; // no duplicar nunca

    var frag = document.createDocumentFragment();
    var starsMade = 0;
    for (var i = 0; i < COUNT; i += 1) {
      var s = document.createElement('span');
      var cls = 'particle';
      if (starsMade < STAR_COUNT && i % 6 === 0) {
        cls += ' star';
        starsMade += 1;
      } else {
        var r = Math.random();
        cls += r < 0.6 ? ' normal' : (r < 0.9 ? ' small' : ' bright'); // 60/30/10
      }
      s.className = cls;
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.random() * 100).toFixed(2) + '%';
      s.style.setProperty('--d', (8 + Math.random() * 10).toFixed(2) + 's'); // 8-18s
      s.style.setProperty('--dl', (-Math.random() * 18).toFixed(2) + 's'); // fase aleatoria
      frag.appendChild(s);
    }
    layer.appendChild(frag);

    if (window.console && console.log) {
      console.log('[DragonsParticles] listo: ' + layer.childElementCount + ' nodos en #' + LAYER_ID);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
