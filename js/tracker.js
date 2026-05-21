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
        bookmarked: false,
        hidden: false,
        notes: "",
        appliedAt: null,
        updatedAt: null,
      }
    );
  }

  function setJobField(userId, jobId, field, value) {
    const all = loadAll(userId);
    const cur = getJobState(userId, jobId);
    cur[field] = value;
    cur.updatedAt = new Date().toISOString();
    if (field === "applied" && value && !cur.appliedAt) {
      cur.appliedAt = cur.updatedAt;
    }
    all[jobId] = cur;
    saveAll(userId, all);
    return cur;
  }

  function getStats(userId, jobIds) {
    let applied = 0;
    let called = 0;
    let interview = 0;
    let bookmarked = 0;
    let hidden = 0;
    const all = loadAll(userId);
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
    const all = loadAll(userId);
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

  global.GAJTracker = {
    getJobState,
    setJobField,
    getStats,
    needsFollowUp,
    loadAll,
    getActivityLast7Days,
  };
})(window);
