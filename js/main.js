/* Instaclot: top bar shadow, pinned hero animation, hero button behavior, smooth in-page links. */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* ---------- Top bar: slight shadow once the page has scrolled ---------- */
  var bar = document.querySelector(".topbar");
  function updateBar() {
    if (bar) { bar.classList.toggle("is-scrolled", window.scrollY > 4); }
  }
  window.addEventListener("scroll", updateBar, { passive: true });
  updateBar();

  /* ---------- Smooth scroll to an in-page target and update the URL hash ---------- */
  function scrollToHash(hash, pushState) {
    var target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) { return false; }
    target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    if (pushState && window.history && history.pushState) { history.pushState(null, "", hash); }
    return true;
  }

  /* ---------- Hero: pinned stage driven by one scroll-progress value ---------- */
  var hero = document.getElementById("home");
  var stage = hero && hero.querySelector(".hero__stage");
  var stemG = document.getElementById("stem-g");
  var cottonG = document.getElementById("cotton-g");

  // Stage geometry in the SVG's own units (source pixels of the part renders)
  var G = { stemTravel: 316, cottonTravel: 187, cottonGrow: 0.08, originX: 130, originY: 330 };
  var DURATION = 1400;        // ms for the button-triggered finish
  var range = 1;              // scroll distance (px) the pin lasts
  var forced = null;          // progress override while a button finishes the animation
  var animating = false;
  var drawn = -1;
  var queued = false;

  function measure() {
    if (!hero || !stage) { return; }
    range = Math.max(1, hero.offsetHeight - stage.offsetHeight);
  }

  function scrollProgress() {
    if (reduceMotion.matches) { return 1; }
    return clamp(window.scrollY / range, 0, 1);
  }

  // Only two things move, both from the same value: the stem and the cotton.
  function draw(p) {
    if (!stemG || !cottonG) { return; }
    if (p === drawn) { return; }
    drawn = p;
    var stemY = (G.stemTravel * (1 - p)).toFixed(2);
    var cottonY = (-G.cottonTravel * p).toFixed(2);
    var grow = (1 + G.cottonGrow * p).toFixed(4);
    stemG.setAttribute("transform", "translate(0 " + stemY + ")");
    cottonG.setAttribute("transform",
      "translate(0 " + cottonY + ") translate(" + G.originX + " " + G.originY + ") scale(" + grow + ") translate(" + (-G.originX) + " " + (-G.originY) + ")");
  }

  function frame() {
    queued = false;
    draw(forced !== null ? forced : scrollProgress());
  }
  function schedule() {
    if (!queued) { queued = true; window.requestAnimationFrame(frame); }
  }

  function currentProgress() { return forced !== null ? forced : scrollProgress(); }

  // Animate the progress from where it is to 100% while scrolling is paused, then call done()
  function finishThen(done) {
    animating = true;
    var from = currentProgress();
    var start = null;
    var finished = false;
    var failsafe = null;
    var stop = function (e) { e.preventDefault(); };
    root.classList.add("is-locked");
    window.addEventListener("wheel", stop, { passive: false });
    window.addEventListener("touchmove", stop, { passive: false });

    function complete() {
      if (finished) { return; }
      finished = true;
      window.clearTimeout(failsafe);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      root.classList.remove("is-locked");
      // The pinned stage looks identical at the end of the pin, so jump there instantly
      // and the scroll position agrees with the finished animation before leaving.
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, range);
      root.style.scrollBehavior = "";
      forced = null;
      animating = false;
      drawn = -1;
      draw(1);
      done();
    }

    function step(ts) {
      if (finished) { return; }
      if (start === null) { start = ts; }
      var t = clamp((ts - start) / DURATION, 0, 1);
      forced = from + (1 - from) * easeInOut(t);
      draw(forced);
      if (t < 1) { window.requestAnimationFrame(step); } else { complete(); }
    }

    // If frames never arrive (hidden tab, odd webview), never leave the page locked
    failsafe = window.setTimeout(complete, DURATION + 600);
    window.requestAnimationFrame(step);
  }

  function go(href) {
    if (href.charAt(0) === "#") { scrollToHash(href, true); }
    else { window.location.href = href; }
  }

  function onHeroNav(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
    e.preventDefault();
    if (animating) { return; }
    var href = this.getAttribute("href");
    if (reduceMotion.matches || currentProgress() >= 0.995) { go(href); return; }
    finishThen(function () { go(href); });
  }

  if (hero && stage && stemG && cottonG) {
    measure();
    frame();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", function () { measure(); schedule(); });
    window.addEventListener("load", function () { measure(); schedule(); });
    if (window.ResizeObserver) { new ResizeObserver(function () { measure(); schedule(); }).observe(hero); }
    if (reduceMotion.addEventListener) { reduceMotion.addEventListener("change", function () { drawn = -1; measure(); schedule(); }); }

    var heroLinks = document.querySelectorAll("[data-hero-nav]");
    for (var i = 0; i < heroLinks.length; i++) { heroLinks[i].addEventListener("click", onHeroNav); }
  }

  /* ---------- Other in-page links (footer): smooth scroll + hash ---------- */
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a[href^='#']") : null;
    if (!a || a.hasAttribute("data-hero-nav") || e.defaultPrevented) { return; }
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
    var hash = a.getAttribute("href");
    if (hash.length > 1 && scrollToHash(hash, true)) { e.preventDefault(); }
  });

  // Back/forward cache: never come back with the page locked
  window.addEventListener("pageshow", function () {
    root.classList.remove("is-locked");
    animating = false;
    forced = null;
    drawn = -1;
    measure();
    schedule();
  });
})();
