(function (global) {
  "use strict";

  const STORAGE_KEY = "gaj_cloud_config";

  function get() {
    const base = global.GAJ_CONFIG || {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        return { ...base, ...stored };
      }
    } catch {
      /* ignore */
    }
    return base;
  }

  function save(partial) {
    const next = { ...get(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (global.GAJSupabase && global.GAJSupabase.resetClient) {
      global.GAJSupabase.resetClient();
    }
    return next;
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
    if (global.GAJSupabase && global.GAJSupabase.resetClient) {
      global.GAJSupabase.resetClient();
    }
  }

  function isConfigured() {
    const c = get();
    const url = (c.supabaseUrl || "").trim();
    const key = (c.supabaseAnonKey || "").trim();
    if (!url || !key) return false;
    if (url.includes("YOUR_PROJECT") || key.includes("YOUR_ANON")) return false;
    return true;
  }

  global.GAJCloudConfig = {
    get,
    save,
    clear,
    isConfigured,
    STORAGE_KEY,
  };
})(window);
