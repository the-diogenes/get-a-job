(function (global) {
  "use strict";

  let client = null;

  function getConfig() {
    return global.GAJ_CONFIG || null;
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c && c.supabaseUrl && c.supabaseAnonKey);
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client && global.supabase) {
      client = global.supabase.createClient(
        getConfig().supabaseUrl,
        getConfig().supabaseAnonKey
      );
    }
    return client;
  }

  global.GAJSupabase = {
    isConfigured,
    getClient,
    getConfig,
  };
})(window);
