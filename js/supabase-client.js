(function (global) {
  "use strict";

  let client = null;

  function getConfig() {
    if (global.GAJCloudConfig) return global.GAJCloudConfig.get();
    return global.GAJ_CONFIG || null;
  }

  function isConfigured() {
    if (global.GAJCloudConfig) return global.GAJCloudConfig.isConfigured();
    const c = getConfig();
    return !!(c && c.supabaseUrl && c.supabaseAnonKey);
  }

  function resetClient() {
    client = null;
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client && global.supabase) {
      const c = getConfig();
      client = global.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
    }
    return client;
  }

  global.GAJSupabase = {
    isConfigured,
    getClient,
    getConfig,
    resetClient,
  };
})(window);
