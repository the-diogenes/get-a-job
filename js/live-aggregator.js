(function () {
  "use strict";

  let jobs = [];
  let meta = {};
  let currentUserId = null;

  const filters = { search: "", mode: "all", sort: "match" };

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function daysAgo(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / (86400000));
  }

  function passesFilter(job) {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const blob = [job.title, job.employer, ...(job.tags || []), job.source]
        .join(" ")
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }
    const cats = job.categories || [];
    const blob = `${job.title} ${job.experience_pitch || ""}`.toLowerCase();
    switch (filters.mode) {
      case "security":
        return cats.some((c) =>
          ["security", "loss-prevention", "corrections", "law-enforcement", "federal"].includes(c)
        );
      case "high-pay":
        return (job.pay_min || 0) >= 18;
      case "entry":
        return /entry|train|no experience|0-1/i.test(blob) || (job.match_score || 0) >= 60;
      case "high-match":
        return (job.match_score || 0) >= 70;
      default:
        return true;
    }
  }

  function sortJobs(list) {
    const arr = [...list];
    if (filters.sort === "date") {
      arr.sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
    } else if (filters.sort === "pay") {
      arr.sort((a, b) => (b.pay_min || 0) - (a.pay_min || 0));
    } else {
      arr.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
    }
    return arr;
  }

  function renderSetupBanner() {
    const el = document.getElementById("live-setup-banner");
    if (!el) return;
    const errs = meta.errors || [];
    if (meta.count > 0) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <strong>Live feed needs API keys.</strong>
      <p style="margin-top:0.5rem">Free signup at <a href="https://developer.adzuna.com/signup" target="_blank" rel="noopener">Adzuna</a>
      (primary). Optional: <a href="https://developer.usajobs.gov/apirequest/" target="_blank" rel="noopener">USAJobs</a> for federal posts.</p>
      <p style="margin-top:0.5rem">Add keys to <code>.env</code>, run <code>python scripts/fetch_live_jobs.py</code>, push — or add GitHub repo Secrets for daily auto-fetch.</p>
      ${errs.length ? `<ul style="margin-top:0.5rem;margin-left:1.1rem">${errs.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : ""}
    `;
  }

  function renderCard(job) {
    const s = currentUserId ? GAJTracker.getJobState(currentUserId, job.id) : {};
    const d = daysAgo(job.posted);
    const postedLabel = d != null ? `Posted ${d === 0 ? "today" : d + "d ago"}` : "Date unknown";
    const tier = job.match_tier || "bridge";
    const tierCls = tier === "high" ? "tier-high" : job.categories?.includes("security") ? "tier-security" : "";

    return `
      <article class="live-card ${tierCls}" data-id="${escapeHtml(job.id)}">
        <div class="live-card-head">
          <div>
            <h3>${escapeHtml(job.title)}</h3>
            <div class="employer">${escapeHtml(job.employer)}</div>
          </div>
          <span class="match-num">${job.match_score || "—"}</span>
        </div>
        <div class="live-card-meta">
          <span class="pay">${escapeHtml(job.pay_display)}</span>
          <span class="posted">${postedLabel}</span>
          <span class="source-tag">${escapeHtml(job.source || "live")}</span>
          ${tierBadge(tier)}
        </div>
        <p class="muted" style="font-size:0.82rem">${escapeHtml(job.address || "")}</p>
        <div class="status-row">
          <label class="status-check"><input type="checkbox" data-job="${escapeHtml(job.id)}" data-field="applied" ${s.applied ? "checked" : ""}><span>Applied</span></label>
          <label class="status-check"><input type="checkbox" data-job="${escapeHtml(job.id)}" data-field="called" ${s.called ? "checked" : ""}><span>Called</span></label>
          <label class="status-check"><input type="checkbox" data-job="${escapeHtml(job.id)}" data-field="interview" ${s.interview ? "checked" : ""}><span>Interview</span></label>
        </div>
        <div class="live-card-actions">
          <a class="btn btn-primary" href="${escapeHtml(job.apply_url)}" target="_blank" rel="noopener">Apply</a>
          <a class="btn btn-secondary" href="${indeedVerifyUrl(job)}" target="_blank" rel="noopener">Verify on Indeed</a>
        </div>
      </article>
    `;
  }

  function tierBadge(tier) {
    const labels = { high: "High match", medium: "Medium", bridge: "Bridge" };
    return `<span class="badge tier-${tier}">${labels[tier] || tier}</span>`;
  }

  function indeedVerifyUrl(job) {
    const q = encodeURIComponent(`${job.title} ${job.employer}`);
    return `https://www.indeed.com/jobs?q=${q}&l=Salem%2C+OR&fromage=14`;
  }

  function bindCards() {
    document.querySelectorAll(".live-card input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        if (!currentUserId) return;
        GAJTracker.setJobField(currentUserId, input.dataset.job, input.dataset.field, input.checked);
      });
    });
  }

  function renderList() {
    const el = document.getElementById("live-list");
    const filtered = sortJobs(jobs.filter(passesFilter));
    if (!filtered.length) {
      el.innerHTML =
        '<div class="empty-state">No live jobs match filters — try another filter or run the fetch script.</div>';
      return;
    }
    el.innerHTML = filtered.map(renderCard).join("");
    bindCards();
  }

  function updateMeta() {
    const fetched = document.getElementById("live-fetched");
    const count = document.getElementById("live-count");
    const sources = document.getElementById("live-sources");
    if (meta.fetched_at) {
      const d = new Date(meta.fetched_at);
      fetched.textContent = `Updated ${d.toLocaleString()}`;
    } else {
      fetched.textContent = "Not fetched yet";
    }
    count.textContent = `${meta.count ?? jobs.length} jobs (≤${meta.max_days_old || 14} days old)`;
    sources.textContent = (meta.sources_used || []).join(" · ") || "";
    renderSetupBanner();
  }

  async function loadLiveJobs() {
    const res = await fetch("data/live-jobs.json?" + Date.now());
    if (!res.ok) throw new Error("Could not load live-jobs.json");
    const data = await res.json();
    jobs = data.jobs || [];
    meta = data.meta || {};
    updateMeta();
    renderList();
  }

  function bindUI() {
    document.getElementById("live-search")?.addEventListener("input", (e) => {
      filters.search = e.target.value.trim();
      renderList();
    });
    document.getElementById("live-filter")?.addEventListener("change", (e) => {
      filters.mode = e.target.value;
      renderList();
    });
    document.getElementById("live-sort")?.addEventListener("change", (e) => {
      filters.sort = e.target.value;
      renderList();
    });
    document.getElementById("live-refresh-btn")?.addEventListener("click", () => {
      loadLiveJobs().catch((err) => alert(err.message));
    });
  }

  async function startLive(userId) {
    currentUserId = userId;
    document.getElementById("login-screen")?.classList.add("hidden");
    document.getElementById("live-shell")?.classList.remove("hidden");
    await GAJTracker.initForUser(userId);
    bindUI();
    await loadLiveJobs();
  }

  GAJAuth.requireAuth((userId) => {
    startLive(userId).catch((err) => {
      document.getElementById("live-list").innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
    });
  });
})();
