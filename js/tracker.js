(function (global) {
  "use strict";

  const PREFIX = "gaj_tracker_";

  function storageKey(userId) {
    return PREFIX + userId;
  }

  function loadAll(userId) {
    try {
      const raw = localStorage.getItem(storageKey(userId));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveAll(userId, data) {
    localStorage.setItem(storageKey(userId), JSON.stringify(data));
  }

  function getJobState(userId, jobId) {
    const all = loadAll(userId);
    return (
      all[jobId] || {
        applied: false,
        called: false,
        interview: false,
        notes: "",
        updatedAt: null,
      }
    );
  }

  function setJobField(userId, jobId, field, value) {
    const all = loadAll(userId);
    const cur = getJobState(userId, jobId);
    cur[field] = value;
    cur.updatedAt = new Date().toISOString();
    all[jobId] = cur;
    saveAll(userId, all);
    return cur;
  }

  function toggleField(userId, jobId, field) {
    const cur = getJobState(userId, jobId);
    return setJobField(userId, jobId, field, !cur[field]);
  }

  function getStats(userId, jobIds) {
    let applied = 0;
    let called = 0;
    let interview = 0;
    const all = loadAll(userId);
    jobIds.forEach((id) => {
      const s = all[id];
      if (!s) return;
      if (s.applied) applied++;
      if (s.called) called++;
      if (s.interview) interview++;
    });
    return { applied, called, interview };
  }

  function needsFollowUp(userId, jobId) {
    const s = getJobState(userId, jobId);
    return s.applied && !s.called;
  }

  global.GAJTracker = {
    getJobState,
    setJobField,
    toggleField,
    getStats,
    needsFollowUp,
    loadAll,
  };
})(window);
