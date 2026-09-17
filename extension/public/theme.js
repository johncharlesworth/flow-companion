// Applies the remembered theme before the bundle loads so there is no flash.
// A separate file, not inline: MV3 forbids inline scripts in extension pages.
(function () {
  try {
    var theme = localStorage.getItem('flow-companion:theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    }
  } catch (_) {
    /* storage unavailable: the system theme applies */
  }
})();
