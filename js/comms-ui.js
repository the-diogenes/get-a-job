(function (global) {
  "use strict";

  const JACK_ID = "drJobless";
  const MASTER_ID = "master";
  let activeChatSessionId = null;
  let emailSentForSession = new Set();

  function user() {
    return global.GAJAuth && global.GAJAuth.currentUser();
  }

  function isMaster() {
    const u = user();
    return u && u.id === MASTER_ID;
  }

  function isJack() {
    const u = user();
    return u && u.id === JACK_ID;
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function showToast(msg) {
    let el = document.getElementById("comms-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "comms-toast";
      el.className = "comms-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("comms-toast-visible");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("comms-toast-visible"), 5000);
  }

  function cloudBanner() {
    if (global.GAJComms && global.GAJComms.configured()) return "";
    return `<p class="comms-offline">Cloud messaging is off — copy <code>config.example.js</code> to <code>config.js</code> and run <code>supabase/schema.sql</code>.</p>`;
  }

  function buildBoardThread(posts) {
    const roots = posts.filter((p) => !p.parent_id);
    const byParent = new Map();
    posts.forEach((p) => {
      if (!p.parent_id) return;
      const list = byParent.get(p.parent_id) || [];
      list.push(p);
      byParent.set(p.parent_id, list);
    });

    return roots
      .map((root) => {
        const replies = (byParent.get(root.id) || [])
          .map(
            (r) =>
              `<div class="board-reply"><strong>${esc(r.author)}</strong> <time>${fmtTime(r.created_at)}</time><p>${esc(r.body)}</p></div>`
          )
          .join("");
        const resolved = root.resolved
          ? '<span class="badge-resolved">Resolved</span>'
          : "";
        return `<article class="board-thread ${root.resolved ? "resolved" : ""}" data-id="${root.id}">
          <header><strong>${esc(root.author)}</strong> ${resolved} <time>${fmtTime(root.created_at)}</time></header>
          <p class="board-body">${esc(root.body)}</p>
          ${replies}
        </article>`;
      })
      .join("");
  }

  async function renderBoardView() {
    const list = document.getElementById("board-thread-list");
    const form = document.getElementById("board-post-form");
    if (!list) return;

    if (!global.GAJComms.configured()) {
      list.innerHTML = cloudBanner();
      if (form) form.hidden = true;
      return;
    }
    if (form) form.hidden = false;

    try {
      const posts = await global.GAJComms.fetchBoardPosts();
      list.innerHTML =
        buildBoardThread(posts) ||
        '<p class="empty-hint">No posts yet. Jack can leave the first note.</p>';
    } catch (e) {
      list.innerHTML = `<p class="error-hint">Could not load board: ${esc(String(e.message || e))}</p>`;
    }
  }

  async function renderInboxBoard() {
    const el = document.getElementById("inbox-board-list");
    if (!el) return;
    if (!global.GAJComms.configured()) {
      el.innerHTML = cloudBanner();
      return;
    }
    try {
      const posts = await global.GAJComms.fetchBoardPosts();
      const open = posts.filter((p) => !p.parent_id && p.author === JACK_ID);
      if (!open.length) {
        el.innerHTML = '<p class="empty-hint">No open notes from Jack.</p>';
        return;
      }
      el.innerHTML = open
        .map((root) => {
          const replies = posts.filter((p) => p.parent_id === root.id);
          const replyHtml = replies
            .map(
              (r) =>
                `<div class="board-reply mine"><strong>${esc(r.author)}</strong> <time>${fmtTime(r.created_at)}</time><p>${esc(r.body)}</p></div>`
            )
            .join("");
          const status = root.resolved ? "resolved" : "open";
          return `<article class="inbox-card" data-board-id="${root.id}">
            <header><span class="badge-${status}">${status}</span> <time>${fmtTime(root.created_at)}</time></header>
            <p>${esc(root.body)}</p>
            ${replyHtml}
            <form class="inbox-reply-form" data-board-id="${root.id}">
              <textarea rows="2" placeholder="Reply to Jack…" required></textarea>
              <button type="submit" class="btn btn-primary btn-sm">Reply</button>
              ${root.resolved ? "" : '<button type="button" class="btn btn-ghost btn-sm resolve-btn">Mark resolved</button>'}
            </form>
          </article>`;
        })
        .join("");
    } catch (e) {
      el.innerHTML = `<p class="error-hint">${esc(String(e.message || e))}</p>`;
    }
  }

  function renderChatMessages(messages, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = messages
      .map(
        (m) =>
          `<div class="chat-bubble chat-from-${esc(m.author)}" data-author="${esc(m.author)}">
            <span class="chat-meta">${esc(m.author)} · ${fmtTime(m.created_at)}</span>
            <p>${esc(m.body)}</p>
          </div>`
      )
      .join("");
    el.scrollTop = el.scrollHeight;
  }

  async function loadJackChat() {
    const log = document.getElementById("chat-log-jack");
    const hint = document.getElementById("chat-status-jack");
    if (!log) return;

    if (!global.GAJComms.configured()) {
      log.innerHTML = cloudBanner();
      return;
    }

    const u = user();
    if (!u) return;

    try {
      const session = await global.GAJComms.getOrCreateSession(u.id);
      activeChatSessionId = session.id;
      const msgs = await global.GAJComms.fetchMessages(session.id);
      renderChatMessages(msgs, "chat-log-jack");
      await global.GAJComms.markSessionRead(u.id, session.id);

      if (hint) {
        hint.textContent =
          msgs.length === 0
            ? "Live support — Jack is connected. John gets an email when you send your first message."
            : "Connected · messages sync live";
      }
    } catch (e) {
      log.innerHTML = `<p class="error-hint">${esc(String(e.message || e))}</p>`;
    }
  }

  async function loadInboxChats() {
    const list = document.getElementById("inbox-chat-sessions");
    const log = document.getElementById("inbox-chat-log");
    if (!list) return;

    if (!global.GAJComms.configured()) {
      list.innerHTML = cloudBanner();
      return;
    }

    try {
      const sessions = await global.GAJComms.fetchOpenSessions();
      if (!sessions.length) {
        list.innerHTML = '<p class="empty-hint">No open chat sessions.</p>';
        return;
      }

      list.innerHTML = sessions
        .map(
          (s, i) =>
            `<button type="button" class="chat-session-btn ${i === 0 ? "active" : ""}" data-session="${s.id}">
              ${esc(s.started_by)} · ${fmtTime(s.updated_at || s.created_at)}
            </button>`
        )
        .join("");

      const first = sessions[0];
      if (log && first) {
        await selectInboxSession(first.id);
      }
    } catch (e) {
      list.innerHTML = `<p class="error-hint">${esc(String(e.message || e))}</p>`;
    }
  }

  async function selectInboxSession(sessionId) {
    activeChatSessionId = sessionId;
    document.querySelectorAll(".chat-session-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.session === sessionId);
    });
    const msgs = await global.GAJComms.fetchMessages(sessionId);
    renderChatMessages(msgs, "inbox-chat-log");
    const u = user();
    if (u) await global.GAJComms.markSessionRead(u.id, sessionId);
  }

  async function refreshUnreadBadges() {
    const u = user();
    if (!u || !global.GAJComms.configured()) return;

    const chatN = await global.GAJComms.countUnreadChats(u.id);
    const boardN = isMaster()
      ? await global.GAJComms.countUnreadBoard(u.id)
      : 0;

    document.querySelectorAll("[data-badge]").forEach((el) => {
      const kind = el.dataset.badge;
      const n = kind === "chat" ? chatN : kind === "board" ? boardN : kind === "inbox" ? chatN + boardN : 0;
      el.textContent = n > 0 ? String(n) : "";
      el.hidden = n === 0;
    });
  }

  async function onJackSendChat(text) {
    const u = user();
    if (!u || !activeChatSessionId) return;

    const msgsBefore = await global.GAJComms.fetchMessages(activeChatSessionId);
    const isFirst = msgsBefore.length === 0;

    await global.GAJComms.sendChatMessage(activeChatSessionId, u.id, text);

    if (isFirst && !emailSentForSession.has(activeChatSessionId)) {
      emailSentForSession.add(activeChatSessionId);
      const ok = await global.GAJComms.notifyEmailChatStarted(
        activeChatSessionId,
        text.slice(0, 200)
      );
      if (!ok) {
        showToast("Message sent. (Email notify not set up — add EmailJS in config.js)");
      }
    }

    await loadJackChat();
  }

  function wireForms() {
    const boardForm = document.getElementById("board-post-form");
    if (boardForm) {
      boardForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const u = user();
        const ta = boardForm.querySelector("textarea");
        const body = ta && ta.value.trim();
        if (!u || !body) return;
        try {
          await global.GAJComms.postBoardMessage(u.id, body);
          ta.value = "";
          await renderBoardView();
          showToast("Posted to the board.");
        } catch (err) {
          showToast(String(err.message || err));
        }
      });
    }

    const jackChatForm = document.getElementById("chat-form-jack");
    if (jackChatForm) {
      jackChatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const ta = jackChatForm.querySelector("textarea");
        const body = ta && ta.value.trim();
        if (!body) return;
        try {
          await onJackSendChat(body);
          ta.value = "";
        } catch (err) {
          showToast(String(err.message || err));
        }
      });
    }

    const inboxChatForm = document.getElementById("inbox-chat-form");
    if (inboxChatForm) {
      inboxChatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const u = user();
        const ta = inboxChatForm.querySelector("textarea");
        const body = ta && ta.value.trim();
        if (!u || !body || !activeChatSessionId) return;
        try {
          await global.GAJComms.sendChatMessage(
            activeChatSessionId,
            u.id,
            body
          );
          ta.value = "";
          await selectInboxSession(activeChatSessionId);
        } catch (err) {
          showToast(String(err.message || err));
        }
      });
    }

    document.body.addEventListener("click", async (e) => {
      const sessionBtn = e.target.closest(".chat-session-btn");
      if (sessionBtn) {
        await selectInboxSession(sessionBtn.dataset.session);
        return;
      }

      const resolveBtn = e.target.closest(".resolve-btn");
      if (resolveBtn) {
        const card = resolveBtn.closest(".inbox-card");
        const id = card && card.dataset.boardId;
        if (id) {
          await global.GAJComms.resolveBoardPost(id, true);
          await renderInboxBoard();
        }
        return;
      }

    });

    document.body.addEventListener("submit", async (e) => {
      const replyForm = e.target.closest(".inbox-reply-form");
      if (!replyForm) return;
      e.preventDefault();
      const id = replyForm.dataset.boardId;
      const ta = replyForm.querySelector("textarea");
      const body = ta && ta.value.trim();
      const u = user();
      if (!id || !body || !u) return;
      try {
        await global.GAJComms.postBoardMessage(u.id, body, id);
        ta.value = "";
        await renderInboxBoard();
        showToast("Reply sent.");
      } catch (err) {
        showToast(String(err.message || err));
      }
    });
  }

  function onCommsEvent(event, payload) {
    const u = user();
    if (!u) return;

    if (event === "chat_message" && payload && payload.new) {
      const msg = payload.new;
      if (msg.author !== u.id) {
        showToast("New message from " + msg.author);
        if (document.getElementById("view-chat")?.classList.contains("view-active")) {
          loadJackChat();
        }
        if (document.getElementById("view-inbox")?.classList.contains("view-active")) {
          loadInboxChats();
        }
        const inboxPage = document.getElementById("inbox-chat-log");
        if (inboxPage && activeChatSessionId === msg.session_id) {
          selectInboxSession(msg.session_id);
        }
      }
    }

    if (event === "poll" || event === "board_post" || event === "chat_message") {
      refreshUnreadBadges();
      if (document.getElementById("view-board")?.classList.contains("view-active")) {
        renderBoardView();
      }
      if (document.getElementById("view-chat")?.classList.contains("view-active")) {
        loadJackChat();
      }
      if (document.getElementById("view-inbox")?.classList.contains("view-active")) {
        renderInboxBoard();
        if (activeChatSessionId) selectInboxSession(activeChatSessionId);
      }
      if (document.getElementById("inbox-app") && !document.getElementById("inbox-app").classList.contains("hidden")) {
        renderInboxBoard();
        if (activeChatSessionId) selectInboxSession(activeChatSessionId);
      }
    }
  }

  function applyRoleNav() {
    const jackOnly = document.querySelectorAll("[data-nav-jack]");
    const masterOnly = document.querySelectorAll("[data-nav-master]");
    jackOnly.forEach((el) => {
      el.hidden = !isJack();
    });
    masterOnly.forEach((el) => {
      el.hidden = !isMaster();
    });
  }

  async function onViewShown(viewName) {
    if (viewName === "board") await renderBoardView();
    if (viewName === "chat") await loadJackChat();
    if (viewName === "inbox") {
      await renderInboxBoard();
      await loadInboxChats();
    }
    refreshUnreadBadges();
  }

  function init() {
    if (!global.GAJComms) return;
    global.GAJComms.init();
    global.GAJComms.on(onCommsEvent);
    wireForms();
    applyRoleNav();
    refreshUnreadBadges();

    document.addEventListener("gaj-auth-ready", () => {
      applyRoleNav();
      refreshUnreadBadges();
    });
  }

  global.GAJCommsUI = {
    init,
    onViewShown,
    applyRoleNav,
    renderBoardView,
    renderInboxBoard,
    loadJackChat,
    loadInboxChats,
    refreshUnreadBadges,
    isMaster,
    isJack,
  };
})(window);
