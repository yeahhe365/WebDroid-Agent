/* Runs before React mounts so an explicit light/dark choice does not flash the
   opposite theme. Kept as a self-hosted file because the CSP allows only 'self'
   scripts (no inline script). */
;(function () {
  try {
    var raw = window.localStorage.getItem('webdroid-agent-settings')
    var settings = raw ? JSON.parse(raw) : null
    var theme = settings && settings.themeMode
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.dataset.theme = theme
    }

    var language = settings && settings.languageMode
    if (language !== 'zh-CN' && language !== 'en-US') {
      var browser =
        (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US'
      language = String(browser).toLowerCase().indexOf('zh') === 0 ? 'zh-CN' : 'en-US'
    }
    document.documentElement.lang = language
  } catch (error) {
    /* localStorage can be unavailable in private mode; React will re-apply. */
  }
})()
