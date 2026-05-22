(function () {
  "use strict";

  const PAY_MULT = { hourly: 2080, monthly: 12, annual: 1 };
  const EARTH_R_MI = 3958.8;
  // Home base: Clark Creek Village Apts, 884 Fairview Ave SE, Salem OR 97302
  const HOME = { lat: 44.9173, lng: -123.0048, label: "Clark Creek Village" };
  const SALEM_VIEW = { center: [44.9173, -123.0048], zoom: 11 };
  const SALEM_BOUNDS = L.latLngBounds(
    [44.72, -123.62], // SW — Salem metro + Brooks/Keizer
    [45.08, -122.88]  // NE
  );
  // Rough Salem driving speed avg, used for commute estimate.
  // Local roads ~25 mph in town; +3 min minimum for warm-up/parking.
  const COMMUTE_MIN_PER_MILE = 2.2;
  const COMMUTE_BASE_MIN = 3;
  const FRESHNESS_FRESH_DAYS = 21;
  const FRESHNESS_STALE_DAYS = 60;

  let allJobs = [];
  let resources = [];
  let meta = {};
  let profile = {};
  let currentUserId = null;
  let map = null;
  let mapMobile = null;
  let markersLayer = null;
  let markersLayerMobile = null;
  let markerById = new Map();
  let mapInitialized = false;
  let mapMobileInitialized = false;
  let activeId = null;

  const filters = {
    search: "",
    category: "all",
    tier: "all",
    status: "all",
    southOnly: false,
    hasContact: false,
    securityOnly: false,
    priorityOnly: false,
    openOnly: false,
    bookmarkedOnly: false,
    hideHidden: true,
  };

  let sortMode = "match"; // "match" | "pay" | "distance"

  // ---------- helpers ----------

  function annualizedPay(job) {
    const mult = PAY_MULT[job.pay_type] || 1;
    return (job.pay_max || job.pay_min || 0) * mult;
  }

  function distanceMi(lat, lng) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat - HOME.lat);
    const dLng = toRad(lng - HOME.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(HOME.lat)) *
        Math.cos(toRad(lat)) *
        Math.sin(dLng / 2) ** 2;
    return EARTH_R_MI * 2 * Math.asin(Math.sqrt(a));
  }

  function jobDistance(job) {
    if (job._distance != null) return job._distance;
    job._distance = distanceMi(job.lat, job.lng);
    return job._distance;
  }

  // Convert straight-line miles to a rough drive-time estimate.
  // Multiply by 1.25 for actual road routing vs straight line.
  // First ~8 miles use city speed; remainder uses highway speed.
  function commuteMin(job) {
    const driveMiles = jobDistance(job) * 1.25;
    const urban = Math.min(driveMiles, 8) * COMMUTE_MIN_PER_MILE;
    const highway = Math.max(0, driveMiles - 8) * 1.2;
    return Math.max(3, Math.round(COMMUTE_BASE_MIN + urban + highway));
  }

  function daysSince(isoDate) {
    if (!isoDate) return null;
    const t = new Date(isoDate).getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  }

  function freshness(job) {
    if (!job.posted) {
      return { label: "Curated — verify live", cls: "fresh-stale" };
    }
    const days = daysSince(job.posted);
    if (days == null) return { label: "Verify before applying", cls: "fresh-unknown" };
    if (days <= FRESHNESS_FRESH_DAYS) return { label: `Fresh · ${days}d`, cls: "fresh-fresh" };
    if (days <= FRESHNESS_STALE_DAYS) return { label: `${days}d old`, cls: "fresh-aging" };
    return { label: `Stale · ${days}d — verify`, cls: "fresh-stale" };
  }

  function liveSearchUrl(job) {
    const q = encodeURIComponent(`${job.title} ${job.employer}`);
    return `https://www.indeed.com/jobs?q=${q}&l=Salem%2C+OR&sc=0kf%3Aattr%28D7S5D%29%3B&fromage=14`;
  }

  function sortJobs(jobs) {
    const arr = [...jobs];
    if (sortMode === "pay") {
      arr.sort((a, b) => annualizedPay(b) - annualizedPay(a));
    } else if (sortMode === "distance") {
      arr.sort((a, b) => jobDistance(a) - jobDistance(b));
    } else {
      arr.sort((a, b) => {
        const ms = (b.match_score || 0) - (a.match_score || 0);
        if (ms !== 0) return ms;
        return annualizedPay(b) - annualizedPay(a);
      });
    }
    return arr;
  }

  function statusFilterPass(job) {
    if (!currentUserId || filters.status === "all") return true;
    const s = GAJTracker.getJobState(currentUserId, job.id);
    switch (filters.status) {
      case "not_applied":
        return !s.applied;
      case "applied":
        return s.applied;
      case "need_followup":
        return GAJTracker.needsFollowUp(currentUserId, job.id);
      case "interview":
        return s.interview;
      default:
        return true;
    }
  }

  function matchesFilters(job) {
    const state = currentUserId ? GAJTracker.getJobState(currentUserId, job.id) : null;
    if (filters.hideHidden && state && state.hidden) return false;
    if (filters.bookmarkedOnly && !(state && state.bookmarked)) return false;
    if (!statusFilterPass(job)) return false;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      const blob = [
        job.title,
        job.employer,
        job.address,
        ...(job.categories || []),
        ...(job.tags || []),
        job.experience_pitch,
      ]
        .join(" ")
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (filters.category !== "all") {
      if (!(job.categories || []).includes(filters.category)) return false;
    }
    if (filters.tier !== "all") {
      if ((job.match_tier || "") !== filters.tier) return false;
    }
    if (filters.southOnly && !job.south_salem) return false;
    if (filters.hasContact && !(job.contacts || []).length) return false;
    if (filters.securityOnly) {
      const sec = ["security", "loss-prevention", "corrections", "law-enforcement", "supervisor"];
      if (!(job.categories || []).some((c) => sec.includes(c))) return false;
    }
    if (filters.priorityOnly && !job.priority_call) return false;
    if (filters.openOnly && job.status !== "open") return false;
    return true;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  // ---------- header / progress ----------

  function updateProgressStats() {
    if (!currentUserId) return;
    const ids = allJobs.map((j) => j.id);
    const stats = GAJTracker.getStats(currentUserId, ids);
    const w = GAJTracker.getActivityLast7Days(currentUserId);
    setText("stat-applied", stats.applied);
    setText("stat-called", stats.called);
    setText("stat-interview", stats.interview);
    setText("stat-week-applied", w.applied);
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  // ---------- card render ----------

  function tierBadge(tier) {
    if (!tier) return "";
    const labels = { high: "High match", medium: "Medium", bridge: "Bridge", stretch: "Stretch" };
    return `<span class="badge tier-${tier}">${labels[tier] || tier}</span>`;
  }

  function renderContacts(contacts) {
    if (!contacts || !contacts.length) {
      return '<p class="label">Contact</p><p class="muted">No direct contact — apply online, then call main HR.</p>';
    }
    return (
      '<p class="label">Contacts</p><ul class="contact-list">' +
      contacts
        .map((c) => {
          let inner = "";
          if (c.type === "phone") {
            inner = `<a class="btn btn-call" href="tel:${c.value.replace(/\D/g, "")}">${escapeHtml(c.value)}</a> <span class="muted">(${escapeHtml(c.label)})</span>`;
          } else if (c.type === "email") {
            inner = `<a href="mailto:${escapeHtml(c.value)}">${escapeHtml(c.value)}</a> <span class="muted">(${escapeHtml(c.label)})</span>`;
          } else {
            inner = `<a href="${escapeHtml(c.value)}" target="_blank" rel="noopener">${escapeHtml(c.label || "Link")}</a>`;
          }
          return `<li>${inner}</li>`;
        })
        .join("") +
      "</ul>"
    );
  }

  function renderLicenses(arr) {
    if (!arr || !arr.length) return '<p class="muted"><em>No special licenses listed.</em></p>';
    return "<ul>" + arr.map((l) => `<li>${escapeHtml(l)}</li>`).join("") + "</ul>";
  }

  function copyFollowUpText(job) {
    const today = new Date().toLocaleDateString();
    const yrs = profile.years_security || 16;
    return `Hi — I applied online for ${job.title} at ${job.employer} on ${today}. I have ${yrs} years of security experience and an active Oregon DPSST license. Who should I speak with about next steps? Thank you.`;
  }

  function renderCard(job, rank) {
    const s = currentUserId ? GAJTracker.getJobState(currentUserId, job.id) : {};
    const cls = [
      "job-card",
      s.applied ? "job-applied" : "",
      GAJTracker.needsFollowUp(currentUserId, job.id) ? "job-needs-call" : "",
      s.bookmarked ? "job-bookmarked" : "",
    ].join(" ");

    const tags = (job.tags || []).slice(0, 3).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const cats = (job.categories || []).slice(0, 2).map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("");
    const fresh = freshness(job);
    const flags = [
      tierBadge(job.match_tier),
      job.south_salem ? '<span class="badge south">South Salem</span>' : "",
      job.priority_call ? '<span class="badge priority">Call today</span>' : "",
      job.status === "verify" ? '<span class="badge verify">Verify</span>' : "",
      s.interview ? '<span class="badge interview">Interview</span>' : "",
      `<span class="badge ${fresh.cls}">${escapeHtml(fresh.label)}</span>`,
    ].join("");

    const dist = jobDistance(job).toFixed(1);
    const drive = commuteMin(job);

    const applyLinks = [
      job.apply_url ? `<a class="btn btn-primary" href="${escapeHtml(job.apply_url)}" target="_blank" rel="noopener">Apply</a>` : "",
      job.apply_url_alt ? `<a class="btn btn-secondary" href="${escapeHtml(job.apply_url_alt)}" target="_blank" rel="noopener">Alt</a>` : "",
    ].join("");
    const phoneBtn = (job.contacts || [])
      .filter((c) => c.type === "phone")
      .slice(0, 1)
      .map((c) => `<a class="btn btn-call" href="tel:${c.value.replace(/\D/g, "")}">Call</a>`)
      .join("");

    return `
      <article class="${cls}" data-id="${escapeHtml(job.id)}" tabindex="0">
        <div class="card-head">
          <div class="rank">#${rank}${job.match_score ? `<br><span class="match-num">${job.match_score}</span>` : ""}</div>
          <div class="card-head-text">
            <h3>${escapeHtml(job.title)}</h3>
            <div class="employer">${escapeHtml(job.employer)}</div>
            <div class="card-meta-row">
              <span class="pay">${escapeHtml(job.pay_display)}</span>
              <span class="dist" title="From Clark Creek Village (straight-line distance)">${dist} mi</span>
              <span class="commute" title="Estimated drive time from home — verify with maps">~${drive} min</span>
            </div>
          </div>
          <button type="button" class="bookmark-btn ${s.bookmarked ? "on" : ""}" data-bookmark="${escapeHtml(job.id)}" aria-label="Bookmark">★</button>
        </div>
        <div class="badges">${cats}${flags}</div>
        ${tags ? `<div class="tag-row">${tags}</div>` : ""}
        <div class="status-row">
          <label class="status-check"><input type="checkbox" data-job="${escapeHtml(job.id)}" data-field="applied" ${s.applied ? "checked" : ""}><span>Applied</span></label>
          <label class="status-check"><input type="checkbox" data-job="${escapeHtml(job.id)}" data-field="called" ${s.called ? "checked" : ""}><span>Called</span></label>
          <label class="status-check"><input type="checkbox" data-job="${escapeHtml(job.id)}" data-field="interview" ${s.interview ? "checked" : ""}><span>Interview</span></label>
        </div>
        <div class="job-detail">
          <p class="label">Address</p>
          <p>${escapeHtml(job.address)}</p>
          <p class="label">Why you fit</p>
          <p>${escapeHtml(job.experience_pitch)}</p>
          <p class="label">Licenses / requirements</p>
          ${renderLicenses(job.licenses_required)}
          ${job.shift ? `<p class="label">Shift</p><p>${escapeHtml(job.shift)}</p>` : ""}
          ${renderContacts(job.contacts)}
          <label class="notes-label">
            <span class="label">Your notes</span>
            <textarea data-job="${escapeHtml(job.id)}" data-notes rows="2" placeholder="Called Mike, callback Thu…">${escapeHtml(s.notes || "")}</textarea>
          </label>
          <div class="actions">
            ${applyLinks}${phoneBtn}
            <a class="btn btn-secondary" href="${escapeHtml(liveSearchUrl(job))}" target="_blank" rel="noopener" title="Check Indeed for current listing">Verify live</a>
            <a class="btn btn-secondary" href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent("884 Fairview Ave SE, Salem, OR 97302")}&destination=${encodeURIComponent(job.address || job.lat + "," + job.lng)}" target="_blank" rel="noopener">Directions</a>
            <button type="button" class="btn btn-secondary btn-copy" data-copy="${escapeHtml(job.id)}">Copy follow-up</button>
            <button type="button" class="btn btn-secondary btn-map-jump" data-map="${escapeHtml(job.id)}">Map</button>
            <button type="button" class="btn btn-secondary btn-share" data-share="${escapeHtml(job.id)}">Share</button>
            <button type="button" class="btn btn-ghost btn-hide" data-hide="${escapeHtml(job.id)}">${s.hidden ? "Unhide" : "Hide"}</button>
          </div>
        </div>
      </article>
    `;
  }

  function updateStats(count) {
    setText("job-count", `${count} of ${allJobs.length}`);
  }

  function flyToJob(id, targetMap) {
    const job = allJobs.find((j) => j.id === id);
    const m = targetMap || map;
    if (!job || !m) return;
    m.flyTo([job.lat, job.lng], 14, { duration: 0.6 });
    const marker = markerById.get(id);
    if (marker) marker.openPopup();
  }

  function setActiveCard(id) {
    document.querySelectorAll(".job-card").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === id);
      el.classList.toggle("expanded", el.dataset.id === id);
    });
    activeId = id;
    if (map) flyToJob(id, map);
    if (mapMobile) flyToJob(id, mapMobile);
  }

  function buildMarkers(layer, jobs) {
    if (!layer) return;
    layer.clearLayers();
    markerById.clear();
    jobs.forEach((job) => {
      let pinClass = "pin-default";
      if (job.match_tier === "high") pinClass = "pin-high";
      else if (job.match_tier === "medium") pinClass = "pin-medium";
      else if (job.match_tier === "stretch") pinClass = "pin-stretch";
      const icon = L.divIcon({
        className: "custom-pin",
        html: `<div class="${pinClass}"></div>`,
        iconSize: [14, 14],
      });
      const marker = L.marker([job.lat, job.lng], { icon }).addTo(layer);
      const state = currentUserId ? GAJTracker.getJobState(currentUserId, job.id) : {};
      const status = state.applied ? " ✓" : "";
      marker.bindPopup(
        `<strong>${escapeHtml(job.title)}${status}</strong>${escapeHtml(job.employer)}<br>${escapeHtml(job.pay_display)}<br>Match: ${job.match_score || "—"}/100<br><a href="${escapeHtml(job.apply_url || "#")}" target="_blank">Apply</a>`
      );
      marker.on("click", () => {
        setActiveCard(job.id);
        switchView("jobs");
        const card = document.querySelector(`.job-card[data-id="${job.id}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      markerById.set(job.id, marker);
    });
  }

  function isMapVisible(mapInstance) {
    if (!mapInstance) return false;
    const el = mapInstance.getContainer();
    if (!el || el.offsetWidth < 50 || el.offsetHeight < 50) return false;
    return el.offsetParent !== null;
  }

  function resetMapToSalem(mapInstance) {
    if (!mapInstance) return;
    mapInstance.setView(SALEM_VIEW.center, SALEM_VIEW.zoom, { animate: false });
    if (mapInstance.setZoom) {
      const z = mapInstance.getZoom();
      if (z < 9 || z > 14) mapInstance.setZoom(SALEM_VIEW.zoom);
    }
  }

  function refreshMarkers(jobs) {
    if (markersLayer) buildMarkers(markersLayer, jobs);
    if (markersLayerMobile) buildMarkers(markersLayerMobile, jobs);
  }

  function refreshDesktopMapWhenVisible() {
    if (!map || !isMapVisible(map)) return;
    map.invalidateSize();
    resetMapToSalem(map);
    buildMarkers(markersLayer, sortJobs(allJobs.filter(matchesFilters)));
  }

  function refreshMobileMapWhenVisible() {
    if (!mapMobile || !isMapVisible(mapMobile)) return;
    syncMobileHeaderHeight();
    syncNavHeight();
    mapMobile.invalidateSize();
    resetMapToSalem(mapMobile);
    buildMarkers(markersLayerMobile, sortJobs(allJobs.filter(matchesFilters)));
  }

  function bindCardInteractions(listEl) {
    listEl.querySelectorAll(".job-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("input, textarea, a, button, label")) return;
        const id = card.dataset.id;
        const wasActive = card.classList.contains("active");
        document.querySelectorAll(".job-card").forEach((c) => c.classList.remove("active", "expanded"));
        if (!wasActive) setActiveCard(id);
      });
    });

    listEl.querySelectorAll(".status-check input").forEach((input) => {
      input.addEventListener("change", (e) => {
        e.stopPropagation();
        GAJTracker.setJobField(currentUserId, input.dataset.job, input.dataset.field, input.checked);
        updateProgressStats();
        renderTrackerView();
        renderTodayView();
        const card = listEl.querySelector(`.job-card[data-id="${input.dataset.job}"]`);
        if (card) {
          const s = GAJTracker.getJobState(currentUserId, input.dataset.job);
          card.classList.toggle("job-applied", s.applied);
          card.classList.toggle("job-needs-call", GAJTracker.needsFollowUp(currentUserId, input.dataset.job));
        }
      });
    });

    listEl.querySelectorAll("textarea[data-notes]").forEach((ta) => {
      ta.addEventListener("click", (e) => e.stopPropagation());
      ta.addEventListener("change", () => {
        GAJTracker.setJobField(currentUserId, ta.dataset.job, "notes", ta.value);
      });
    });

    listEl.querySelectorAll(".btn-copy").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const job = allJobs.find((j) => j.id === btn.dataset.copy);
        if (!job) return;
        navigator.clipboard.writeText(copyFollowUpText(job)).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = "Copy follow-up"), 1500);
        });
      });
    });

    listEl.querySelectorAll(".btn-map-jump").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setActiveCard(btn.dataset.map);
        switchView("map");
        setTimeout(() => {
          if (mapMobile) {
            mapMobile.invalidateSize();
            flyToJob(btn.dataset.map, mapMobile);
          } else {
            flyToJob(btn.dataset.map, map);
          }
        }, 200);
      });
    });

    listEl.querySelectorAll(".btn-share").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const url = `${location.origin}${location.pathname}?job=${encodeURIComponent(btn.dataset.share)}`;
        const shareTxt = url;
        if (navigator.share) {
          navigator.share({ title: "Job link", url }).catch(() => {});
        } else {
          navigator.clipboard.writeText(shareTxt).then(() => {
            btn.textContent = "Link copied!";
            setTimeout(() => (btn.textContent = "Share"), 1500);
          });
        }
      });
    });

    listEl.querySelectorAll(".btn-hide").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.hide;
        const s = GAJTracker.getJobState(currentUserId, id);
        GAJTracker.setJobField(currentUserId, id, "hidden", !s.hidden);
        renderList();
      });
    });

    listEl.querySelectorAll(".bookmark-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.bookmark;
        const s = GAJTracker.getJobState(currentUserId, id);
        GAJTracker.setJobField(currentUserId, id, "bookmarked", !s.bookmarked);
        btn.classList.toggle("on", !s.bookmarked);
        updateProgressStats();
      });
    });
  }

  function renderList() {
    const filtered = sortJobs(allJobs.filter(matchesFilters));
    const listEl = document.getElementById("job-list");
    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty-state">No jobs match. Try clearing filters.</div>';
      updateStats(0);
      refreshMarkers([]);
      return;
    }
    listEl.innerHTML = filtered.map((j, i) => renderCard(j, i + 1)).join("");
    updateStats(filtered.length);
    refreshMarkers(filtered);
    bindCardInteractions(listEl);
    updateProgressStats();
    if (document.getElementById("view-jobs")?.classList.contains("view-active")) {
      ensureDesktopMap();
      runWhenMapReady(map, refreshDesktopMapWhenVisible);
    }
  }

  // ---------- today view (auto picks 5) ----------

  function pickTodayJobs() {
    if (!currentUserId) return [];
    const followups = allJobs.filter((j) => GAJTracker.needsFollowUp(currentUserId, j.id));
    const highMatch = sortJobs(
      allJobs.filter((j) => {
        if (!j.priority_call && j.match_tier !== "high") return false;
        const s = GAJTracker.getJobState(currentUserId, j.id);
        if (s.applied || s.hidden) return false;
        return true;
      })
    );
    const mix = [...followups.slice(0, 3), ...highMatch.slice(0, 5 - Math.min(3, followups.length))];
    const seen = new Set();
    return mix
      .filter((j) => {
        if (seen.has(j.id)) return false;
        seen.add(j.id);
        return true;
      })
      .slice(0, 5);
  }

  function renderTodayView() {
    const el = document.getElementById("today-list");
    if (!el) return;
    const jobs = pickTodayJobs();
    if (!jobs.length) {
      el.innerHTML = '<div class="empty-state">Mark some as Applied to see your daily follow-up list.</div>';
      return;
    }
    el.innerHTML = jobs
      .map((j) => {
        const s = GAJTracker.getJobState(currentUserId, j.id);
        const reason = s.applied && !s.called ? "Follow-up call needed" : "High match — apply or call";
        const phone = (j.contacts || []).find((c) => c.type === "phone");
        return `
          <div class="today-card" data-goto="${escapeHtml(j.id)}">
            <div class="today-head">
              <strong>${escapeHtml(j.title)}</strong>
              <span class="match-num small">${j.match_score || "—"}</span>
            </div>
            <div class="today-sub">${escapeHtml(j.employer)} · ${escapeHtml(j.pay_display)}</div>
            <div class="today-reason">${reason}</div>
            <div class="today-actions">
              ${j.apply_url ? `<a class="btn btn-primary" href="${escapeHtml(j.apply_url)}" target="_blank" rel="noopener">Apply</a>` : ""}
              ${phone ? `<a class="btn btn-call" href="tel:${phone.value.replace(/\D/g, "")}">Call</a>` : ""}
              <button class="btn btn-secondary" type="button">View</button>
            </div>
          </div>
        `;
      })
      .join("");
    el.querySelectorAll(".today-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        switchView("jobs");
        setTimeout(() => setActiveCard(card.dataset.goto), 100);
      });
    });
  }

  // ---------- tracker dashboard ----------

  function renderTrackerView() {
    if (!currentUserId) return;
    const summary = document.getElementById("tracker-summary");
    const follow = document.getElementById("tracker-followup");
    const applied = document.getElementById("tracker-applied");
    const bookmarks = document.getElementById("tracker-bookmarks");
    const ids = allJobs.map((j) => j.id);
    const stats = GAJTracker.getStats(currentUserId, ids);
    const w = GAJTracker.getActivityLast7Days(currentUserId);

    if (summary) {
      summary.innerHTML = `
        <div class="tracker-stat"><span>${stats.applied}</span>Applied</div>
        <div class="tracker-stat"><span>${stats.called}</span>Called</div>
        <div class="tracker-stat"><span>${stats.interview}</span>Interviews</div>
        <div class="tracker-stat"><span>${stats.bookmarked}</span>Bookmarked</div>
        <div class="tracker-stat"><span>${w.applied}</span>Applied (7d)</div>
        <div class="tracker-stat"><span>${allJobs.length - stats.applied}</span>Not yet</div>
      `;
    }

    const followJobs = allJobs.filter((j) => GAJTracker.needsFollowUp(currentUserId, j.id));
    const appliedJobs = allJobs.filter((j) => GAJTracker.getJobState(currentUserId, j.id).applied);
    const bookmarkedJobs = allJobs.filter((j) => GAJTracker.getJobState(currentUserId, j.id).bookmarked);

    function listJobs(jobs, emptyMsg) {
      if (!jobs.length) return `<li class="muted">${emptyMsg}</li>`;
      return jobs
        .slice(0, 30)
        .map((j) => `<li><button type="button" data-goto="${escapeHtml(j.id)}">${escapeHtml(j.title)}</button> — ${escapeHtml(j.employer)}</li>`)
        .join("");
    }

    if (follow) follow.innerHTML = listJobs(followJobs, "None — nice work!");
    if (applied) applied.innerHTML = listJobs(appliedJobs, "Nothing applied yet.");
    if (bookmarks) bookmarks.innerHTML = listJobs(bookmarkedJobs, "No bookmarks yet — tap ★ on a job to save it.");

    document.querySelectorAll(".tracker-list [data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchView("jobs");
        setTimeout(() => setActiveCard(btn.dataset.goto), 100);
      });
    });
  }

  // ---------- maps ----------

  function setupMapScrollBehavior(m, containerEl) {
    m.scrollWheelZoom.disable();
    containerEl.classList.add("map-zoom-off");
    containerEl.addEventListener("click", () => {
      m.scrollWheelZoom.enable();
      containerEl.classList.add("map-zoom-on");
      containerEl.classList.remove("map-zoom-off");
    });
    containerEl.addEventListener("mouseleave", () => {
      m.scrollWheelZoom.disable();
      containerEl.classList.remove("map-zoom-on");
      containerEl.classList.add("map-zoom-off");
    });
    L.DomEvent.disableScrollPropagation(m.getContainer());
  }

  function initMap(elId) {
    const el = document.getElementById(elId);
    if (!el) return null;
    const m = L.map(el, {
      scrollWheelZoom: false,
      minZoom: 9,
      maxZoom: 18,
      maxBounds: SALEM_BOUNDS,
      maxBoundsViscosity: 0.85,
    }).setView(SALEM_VIEW.center, SALEM_VIEW.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 18,
    }).addTo(m);
    setupMapScrollBehavior(m, el);
    const layer = L.layerGroup().addTo(m);
    if (elId === "map") {
      map = m;
      markersLayer = layer;
      mapInitialized = true;
    } else {
      mapMobile = m;
      markersLayerMobile = layer;
      mapMobileInitialized = true;
    }
    return m;
  }

  function syncMobileHeaderHeight() {
    const header = document.querySelector(".app-header");
    if (!header) return;
    const h = Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--mobile-header-h", `${h}px`);
  }

  function syncNavHeight() {
    const nav = document.querySelector(".bottom-nav");
    if (!nav) return;
    const h = Math.ceil(nav.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--nav-total", `${h}px`);
  }

  function ensureDesktopMap() {
    if (!mapInitialized) initMap("map");
  }

  function ensureMobileMap() {
    if (!mapMobileInitialized) initMap("map-mobile");
  }

  function runWhenMapReady(mapInstance, fn, attempts = 12) {
    if (isMapVisible(mapInstance)) {
      fn();
      return;
    }
    if (attempts <= 0) return;
    setTimeout(() => runWhenMapReady(mapInstance, fn, attempts - 1), 50);
  }

  // ---------- resources ----------

  function renderResources() {
    const el = document.getElementById("resources");
    if (!el || !resources.length) return;
    el.innerHTML = resources
      .map(
        (r) => `
      <div class="resource-card">
        <strong>${escapeHtml(r.name)}</strong>
        <p>${escapeHtml(r.address || "")}</p>
        <p>${r.phone ? `<a class="btn btn-call inline" href="tel:${r.phone.replace(/\D/g, "")}">${escapeHtml(r.phone)}</a>` : ""}</p>
        <p>${r.email ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>` : ""}</p>
        ${r.url ? `<p><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Website</a></p>` : ""}
        <p class="muted">${escapeHtml(r.note || "")}</p>
      </div>
    `
      )
      .join("");
  }

  // ---------- view switching ----------

  function switchView(name) {
    document.querySelectorAll(".view").forEach((v) => {
      v.classList.toggle("view-active", v.dataset.view === name);
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("nav-active", btn.dataset.nav === name);
    });
    document.getElementById("app-shell")?.classList.toggle("map-tab-active", name === "map");
    document.body.classList.toggle("map-tab-active", name === "map");

    if (name === "map") {
      syncMobileHeaderHeight();
      syncNavHeight();
      ensureMobileMap();
      runWhenMapReady(mapMobile, refreshMobileMapWhenVisible);
      setTimeout(() => {
        syncMobileHeaderHeight();
        syncNavHeight();
        refreshMobileMapWhenVisible();
      }, 250);
    }
    if (name === "jobs") {
      ensureDesktopMap();
      runWhenMapReady(map, refreshDesktopMapWhenVisible);
      setTimeout(refreshDesktopMapWhenVisible, 300);
    }
    if (name === "tracker") renderTrackerView();
    if (name === "today") renderTodayView();
    if (window.GAJCommsUI && window.GAJCommsUI.onViewShown) {
      window.GAJCommsUI.onViewShown(name);
    }
  }

  // ---------- UI bindings ----------

  function bindUI() {
    document.getElementById("search")?.addEventListener("input", (e) => {
      filters.search = e.target.value.trim();
      renderList();
    });
    document.getElementById("category-filter")?.addEventListener("change", (e) => {
      filters.category = e.target.value;
      renderList();
    });
    document.getElementById("tier-filter")?.addEventListener("change", (e) => {
      filters.tier = e.target.value;
      renderList();
    });
    document.getElementById("status-filter")?.addEventListener("change", (e) => {
      filters.status = e.target.value;
      renderList();
    });
    document.getElementById("sort-mode")?.addEventListener("change", (e) => {
      sortMode = e.target.value;
      renderList();
    });
    document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const key = chip.dataset.filter;
        filters[key] = !filters[key];
        chip.classList.toggle("active", filters[key]);
        renderList();
      });
    });
    document.getElementById("toggle-filters")?.addEventListener("click", () => {
      const panel = document.getElementById("toolbar-filters");
      const btn = document.getElementById("toggle-filters");
      const open = panel.classList.toggle("filters-open");
      btn.setAttribute("aria-expanded", String(open));
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.nav));
    });
    document.getElementById("print-btn")?.addEventListener("click", () => window.print());
    document.getElementById("clear-filters-btn")?.addEventListener("click", () => {
      Object.keys(filters).forEach((k) => {
        if (typeof filters[k] === "boolean") filters[k] = false;
      });
      filters.hideHidden = true;
      filters.search = "";
      filters.category = "all";
      filters.tier = "all";
      filters.status = "all";
      const ids = ["search", "category-filter", "tier-filter", "status-filter"];
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = id === "search" ? "" : "all";
      });
      document.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
      renderList();
    });
  }

  // ---------- share-a-job (?job=ID) ----------

  function handleShareUrl() {
    const params = new URLSearchParams(location.search);
    const jobId = params.get("job");
    if (!jobId) return;
    const job = allJobs.find((j) => j.id === jobId);
    if (!job) return;
    setTimeout(() => {
      switchView("jobs");
      setActiveCard(jobId);
      const card = document.querySelector(`.job-card[data-id="${jobId}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }

  // ---------- data ----------

  async function loadData() {
    const res = await fetch("data/jobs.json");
    if (!res.ok) throw new Error("Could not load jobs.json");
    const data = await res.json();
    allJobs = data.jobs || [];
    resources = data.resources || [];
    meta = data.meta || {};
    profile = data.profile || {};
    const verified = document.getElementById("verified-date");
    if (verified && meta.verified_on) verified.textContent = meta.verified_on;
    const totalEl = document.getElementById("total-jobs");
    if (totalEl) totalEl.textContent = allJobs.length;
  }

  function bindSyncStatus() {
    const el = document.getElementById("sync-status");
    if (!el) return;
    const labels = {
      local: "Saved on this device only",
      loading: "Syncing…",
      synced: "Synced across devices",
      error: "Sync error — saved locally",
      offline: "Offline — using local copy",
    };
    GAJTracker.onSyncStatus((status) => {
      el.textContent = labels[status] || status;
      el.className = "sync-status sync-" + status;
      el.title =
        status === "local"
          ? "Add config.js with Supabase credentials to sync phone + PC"
          : labels[status];
    });
  }

  async function startApp(userId) {
    currentUserId = userId;
    try {
      bindSyncStatus();
      await GAJTracker.initForUser(userId);
      await loadData();
      ensureMobileMap();
      renderResources();
      bindUI();
      if (window.GAJCommsUI) window.GAJCommsUI.init();
      renderList();
      syncMobileHeaderHeight();
      syncNavHeight();
      window.addEventListener("resize", () => {
        syncMobileHeaderHeight();
        syncNavHeight();
        if (document.getElementById("view-jobs")?.classList.contains("view-active")) {
          refreshDesktopMapWhenVisible();
        }
        if (document.getElementById("view-map")?.classList.contains("view-active")) {
          refreshMobileMapWhenVisible();
        }
      });
      renderTrackerView();
      renderTodayView();
      handleShareUrl();
    } catch (err) {
      document.getElementById("job-list").innerHTML = `<div class="empty-state">Failed to load jobs.<br>${escapeHtml(err.message)}</div>`;
    }
  }

  window.GAJ = {
    onLogout: () => {
      currentUserId = null;
      GAJTracker.clearActiveUser();
      if (map) {
        map.remove();
        map = null;
        mapInitialized = false;
      }
      if (mapMobile) {
        mapMobile.remove();
        mapMobile = null;
        mapMobileInitialized = false;
      }
      markerById.clear();
    },
  };

  GAJAuth.requireAuth(startApp);
})();
