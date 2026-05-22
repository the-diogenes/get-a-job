(function (global) {
  "use strict";

  const MASTER_ID = "master";
  const SUPPORT_LABEL = "Support";
  let activeChatSessionId = null;
  let emailSentForSession = new Set();
  let emailSentForPost = new Set();

  function displayName(authorId) {
    const u = user();
    if (!authorId) return "Unknown";
    if (u && authorId === u.id) return "You";
    if (authorId === MASTER_ID && (!u || u.id !== MASTER_ID)) {
      return SUPPORT_LABEL;
    }
    return authorId;
  }

  function user() {
    return global.GAJAuth && global.GAJAuth.currentUser();
  }

  function isMaster() {
    const u = user();
    return u && u.id === MASTER_ID;
  }

  function isJack() {
    const u = user();
    return u && u.id !== MASTER_ID;
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

  function cloudSetupHtml() {
    return `
      <div class="comms-setup" id="comms-setup-panel">
        <p class="comms-offline"><strong>Chat needs Supabase</strong> (free). One-time setup:</p>
        <ol class="comms-setup-steps">
          <li><a href="https://supabase.com/dashboard" target="_blank" rel="noopener">Create a project</a></li>
          <li>SQL Editor → paste <code>supabase/schema.sql</code> from the repo → Run</li>
          <li>Settings → API → copy URL + <strong>anon public</strong> key below</li>
        </ol>
        <form id="comms-setup-form" class="comms-setup-form">
          <label>Project URL <input type="url" name="supabaseUrl" placeholder="https://xxxxx.supabase.co" required /></label>
          <label>Anon key <input type="text" name="supabaseAnonKey" placeholder="eyJhbG..." required autocomplete="off" /></label>
          <button type="submit" class="btn btn-primary btn-sm">Connect & test</button>
        </form>
        <p class="comms-setup-hint">Saved in this browser only (or add <code>config.js</code> on the site for everyone).</p>
      </div>`;
  }

  function cloudBanner() {
    if (global.GAJComms && global.GAJComms.configured()) return "";
    return cloudSetupHtml();
  }

  async function testCloudConnection() {
    if (!global.GAJSupabase || !global.GAJSupabase.isConfigured()) {
      throw new Error("Enter Supabase URL and anon key first.");
    }
    const client = global.GAJSupabase.getClient();
    const { error } = await client.from("chat_sessions").select("id").limit(1);
    if (error) {
      if (
        error.message &&
        (error.message.includes("does not exist") ||
          error.code === "PGRST205" ||
          error.code === "42P01")
      ) {
        throw new Error(
          "Tables missing — run supabase/schema.sql in Supabase SQL Editor."
        );
      }
      throw error;
    }
    return true;
  }

  function wireCloudSetup() {
    document.addEventListener("submit", async (e) => {
      const form = e.target.closest && e.target.closest("#comms-setup-form");
      if (!form) return;
      e.preventDefault();
      e.stopPropagation();
      const url = form.supabaseUrl.value.trim();
      const key = form.supabaseAnonKey.value.trim();
      if (!url || !key) return;
      try {
        global.GAJCloudConfig.save({ supabaseUrl: url, supabaseAnonKey: key });
        global.GAJSupabase.resetClient();
        await testCloudConnection();
        if (global.GAJComms) global.GAJComms.init();
        showToast("Connected! Chat is live.");
        document.getElementById("comms-setup-panel")?.remove();
        await renderBoardView();
        await loadJackChat();
        await renderInboxBoard();
        await loadInboxChats();
        if (global.GAJTracker && global.GAJAuth.currentUser()) {
          await global.GAJTracker.initForUser(global.GAJAuth.currentUser().id);
        }
      } catch (err) {
        showToast(String(err.message || err));
      }
    });
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
              `<div class="board-reply"><strong>${esc(displayName(r.author))}</strong> <time>${fmtTime(r.created_at)}</time><p>${esc(r.body)}</p></div>`
          )
          .join("");
        const resolved = root.resolved
          ? '<span class="badge-resolved">Resolved</span>'
          : "";
        return `<article class="board-thread ${root.resolved ? "resolved" : ""}" data-id="${root.id}">
          <header><strong>${esc(displayName(root.author))}</strong> ${resolved} <time>${fmtTime(root.created_at)}</time></header>
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
      const open = posts.filter((p) => !p.parent_id && p.author !== MASTER_ID);
      if (!open.length) {
        el.innerHTML = '<p class="empty-hint">No open notes from users.</p>';
        return;
      }
      el.innerHTML = open
        .map((root) => {
          const replies = posts.filter((p) => p.parent_id === root.id);
          const replyHtml = replies
            .map(
              (r) =>
                `<div class="board-reply mine"><strong>${esc(displayName(r.author))}</strong> <time>${fmtTime(r.created_at)}</time><p>${esc(r.body)}</p></div>`
            )
            .join("");
          const status = root.resolved ? "resolved" : "open";
          return `<article class="inbox-card" data-board-id="${root.id}">
            <header>
              <strong>${esc(root.author)}</strong>
              <span class="badge-${status}">${status}</span>
              <time>${fmtTime(root.created_at)}</time>
            </header>
            <p>${esc(root.body)}</p>
            ${replyHtml}
            <form class="inbox-reply-form" data-board-id="${root.id}">
              <textarea rows="2" placeholder="Reply to ${esc(root.author)}…" required></textarea>
              <div class="inbox-actions">
                <button type="submit" class="btn btn-primary btn-sm">Reply</button>
                ${root.resolved ? "" : '<button type="button" class="btn btn-ghost btn-sm resolve-btn">Mark resolved</button>'}
                <button type="button" class="btn btn-danger btn-sm delete-board-btn">Delete</button>
              </div>
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
      .map((m) => {
        const isMine = user() && m.author === user().id;
        const cls = isMine ? "mine" : m.author === MASTER_ID ? "support" : "user";
        return `<div class="chat-bubble chat-bubble-${cls}" data-author="${esc(m.author)}">
            <span class="chat-meta">${esc(displayName(m.author))} · ${fmtTime(m.created_at)}</span>
            <p>${esc(m.body)}</p>
          </div>`;
      })
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
            `<div class="chat-session-row">
              <button type="button" class="chat-session-btn ${i === 0 ? "active" : ""}" data-session="${s.id}">
                <strong>${esc(s.started_by)}</strong>
                <small>${fmtTime(s.updated_at || s.created_at)}</small>
              </button>
              <button type="button" class="chat-session-del" data-session-del="${s.id}" title="Delete this chat">×</button>
            </div>`
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
    if (!u) return;
    if (!global.GAJComms.configured()) {
      showToast("Connect Supabase below first (one-time setup).");
      return;
    }
    if (!activeChatSessionId) {
      const session = await global.GAJComms.getOrCreateSession(u.id);
      activeChatSessionId = session.id;
    }

    const msgsBefore = await global.GAJComms.fetchMessages(activeChatSessionId);
    const isFirst = msgsBefore.length === 0;

    await global.GAJComms.sendChatMessage(activeChatSessionId, u.id, text);

    if (isFirst && !emailSentForSession.has(activeChatSessionId)) {
      emailSentForSession.add(activeChatSessionId);
      const ok = await global.GAJComms.notifyEmailChatStarted(
        activeChatSessionId,
        text.slice(0, 200),
        u.id
      );
      if (!ok) {
        showToast("Message sent. (Heads-up email failed; check FormSubmit setup.)");
      }
    }

    await loadJackChat();
  }

  const COMMS_FORM_IDS = new Set([
    "board-post-form",
    "chat-form-jack",
    "inbox-chat-form",
    "comms-setup-form",
  ]);

  function isCommsForm(form) {
    if (!form) return false;
    if (COMMS_FORM_IDS.has(form.id)) return true;
    if (form.classList && form.classList.contains("inbox-reply-form")) return true;
    return false;
  }

  async function handleBoardPost(form) {
    const u = user();
    const ta = form.querySelector("textarea");
    const body = ta && ta.value.trim();
    if (!u || !body) return;
    if (!global.GAJComms.configured()) {
      showToast("Cloud not connected — set up Supabase first.");
      return;
    }
    try {
      const post = await global.GAJComms.postBoardMessage(u.id, body);
      ta.value = "";
      await renderBoardView();
      showToast("Posted to the board.");

      if (u.id !== MASTER_ID && post && !emailSentForPost.has(post.id)) {
        emailSentForPost.add(post.id);
        await global.GAJComms.notifyEmailBoardPost(post.id, body, u.id);
      }
    } catch (err) {
      showToast(String(err.message || err));
    }
  }

  async function handleJackSend(form) {
    const ta = form.querySelector("textarea");
    const body = ta && ta.value.trim();
    if (!body) return;
    if (!global.GAJComms.configured()) {
      showToast("Cloud not connected — set up Supabase first.");
      return;
    }
    try {
      if (!activeChatSessionId) await loadJackChat();
      await onJackSendChat(body);
      ta.value = "";
    } catch (err) {
      showToast(String(err.message || err));
    }
  }

  async function handleInboxSend(form) {
    const u = user();
    const ta = form.querySelector("textarea");
    const body = ta && ta.value.trim();
    if (!u || !body) {
      return;
    }
    if (!activeChatSessionId) {
      showToast("Pick a chat session on the left first.");
      return;
    }
    try {
      await global.GAJComms.sendChatMessage(activeChatSessionId, u.id, body);
      ta.value = "";
      await selectInboxSession(activeChatSessionId);
    } catch (err) {
      showToast(String(err.message || err));
    }
  }

  async function handleInboxReply(form) {
    const id = form.dataset.boardId;
    const ta = form.querySelector("textarea");
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
  }

  function wireForms() {
    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target;
        if (!isCommsForm(form)) return;
        e.preventDefault();
        e.stopPropagation();

        if (form.id === "board-post-form") return handleBoardPost(form);
        if (form.id === "chat-form-jack") return handleJackSend(form);
        if (form.id === "inbox-chat-form") return handleInboxSend(form);
        if (form.id === "comms-setup-form") return; // handled in wireCloudSetup
        if (form.classList.contains("inbox-reply-form")) return handleInboxReply(form);
      },
      true
    );

    document.body.addEventListener("click", async (e) => {
      const sessionBtn = e.target.closest(".chat-session-btn");
      if (sessionBtn) {
        await selectInboxSession(sessionBtn.dataset.session);
        return;
      }

      const sessionDel = e.target.closest(".chat-session-del");
      if (sessionDel) {
        if (!confirm("Delete this chat session and all its messages?")) return;
        try {
          await global.GAJComms.deleteChatSession(sessionDel.dataset.sessionDel);
          if (activeChatSessionId === sessionDel.dataset.sessionDel) {
            activeChatSessionId = null;
            const log = document.getElementById("inbox-chat-log");
            if (log) log.innerHTML = '<p class="empty-hint">Pick a session.</p>';
          }
          await loadInboxChats();
          showToast("Chat deleted.");
        } catch (err) {
          showToast(String(err.message || err));
        }
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

      const deleteBoardBtn = e.target.closest(".delete-board-btn");
      if (deleteBoardBtn) {
        const card = deleteBoardBtn.closest(".inbox-card");
        const id = card && card.dataset.boardId;
        if (!id) return;
        if (!confirm("Delete this thread and all replies?")) return;
        try {
          await global.GAJComms.deleteBoardPost(id);
          await renderInboxBoard();
          showToast("Thread deleted.");
        } catch (err) {
          showToast(String(err.message || err));
        }
      }
    });
  }

  function onCommsEvent(event, payload) {
    const u = user();
    if (!u) return;

    if (event === "chat_message" && payload && payload.new) {
      const msg = payload.new;
      if (msg.author !== u.id) {
        showToast("New message from " + displayName(msg.author));
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
    wireCloudSetup();
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
