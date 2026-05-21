(function (global) {
  "use strict";

  const PREFIX = "gaj_tracker_";
  const SAVE_DEBOUNCE_MS = 400;

  let cache = {};
  let activeUserId = null;
  let syncEnabled = false;
  let syncStatus = "local"; // local | loading | synced | error | offline
  let saveTimers = new Map();
  let statusListeners = [];

  function defaultJobState() {
    return {
      applied: false,
      called: false,
      interview: false,
      bookmarked: false,
      hidden: false,
      notes: "",
      appliedAt: null,
      updatedAt: null,
    };
  }

  function storageKey(userId) {
    return PREFIX + userId;
  }

  function loadLocal(userId) {
    try {
      const raw = localStorage.getItem(storageKey(userId));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveLocal(userId, data) {
    localStorage.setItem(storageKey(userId), JSON.stringify(data));
  }

  function getConfig() {
    return global.GAJ_CONFIG || null;
  }

  function isSyncConfigured() {
    const c = getConfig();
    return !!(c && c.supabaseUrl && c.supabaseAnonKey);
  }

  function supabaseHeaders(extra) {
    const key = getConfig().supabaseAnonKey;
    return {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  function rowToState(row) {
    return {
      applied: !!row.applied,
      called: !!row.called,
      interview: !!row.interview,
      bookmarked: !!row.bookmarked,
      hidden: !!row.hidden,
      notes: row.notes || "",
      appliedAt: row.applied_at || null,
      updatedAt: row.updated_at || null,
    };
  }

  function stateToRow(userId, jobId, state) {
    return {
      user_id: userId,
      job_id: jobId,
      applied: !!state.applied,
      called: !!state.called,
      interview: !!state.interview,
      bookmarked: !!state.bookmarked,
      hidden: !!state.hidden,
      notes: state.notes || "",
      applied_at: state.appliedAt || null,
      updated_at: state.updatedAt || new Date().toISOString(),
    };
  }

  function mergeJobState(a, b) {
    if (!a) return b ? { ...b } : defaultJobState();
    if (!b) return { ...a };
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return aTime >= bTime ? { ...a } : { ...b };
  }

  function mergeAll(local, cloud) {
    const merged = { ...local };
    Object.keys(cloud).forEach((jobId) => {
      merged[jobId] = mergeJobState(local[jobId], cloud[jobId]);
    });
    return merged;
  }

  function setSyncStatus(status) {
    syncStatus = status;
    statusListeners.forEach((fn) => fn(status));
  }

  function onSyncStatus(fn) {
    statusListeners.push(fn);
    fn(syncStatus);
  }

  function getSyncStatus() {
    return syncStatus;
  }

  async function fetchCloud(userId) {
    const base = getConfig().supabaseUrl.replace(/\/$/, "");
    const url = `${base}/rest/v1/job_tracker?user_id=eq.${encodeURIComponent(userId)}&select=*`;
    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloud load failed (${res.status}): ${text}`);
    }
    const rows = await res.json();
    const out = {};
    rows.forEach((row) => {
      out[row.job_id] = rowToState(row);
    });
    return out;
  }

  async function upsertCloud(userId, jobId, state) {
    const base = getConfig().supabaseUrl.replace(/\/$/, "");
    const url = `${base}/rest/v1/job_tracker?on_conflict=user_id,job_id`;
    const res = await fetch(url, {
      method: "POST",
      headers: supabaseHeaders({
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify([stateToRow(userId, jobId, state)]),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloud save failed (${res.status}): ${text}`);
    }
  }

  function queueCloudSave(userId, jobId) {
    const key = `${userId}:${jobId}`;
    if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
    saveTimers.set(
      key,
      setTimeout(async () => {
        saveTimers.delete(key);
        if (!syncEnabled || activeUserId !== userId) return;
        try {
          await upsertCloud(userId, jobId, cache[jobId]);
          setSyncStatus("synced");
        } catch (err) {
          console.warn("GAJ tracker cloud save:", err);
          setSyncStatus("error");
        }
      }, SAVE_DEBOUNCE_MS)
    );
  }

  async function initForUser(userId) {
    activeUserId = userId;
    const local = loadLocal(userId);
    syncEnabled = isSyncConfigured();

    if (!syncEnabled) {
      cache = local;
      setSyncStatus("local");
      return { mode: "local" };
    }

    setSyncStatus("loading");
    try {
      const cloud = await fetchCloud(userId);
      cache = mergeAll(local, cloud);
      saveLocal(userId, cache);
      setSyncStatus("synced");

      // Push any local-only rows that are newer than cloud
      const uploads = Object.entries(cache).filter(([jobId, state]) => {
        const cloudState = cloud[jobId];
        if (!cloudState) return true;
        const localT = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
        const cloudT = cloudState.updatedAt ? new Date(cloudState.updatedAt).getTime() : 0;
        return localT > cloudT;
      });
      await Promise.all(
        uploads.map(([jobId, state]) => upsertCloud(userId, jobId, state).catch(() => {}))
      );

      return { mode: "cloud", count: Object.keys(cache).length };
    } catch (err) {
      console.warn("GAJ tracker cloud load:", err);
      cache = local;
      setSyncStatus("offline");
      return { mode: "offline", error: err.message };
    }
  }

  function loadAll(userId) {
    if (userId === activeUserId) return { ...cache };
    return loadLocal(userId);
  }

  function getJobState(userId, jobId) {
    const all = userId === activeUserId ? cache : loadLocal(userId);
    return all[jobId] ? { ...all[jobId] } : defaultJobState();
  }

  function setJobField(userId, jobId, field, value) {
    if (userId === activeUserId) {
      const cur = cache[jobId] ? { ...cache[jobId] } : defaultJobState();
      cur[field] = value;
      cur.updatedAt = new Date().toISOString();
      if (field === "applied" && value && !cur.appliedAt) {
        cur.appliedAt = cur.updatedAt;
      }
      cache[jobId] = cur;
      saveLocal(userId, cache);
      if (syncEnabled) queueCloudSave(userId, jobId);
      return { ...cur };
    }

    const all = loadLocal(userId);
    const cur = getJobState(userId, jobId);
    cur[field] = value;
    cur.updatedAt = new Date().toISOString();
    if (field === "applied" && value && !cur.appliedAt) {
      cur.appliedAt = cur.updatedAt;
    }
    all[jobId] = cur;
    saveLocal(userId, all);
    return cur;
  }

  function getStats(userId, jobIds) {
    const all = userId === activeUserId ? cache : loadLocal(userId);
    let applied = 0;
    let called = 0;
    let interview = 0;
    let bookmarked = 0;
    let hidden = 0;
    jobIds.forEach((id) => {
      const s = all[id];
      if (!s) return;
      if (s.applied) applied++;
      if (s.called) called++;
      if (s.interview) interview++;
      if (s.bookmarked) bookmarked++;
      if (s.hidden) hidden++;
    });
    return { applied, called, interview, bookmarked, hidden };
  }

  function needsFollowUp(userId, jobId) {
    const s = getJobState(userId, jobId);
    return s.applied && !s.called;
  }

  function getActivityLast7Days(userId) {
    const all = userId === activeUserId ? cache : loadLocal(userId);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let applied = 0;
    let called = 0;
    Object.values(all).forEach((s) => {
      if (s.updatedAt && new Date(s.updatedAt).getTime() > cutoff) {
        if (s.applied) applied++;
        if (s.called) called++;
      }
    });
    return { applied, called };
  }

  function clearActiveUser() {
    activeUserId = null;
    cache = {};
    saveTimers.forEach((t) => clearTimeout(t));
    saveTimers.clear();
  }

  global.GAJTracker = {
    initForUser,
    getJobState,
    setJobField,
    getStats,
    needsFollowUp,
    loadAll,
    getActivityLast7Days,
    onSyncStatus,
    getSyncStatus,
    isSyncConfigured,
    clearActiveUser,
  };
})(window);
