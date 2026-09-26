/* ============================================================
 * DRAGONS SMP — FX centralizado (fondo multicapa AAA)
 * ------------------------------------------------------------
 * Sistemas: parallax 3D por mouse, spotlight, cursor personalizado,
 * botones magnéticos, tilt 3D, ripple, noise procedural, progress.
 * Partículas: particles.js es el único sistema (DOM).
 * Todo con transform/opacity + un único requestAnimationFrame.
 * Kill-switches: window.DragonsFX.config.{sistema} = false.
 * Respeta prefers-reduced-motion y niveles por dispositivo.
 * NO toca OAuth, Supabase ni contenido. Solo efectos.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- Detección de entorno (síncrona, antes de DOMContentLoaded) ---------- */
  var reduceMotion = false;
  var finePointer = false;
  var coarsePointer = false;
  var viewportW = 1280;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    viewportW = Math.min(window.screen.width || window.innerWidth, window.innerWidth);
  } catch (err) { /* valores por defecto seguros */ }

  var isMobile = viewportW <= 680 || coarsePointer;
  var isTablet = !isMobile && viewportW <= 1024;

  var FX = {
    parallax: true,    // parallax 3D por mouse (máx ~12px)
    cursor: true,      // cursor punto + halo
    spotlight: true,   // luz radial que sigue al cursor
    magnetic: true,    // botones magnéticos 3-6px
    tilt: true,        // tilt 3D máx 4deg en cards
    ripple: true,      // ripple sutil en botones
    progress: true,    // barra de progreso de scroll
    noise: true        // grain procedural vía canvas
  };
  if (reduceMotion) {
    Object.keys(FX).forEach(function (k) { FX[k] = false; });
  }
  if (isMobile) {
    FX.parallax = false;
    FX.cursor = false;
    FX.tilt = false;
  }
  if (isTablet) {
    FX.tilt = false;
    FX.cursor = FX.cursor && finePointer;
  }
  if (!finePointer) {
    FX.cursor = false;
    FX.magnetic = false;
    FX.tilt = false;
  }

  window.DragonsFX = {
    config: FX,
    isMobile: isMobile,
    isTablet: isTablet,
    reduceMotion: reduceMotion
  };

  function log(msg) {
    if (window.console && console.log) console.log('[DragonsFX] ' + msg);
  }

  /* Sistema canvas de partículas ELIMINADO: particles.js es el único sistema activo. */
  /* ================= 1. NOISE procedural ================= */
  function initNoise() {
    var scene = document.querySelector('.bg-scene');
    if (!scene) return;
    try {
      var tile = document.createElement('canvas');
      tile.width = 128;
      tile.height = 128;
      var c = tile.getContext('2d');
      var img = c.createImageData(128, 128);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = (Math.random() * 255) | 0;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 14;
      }
      c.putImageData(img, 0, 0);
      var layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.pointerEvents = 'none';
      layer.style.opacity = '0.5';
      layer.style.backgroundImage = 'url(' + tile.toDataURL() + ')';
      scene.appendChild(layer);
    } catch (err) { /* noise opcional: la web sigue igual sin él */ }
  }

  /* ================= 3. Bucle único: mouse, parallax, cursor ================= */
  var mouseTX = 0;
  var mouseTY = 0;   // objetivo -1..1
  var mouseX = 0;
  var mouseY = 0;    // suavizado
  var scrollDy = 0;  // deriva vertical del hero por scroll (máx 40px)
  var cursorX = 0;
  var cursorY = 0;
  var spotX = 0;
  var spotY = 0;
  var parallaxTargets = [];
  var dot = null;
  var halo = null;
  var spotlight = null;
  var heroLayout = null;
  var heroLogo = null;
  var parallaxFactor = isTablet ? 0.4 : 1;

  function collectParallax() {
    parallaxTargets = [];
    var depths = [0.35, 0.5, 0.4, 0.55, 0.3];
    var orbs = document.querySelectorAll('.bg-aurora');
    orbs.forEach(function (el, idx) {
      parallaxTargets.push({ el: el, depth: depths[idx % depths.length] });
    });
    document.querySelectorAll('.bg-glow, .bg-nebula').forEach(function (el) {
      parallaxTargets.push({ el: el, depth: 0.22 });
    });
    heroLayout = document.querySelector('.hero-layout');
    heroLogo = document.querySelector('.hero-logo');
    if (heroLayout) parallaxTargets.push({ el: heroLayout, depth: 0.28, maxPx: 5, scroll: true });
    if (heroLogo) parallaxTargets.push({ el: heroLogo, depth: 0.55, maxPx: 9 });
  }

  function applyParallax() {
    for (var i = 0; i < parallaxTargets.length; i += 1) {
      var t = parallaxTargets[i];
      var cap = t.maxPx || 15;
      var px = Math.max(-cap, Math.min(cap, mouseX * 12 * t.depth * parallaxFactor));
      var py = Math.max(-cap, Math.min(cap, mouseY * 12 * t.depth * parallaxFactor));
      if (t.scroll) py += scrollDy; // deriva de scroll + parallax de mouse combinados
      t.el.style.translate = px.toFixed(2) + 'px ' + py.toFixed(2) + 'px';
    }
  }

  function frame(t) {
    // Interpolación suave del mouse.
    mouseX += (mouseTX - mouseX) * 0.06;
    mouseY += (mouseTY - mouseY) * 0.06;

    if (FX.parallax) applyParallax();

    if (dot) {
      cursorX += (mouseTX * 0.5 + 0.5 - cursorX) * 0.4;
      cursorY += (mouseTY * 0.5 + 0.5 - cursorY) * 0.4;
      dot._x += ((cursorX * window.innerWidth) - dot._x) * 0.5;
      dot._y += ((cursorY * window.innerHeight) - dot._y) * 0.5;
      dot.style.transform = 'translate3d(' + dot._x + 'px,' + dot._y + 'px,0) translate(-50%,-50%)';
    }
    if (halo) {
      halo._x += ((cursorX * window.innerWidth) - halo._x) * 0.16;
      halo._y += ((cursorY * window.innerHeight) - halo._y) * 0.16;
      halo.style.transform = 'translate3d(' + halo._x + 'px,' + halo._y + 'px,0) translate(-50%,-50%)';
    }
    if (spotlight) {
      spotX += ((cursorX * window.innerWidth) - spotX) * 0.1;
      spotY += ((cursorY * window.innerHeight) - spotY) * 0.1;
      spotlight.style.transform = 'translate3d(' + (spotX - 320) + 'px,' + (spotY - 320) + 'px,0)';
    }

    window.requestAnimationFrame(frame);
  }

  function initPointerSystems() {
    window.addEventListener('mousemove', function (e) {
      mouseTX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseTY = (e.clientY / window.innerHeight) * 2 - 1;
      if (!cursorInit) {
        cursorInit = true;
        cursorX = (e.clientX / window.innerWidth);
        cursorY = (e.clientY / window.innerHeight);
        var cx = e.clientX;
        var cy = e.clientY;
        if (dot) {
          dot._x = cx;
          dot._y = cy;
        }
        if (halo) {
          halo._x = cx;
          halo._y = cy;
        }
        if (spotlight) {
          spotX = cx;
          spotY = cy;
        }
      }
      cursorX = e.clientX / window.innerWidth;
      cursorY = e.clientY / window.innerHeight;
    }, { passive: true });

    // Halo crece sobre interactivos y cards (delegado, un solo listener).
    var CARD_SEL = '.server-point,.feature-card,.rank-card,.news-card,.unban-card';
    document.addEventListener('mouseover', function (e) {
      if (!halo) return;
      var t = e.target;
      if (t.closest && t.closest(CARD_SEL)) {
        halo.classList.add('is-card');
        halo.classList.remove('is-hover');
      } else if (t.closest && t.closest('a,button')) {
        halo.classList.add('is-hover');
        halo.classList.remove('is-card');
      }
    });
    document.addEventListener('mouseout', function (e) {
      if (!halo) return;
      var t = e.target;
      if (t.closest && (t.closest(CARD_SEL) || t.closest('a,button'))) {
        halo.classList.remove('is-hover');
        halo.classList.remove('is-card');
      }
    });

    // Spotlight por card vía CSS vars (mismo mousemove global, sin listeners extra).
    document.addEventListener('mousemove', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.fx-spotlight-card') : null;
      if (card) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }
    }, { passive: true });

    // Marca cards con spotlight.
    document.querySelectorAll('.server-point,.feature-card,.rank-card,.news-card,.unban-card').forEach(function (el) {
      el.classList.add('fx-spotlight-card');
    });

    // Proximidad del logo: glow reactivo.
    var logoBox = document.querySelector('.hero-logo');
    if (logoBox && finePointer) {
      document.addEventListener('mousemove', function (e) {
        var r = logoBox.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        logoBox.classList.toggle('is-near', Math.sqrt(dx * dx + dy * dy) < 340);
      }, { passive: true });
    }
  }
  var cursorInit = false;

  /* ================= 4. Botones magnéticos + tilt + ripple ================= */
  function initMagnetic() {
    var btns = document.querySelectorAll('.hero-actions .button, .purchase-contact-button');
    btns.forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        var mx = Math.max(-6, Math.min(6, dx * 0.08));
        var my = Math.max(-6, Math.min(6, dy * 0.12));
        btn.style.translate = mx.toFixed(1) + 'px ' + my.toFixed(1) + 'px';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.translate = '';
      });
    });
  }

  function initTilt() {
    var els = document.querySelectorAll('.server-point,.feature-card,.rank-card,.news-card');
    els.forEach(function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var rx = ((e.clientY - r.top) / r.height - 0.5) * -8; // máx ±4deg
        var ry = ((e.clientX - r.left) / r.width - 0.5) * 8;
        el.style.transform = 'perspective(700px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-4px)';
      });
      el.addEventListener('mouseleave', function () {
        el.style.transform = '';
      });
    });
  }

  function initRipple() {
    document.addEventListener('pointerdown', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.button') : null;
      if (!btn) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height) * 2.2;
      var s = document.createElement('span');
      s.className = 'ripple';
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.left = (e.clientX - r.left - size / 2) + 'px';
      s.style.top = (e.clientY - r.top - size / 2) + 'px';
      btn.appendChild(s);
      s.addEventListener('animationend', function () {
        s.remove();
      });
    });
  }

  /* ================= 5. Scroll: progress + deriva del hero ================= */
  function initScroll() {
    var bar = document.getElementById('scroll-progress');
    var ticking = false;
    function update() {
      ticking = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? (window.scrollY || 0) / max : 0;
      if (bar && FX.progress) bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      // Profundidad: el hero deriva apenas al hacer scroll (máx 40px).
      scrollDy = 0;
      if (heroLayout && (window.scrollY || 0) < window.innerHeight * 1.2) {
        scrollDy = Math.min(40, (window.scrollY || 0) * 0.06);
      } else if (heroLayout && (window.scrollY || 0) >= window.innerHeight * 1.2) {
        scrollDy = 40;
      }
      // Sin parallax de mouse, el scroll aplica la deriva directamente.
      if (heroLayout && !FX.parallax) heroLayout.style.translate = '0 ' + scrollDy.toFixed(1) + 'px';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  /* ================= 6. Arranque ================= */
  function init() {
    dot = document.getElementById('fx-cursor-dot');
    halo = document.getElementById('fx-cursor-halo');
    spotlight = document.getElementById('fx-spotlight');
    if (dot) {
      dot._x = window.innerWidth / 2;
      dot._y = window.innerHeight * 0.4;
    }
    if (halo) {
      halo._x = window.innerWidth / 2;
      halo._y = window.innerHeight * 0.4;
    }
    if (spotlight) {
      spotX = window.innerWidth / 2;
      spotY = window.innerHeight * 0.35;
    }

    if (FX.noise) initNoise();
    if (FX.parallax || FX.cursor || FX.spotlight) {
      collectParallax();
      initPointerSystems();
      window.requestAnimationFrame(frame);
    }
    if (FX.magnetic) initMagnetic();
    if (FX.tilt) initTilt();
    if (FX.ripple) initRipple();
    initScroll();
    if (FX.cursor) document.body.classList.add('fx-cursor-on');

    window.requestAnimationFrame(function () {
      document.body.classList.add('fx-ready');
    });

    var active = Object.keys(FX).filter(function (k) { return FX[k]; }).join(',');
    log('listo (móvil=' + isMobile + ', activos: ' + (active || 'ninguno, modo estático') + ')');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
