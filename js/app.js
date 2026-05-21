(function () {
  "use strict";

  const PAY_MULTIPLIER = { hourly: 2080, monthly: 12, annual: 1 };

  let allJobs = [];
  let resources = [];
  let map = null;
  let markersLayer = null;
  let markerById = new Map();
  let activeId = null;

  const filters = {
    search: "",
    category: "all",
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

  function matchesFilters(job) {
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
      const sec = ["security", "loss-prevention", "corrections", "law-enforcement", "supervisor"];
      if (!(job.categories || []).some((c) => sec.includes(c))) return false;
    }
    if (filters.priorityOnly && !job.priority_call) return false;
    if (filters.openOnly && job.status !== "open") return false;
    return true;
  }

  function renderContacts(contacts) {
    if (!contacts || !contacts.length) {
      return '<p class="label">Contact</p><p>No direct contact listed — use Apply link, then call main line.</p>';
    }
    return (
      '<p class="label">Contacts</p><ul>' +
      contacts
        .map((c) => {
          let inner = "";
          if (c.type === "phone") {
            inner = `<a class="btn btn-call" href="tel:${c.value.replace(/\D/g, "")}">${c.value}</a> <span>(${c.label})</span>`;
          } else if (c.type === "email") {
            inner = `<a href="mailto:${c.value}">${c.value}</a> <span>(${c.label})</span>`;
          } else {
            inner = `<a href="${c.value}" target="_blank" rel="noopener">${c.label || c.value}</a>`;
          }
          const v = c.verified ? " ✓" : "";
          return `<li>${inner}${v}</li>`;
        })
        .join("") +
      "</ul>"
    );
  }

  function renderLicenses(licenses) {
    if (!licenses || !licenses.length) return "<p><em>No special licenses listed.</em></p>";
    return "<ul>" + licenses.map((l) => `<li>${l}</li>`).join("") + "</ul>";
  }

  function renderCard(job, rank) {
    const badges = (job.categories || [])
      .slice(0, 3)
      .map((c) => `<span class="badge">${c}</span>`)
      .join("");
    const extra = [
      job.south_salem ? '<span class="badge south">South Salem</span>' : "",
      job.priority_call ? '<span class="badge priority">Call today</span>' : "",
      job.status === "verify" ? '<span class="badge verify">Verify posting</span>' : "",
    ].join("");

    const applyLinks = [
      job.apply_url
        ? `<a class="btn btn-primary" href="${job.apply_url}" target="_blank" rel="noopener">Apply</a>`
        : "",
      job.apply_url_alt
        ? `<a class="btn btn-secondary" href="${job.apply_url_alt}" target="_blank" rel="noopener">Alt apply</a>`
        : "",
    ].join("");

    const phoneBtn = (job.contacts || [])
      .filter((c) => c.type === "phone")
      .map(
        (c) =>
          `<a class="btn btn-call" href="tel:${c.value.replace(/\D/g, "")}">Call ${c.label || "HR"}</a>`
      )
      .join("");

    return `
      <article class="job-card" data-id="${job.id}" tabindex="0">
        <div class="rank">#${rank} · ${job.status === "open" ? "Listed open" : "Check if still open"}</div>
        <h3>${job.title}</h3>
        <div class="employer">${job.employer}</div>
        <div class="pay">${job.pay_display}</div>
        <div class="badges">${badges}${extra}</div>
        <div class="job-detail">
          <p class="label">Address</p>
          <p>${job.address}</p>
          <p class="label">Why you fit</p>
          <p>${job.experience_pitch}</p>
          <p class="label">Licenses / requirements</p>
          ${renderLicenses(job.licenses_required)}
          ${renderContacts(job.contacts)}
          <p class="label">Verified</p>
          <p>${job.verified_on || "—"}</p>
          <div class="actions">${applyLinks}${phoneBtn}</div>
        </div>
      </article>
    `;
  }

  function updateStats(count) {
    const el = document.getElementById("job-count");
    if (el) el.textContent = `${count} of ${allJobs.length} jobs shown`;
  }

  function flyToJob(id) {
    const job = allJobs.find((j) => j.id === id);
    if (!job || !map) return;
    map.flyTo([job.lat, job.lng], 14, { duration: 0.6 });
    const m = markerById.get(id);
    if (m) m.openPopup();
  }

  function setActiveCard(id) {
    document.querySelectorAll(".job-card").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === id);
      el.classList.toggle("expanded", el.dataset.id === id);
    });
    activeId = id;
    flyToJob(id);
  }

  function refreshMarkers(jobs) {
    if (!markersLayer) return;
    markersLayer.clearLayers();
    markerById.clear();

    jobs.forEach((job) => {
      const icon = job.priority_call
        ? L.divIcon({
            className: "custom-pin",
            html: '<div style="background:#f59e0b;width:12px;height:12px;border-radius:50%;border:2px solid #fff;"></div>',
            iconSize: [12, 12],
          })
        : undefined;

      const marker = L.marker([job.lat, job.lng], icon ? { icon } : {}).addTo(markersLayer);
      marker.bindPopup(
        `<strong>${job.title}</strong>${job.employer}<br>${job.pay_display}<br><a href="${job.apply_url}" target="_blank">Apply</a>`
      );
      marker.on("click", () => {
        setActiveCard(job.id);
        const card = document.querySelector(`.job-card[data-id="${job.id}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      markerById.set(job.id, marker);
    });

    if (jobs.length > 1) {
      const group = L.featureGroup([...markerById.values()]);
      map.fitBounds(group.getBounds().pad(0.12));
    } else if (jobs.length === 1) {
      map.setView([jobs[0].lat, jobs[0].lng], 13);
    }
  }

  function renderList() {
    const filtered = sortJobs(allJobs.filter(matchesFilters));
    const listEl = document.getElementById("job-list");

    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty-state">No jobs match filters. Try clearing chips.</div>';
      updateStats(0);
      refreshMarkers([]);
      return;
    }

    listEl.innerHTML = filtered.map((j, i) => renderCard(j, i + 1)).join("");
    updateStats(filtered.length);
    refreshMarkers(filtered);

    listEl.querySelectorAll(".job-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        const id = card.dataset.id;
        const wasActive = card.classList.contains("active");
        document.querySelectorAll(".job-card").forEach((c) => {
          c.classList.remove("active", "expanded");
        });
        if (!wasActive) setActiveCard(id);
      });
    });
  }

  function initMap() {
    map = L.map("map", { scrollWheelZoom: true }).setView([44.92, -123.03], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
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

  function bindUI() {
    document.getElementById("search").addEventListener("input", (e) => {
      filters.search = e.target.value.trim();
      renderList();
    });

    document.getElementById("category-filter").addEventListener("change", (e) => {
      filters.category = e.target.value;
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
  }

  async function loadData() {
    const res = await fetch("data/jobs.json");
    if (!res.ok) throw new Error("Could not load jobs.json");
    const data = await res.json();
    allJobs = data.jobs || [];
    resources = data.resources || [];
    const meta = data.meta || {};
    const verified = document.getElementById("verified-date");
    if (verified && meta.verified_on) verified.textContent = meta.verified_on;
  }

  async function init() {
    try {
      await loadData();
      initMap();
      renderResources();
      bindUI();
      renderList();
    } catch (err) {
      document.getElementById("job-list").innerHTML =
        `<div class="empty-state">Failed to load jobs. Open via local server (see README).<br>${err.message}</div>`;
    }
  }

  init();
})();
