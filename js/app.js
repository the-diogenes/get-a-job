(function () {
  "use strict";

  const PAY_MULTIPLIER = { hourly: 2080, monthly: 12, annual: 1 };

  let allJobs = [];
  let resources = [];
  let currentUserId = null;
  let map = null;
  let mapMobile = null;
  let markersLayer = null;
  let markersLayerMobile = null;
  let markerById = new Map();
  let activeId = null;
  let mapInitialized = false;
  let mapMobileInitialized = false;

  const filters = {
    search: "",
    category: "all",
    status: "all",
    southOnly: false,
    hasContact: false,
    securityOnly: false,
    priorityOnly: false,
    openOnly: false,
  };

  function annualizedPay(job) {
    const mult = PAY_MULTIPLIER[job.pay_type] || 1;
    return (job.pay_max || job.pay_min || 0) * mult;
  }

  function sortJobs(jobs) {
    return [...jobs].sort((a, b) => annualizedPay(b) - annualizedPay(a));
  }

  function jobMatchesStatusFilter(job) {
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
    if (!jobMatchesStatusFilter(job)) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const blob = [
        job.title,
        job.employer,
        job.address,
        ...(job.categories || []),
        job.experience_pitch,
      ]
        .join(" ")
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (filters.category !== "all") {
      if (!(job.categories || []).includes(filters.category)) return false;
    }
    if (filters.southOnly && !job.south_salem) return false;
    if (filters.hasContact && !(job.contacts || []).length) return false;
    if (filters.securityOnly) {
      const sec = [
        "security",
        "loss-prevention",
        "corrections",
        "law-enforcement",
        "supervisor",
      ];
      if (!(job.categories || []).some((c) => sec.includes(c))) return false;
    }
    if (filters.priorityOnly && !job.priority_call) return false;
    if (filters.openOnly && job.status !== "open") return false;
    return true;
  }

  function updateProgressStats() {
    if (!currentUserId) return;
    const ids = allJobs.map((j) => j.id);
    const stats = GAJTracker.getStats(currentUserId, ids);
    const a = document.getElementById("stat-applied");
    const c = document.getElementById("stat-called");
    const i = document.getElementById("stat-interview");
    if (a) a.textContent = stats.applied;
    if (c) c.textContent = stats.called;
    if (i) i.textContent = stats.interview;
  }

  function renderStatusRow(job) {
    const s = GAJTracker.getJobState(currentUserId, job.id);
    const mk = (field, label) =>
      `<label class="status-check">
        <input type="checkbox" data-job="${job.id}" data-field="${field}" ${s[field] ? "checked" : ""} />
        <span>${label}</span>
      </label>`;

    return `<div class="status-row" data-stop-propagation="true">
      ${mk("applied", "Applied")}
      ${mk("called", "Called")}
      ${mk("interview", "Interview")}
    </div>`;
  }

  function renderContacts(contacts) {
    if (!contacts || !contacts.length) {
      return '<p class="label">Contact</p><p>No direct contact — apply online, then call main line.</p>';
    }
    return (
      '<p class="label">Contacts</p><ul class="contact-list">' +
      contacts
        .map((c) => {
          let inner = "";
          if (c.type === "phone") {
            inner = `<a class="btn btn-call" href="tel:${c.value.replace(/\D/g, "")}">${c.value}</a> (${c.label})`;
          } else if (c.type === "email") {
            inner = `<a href="mailto:${c.value}">${c.value}</a> (${c.label})`;
          } else {
            inner = `<a href="${c.value}" target="_blank" rel="noopener">${c.label || "Link"}</a>`;
          }
          return `<li>${inner}</li>`;
        })
        .join("") +
      "</ul>"
    );
  }

  function renderLicenses(licenses) {
    if (!licenses || !licenses.length) return "<p><em>No special licenses listed.</em></p>";
    return "<ul>" + licenses.map((l) => `<li>${l}</li>`).join("") + "</ul>";
  }

  function copyFollowUpText(job) {
    const today = new Date().toLocaleDateString();
    return `Hi — I applied online for ${job.title} at ${job.employer} on ${today}. I have 16 years of security experience and an active Oregon DPSST license. Who should I speak with about next steps? Thank you.`;
  }

  function renderCard(job, rank) {
    const s = GAJTracker.getJobState(currentUserId, job.id);
    const statusClass = s.applied ? "job-applied" : "";
    const followClass = GAJTracker.needsFollowUp(currentUserId, job.id) ? "job-needs-call" : "";

    const badges = (job.categories || [])
      .slice(0, 3)
      .map((c) => `<span class="badge">${c}</span>`)
      .join("");
    const extra = [
      job.south_salem ? '<span class="badge south">South Salem</span>' : "",
      job.priority_call ? '<span class="badge priority">Call today</span>' : "",
      job.status === "verify" ? '<span class="badge verify">Verify</span>' : "",
      s.interview ? '<span class="badge interview">Interview</span>' : "",
    ].join("");

    const applyLinks = [
      job.apply_url
        ? `<a class="btn btn-primary" href="${job.apply_url}" target="_blank" rel="noopener">Apply</a>`
        : "",
      job.apply_url_alt
        ? `<a class="btn btn-secondary" href="${job.apply_url_alt}" target="_blank" rel="noopener">Alt</a>`
        : "",
    ].join("");

    const phoneBtn = (job.contacts || [])
      .filter((c) => c.type === "phone")
      .map(
        (c) =>
          `<a class="btn btn-call" href="tel:${c.value.replace(/\D/g, "")}">Call</a>`
      )
      .join("");

    const notes = s.notes || "";

    return `
      <article class="job-card ${statusClass} ${followClass}" data-id="${job.id}" tabindex="0">
        <div class="card-head">
          <div class="rank">#${rank}</div>
          <div class="card-head-text">
            <h3>${job.title}</h3>
            <div class="employer">${job.employer}</div>
          </div>
        </div>
        <div class="pay">${job.pay_display}</div>
        <div class="badges">${badges}${extra}</div>
        ${renderStatusRow(job)}
        <div class="job-detail">
          <p class="label">Address</p>
          <p>${job.address}</p>
          <p class="label">Why you fit</p>
          <p>${job.experience_pitch}</p>
          <p class="label">Licenses</p>
          ${renderLicenses(job.licenses_required)}
          ${renderContacts(job.contacts)}
          <label class="notes-label">
            <span class="label">Your notes</span>
            <textarea data-job="${job.id}" data-notes rows="2" placeholder="Called Mike, callback Thu…">${notes}</textarea>
          </label>
          <div class="actions">
            ${applyLinks}${phoneBtn}
            <button type="button" class="btn btn-secondary btn-copy" data-copy="${job.id}">Copy follow-up</button>
            <button type="button" class="btn btn-secondary btn-map-jump" data-map="${job.id}">Show on map</button>
          </div>
        </div>
      </article>
    `;
  }

  function updateStats(count) {
    const el = document.getElementById("job-count");
    if (el) el.textContent = `${count} of ${allJobs.length}`;
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
    flyToJob(id, map);
    if (mapMobile) flyToJob(id, mapMobile);
  }

  function buildMarkers(layer, jobs) {
    if (!layer) return;
    layer.clearLayers();
    jobs.forEach((job) => {
      const icon = job.priority_call
        ? L.divIcon({
            className: "custom-pin",
            html: '<div class="pin-priority"></div>',
            iconSize: [14, 14],
          })
        : undefined;

      const marker = L.marker([job.lat, job.lng], icon ? { icon } : {}).addTo(layer);
      const state = GAJTracker.getJobState(currentUserId, job.id);
      const status = state.applied ? " ✓ Applied" : "";
      marker.bindPopup(
        `<strong>${job.title}</strong><br>${job.employer}<br>${job.pay_display}${status}<br><a href="${job.apply_url || "#"}" target="_blank">Apply</a>`
      );
      marker.on("click", () => {
        setActiveCard(job.id);
        switchView("jobs");
        const card = document.querySelector(`.job-card[data-id="${job.id}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      markerById.set(job.id, marker);
    });

    if (jobs.length > 1 && layer === markersLayer && map) {
      const group = L.featureGroup([...markerById.values()]);
      map.fitBounds(group.getBounds().pad(0.12));
    }
  }

  function refreshMarkers(jobs) {
    buildMarkers(markersLayer, jobs);
    if (mapMobileInitialized) buildMarkers(markersLayerMobile, jobs);
  }

  function bindCardInteractions(listEl) {
    listEl.querySelectorAll(".job-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (
          e.target.closest(".status-row") ||
          e.target.closest("textarea") ||
          e.target.closest(".btn-copy") ||
          e.target.closest(".btn-map-jump") ||
          e.target.closest("a") ||
          e.target.closest("button")
        ) {
          return;
        }
        const id = card.dataset.id;
        const wasActive = card.classList.contains("active");
        document.querySelectorAll(".job-card").forEach((c) => {
          c.classList.remove("active", "expanded");
        });
        if (!wasActive) setActiveCard(id);
      });
    });

    listEl.querySelectorAll(".status-check input").forEach((input) => {
      input.addEventListener("change", (e) => {
        e.stopPropagation();
        const jobId = input.dataset.job;
        const field = input.dataset.field;
        GAJTracker.setJobField(currentUserId, jobId, field, input.checked);
        updateProgressStats();
        renderTrackerView();
        const job = allJobs.find((j) => j.id === jobId);
        const card = listEl.querySelector(`.job-card[data-id="${jobId}"]`);
        if (card && job) {
          card.classList.toggle("job-applied", GAJTracker.getJobState(currentUserId, jobId).applied);
          card.classList.toggle(
            "job-needs-call",
            GAJTracker.needsFollowUp(currentUserId, jobId)
          );
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
          if (mapMobile) mapMobile.invalidateSize();
          flyToJob(btn.dataset.map, mapMobile || map);
        }, 200);
      });
    });
  }

  function renderList() {
    const filtered = sortJobs(allJobs.filter(matchesFilters));
    const listEl = document.getElementById("job-list");

    if (!filtered.length) {
      listEl.innerHTML =
        '<div class="empty-state">No jobs match. Try clearing filters.</div>';
      updateStats(0);
      refreshMarkers([]);
      return;
    }

    listEl.innerHTML = filtered.map((j, i) => renderCard(j, i + 1)).join("");
    updateStats(filtered.length);
    refreshMarkers(filtered);
    bindCardInteractions(listEl);
    updateProgressStats();
  }

  function renderTrackerView() {
    if (!currentUserId) return;
    const summary = document.getElementById("tracker-summary");
    const follow = document.getElementById("tracker-followup");
    const applied = document.getElementById("tracker-applied");
    const stats = GAJTracker.getStats(
      currentUserId,
      allJobs.map((j) => j.id)
    );

    if (summary) {
      summary.innerHTML = `
        <div class="tracker-stat"><span>${stats.applied}</span>Applied</div>
        <div class="tracker-stat"><span>${stats.called}</span>Called</div>
        <div class="tracker-stat"><span>${stats.interview}</span>Interviews</div>
        <div class="tracker-stat"><span>${allJobs.length - stats.applied}</span>Not yet</div>
      `;
    }

    const followJobs = allJobs.filter((j) =>
      GAJTracker.needsFollowUp(currentUserId, j.id)
    );
    const appliedJobs = allJobs.filter((j) => {
      const s = GAJTracker.getJobState(currentUserId, j.id);
      return s.applied;
    });

    if (follow) {
      follow.innerHTML = followJobs.length
        ? followJobs
            .map(
              (j) =>
                `<li><button type="button" data-goto="${j.id}">${j.title}</button> — ${j.employer}</li>`
            )
            .join("")
        : "<li class='muted'>None — nice work!</li>";
      follow.querySelectorAll("[data-goto]").forEach((btn) => {
        btn.addEventListener("click", () => {
          switchView("jobs");
          setTimeout(() => setActiveCard(btn.dataset.goto), 100);
        });
      });
    }

    if (applied) {
      applied.innerHTML = appliedJobs.length
        ? appliedJobs
            .slice(0, 20)
            .map(
              (j) =>
                `<li><button type="button" data-goto="${j.id}">${j.title}</button> — ${j.employer}</li>`
            )
            .join("") +
          (appliedJobs.length > 20 ? `<li class="muted">+${appliedJobs.length - 20} more in Jobs tab</li>` : "")
        : "<li class='muted'>Nothing marked applied yet.</li>";
      applied.querySelectorAll("[data-goto]").forEach((btn) => {
        btn.addEventListener("click", () => {
          switchView("jobs");
          setTimeout(() => setActiveCard(btn.dataset.goto), 100);
        });
      });
    }
  }

  function initMap(elId, layerRef) {
    const el = document.getElementById(elId);
    if (!el) return null;
    const m = L.map(el, { scrollWheelZoom: true }).setView([44.92, -123.03], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 18,
    }).addTo(m);
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

  function ensureMaps() {
    if (!mapInitialized) initMap("map", "desktop");
    if (!mapMobileInitialized) initMap("map-mobile", "mobile");
    setTimeout(() => {
      map?.invalidateSize();
      mapMobile?.invalidateSize();
    }, 100);
  }

  function renderResources() {
    const el = document.getElementById("resources");
    if (!el || !resources.length) return;
    el.innerHTML = resources
      .map(
        (r) => `
      <div class="resource-card">
        <strong>${r.name}</strong>
        <p>${r.address || ""}</p>
        <p>${r.phone ? `<a href="tel:${r.phone.replace(/\D/g, "")}">${r.phone}</a>` : ""}</p>
        <p>${r.email ? `<a href="mailto:${r.email}">${r.email}</a>` : ""}</p>
        <p><a href="${r.url}" target="_blank" rel="noopener">Website</a></p>
        <p>${r.note || ""}</p>
      </div>
    `
      )
      .join("");
  }

  function switchView(name) {
    document.querySelectorAll(".view").forEach((v) => {
      v.classList.toggle("view-active", v.dataset.view === name);
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("nav-active", btn.dataset.nav === name);
    });
    if (name === "map") {
      ensureMaps();
      const filtered = sortJobs(allJobs.filter(matchesFilters));
      buildMarkers(markersLayerMobile, filtered);
      setTimeout(() => mapMobile?.invalidateSize(), 150);
    }
    if (name === "tracker") renderTrackerView();
  }

  function bindUI() {
    document.getElementById("search")?.addEventListener("input", (e) => {
      filters.search = e.target.value.trim();
      renderList();
    });

    document.getElementById("category-filter")?.addEventListener("change", (e) => {
      filters.category = e.target.value;
      renderList();
    });

    document.getElementById("status-filter")?.addEventListener("change", (e) => {
      filters.status = e.target.value;
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
      btn.setAttribute("aria-expanded", open);
    });

    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.nav));
    });
  }

  async function loadData() {
    const res = await fetch("data/jobs.json");
    if (!res.ok) throw new Error("Could not load jobs.json");
    const data = await res.json();
    allJobs = data.jobs || [];
    resources = data.resources || [];
    const verified = document.getElementById("verified-date");
    if (verified && data.meta?.verified_on) verified.textContent = data.meta.verified_on;
  }

  async function startApp(userId) {
    currentUserId = userId;
    try {
      await loadData();
      ensureMaps();
      renderResources();
      bindUI();
      renderList();
      renderTrackerView();
    } catch (err) {
      document.getElementById("job-list").innerHTML =
        `<div class="empty-state">Failed to load jobs.<br>${err.message}</div>`;
    }
  }

  window.GAJ = {
    onLogout: () => {
      currentUserId = null;
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
