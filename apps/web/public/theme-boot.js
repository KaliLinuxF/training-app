/*
 * Applies a forced theme («Світла» / «Темна») before the first paint.
 *
 * Loaded synchronously from <head> (index.html). The app bundle is a deferred module that runs
 * much later and calls applyTheme() again; without this script a cold start of the home-screen
 * app would first paint the page and the status bar in the system theme. It is a separate file
 * because the CSP allows only same-origin scripts (no inline ones).
 *
 * Same logic as applyTheme(getThemePref()) in src/lib/theme.ts (storage key, paper colours);
 * src/pwa/theme-boot.test.ts checks that both agree.
 */
/* global document, localStorage */
(function () {
  var PAPER = { light: '#F3F5F8', dark: '#12151A' };
  var pref;
  try {
    pref = localStorage.getItem('legko.theme');
  } catch {
    return; // storage blocked: «Авто», which is what the markup already says
  }
  if (pref !== 'light' && pref !== 'dark') return;
  document.documentElement.setAttribute('data-theme', pref);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', PAPER[pref]);
})();
