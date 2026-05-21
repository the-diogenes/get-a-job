(function (global) {
  "use strict";

  const POLL_MS = 4000;
  let pollTimer = null;
  const listeners = new Set();

  function sb() {
    return global.GAJSupabase && global.GAJSupabase.getClient();
  }

  function configured() {
    return global.GAJSupabase && global.GAJSupabase.isConfigured();
  }

  function emit(event, detail) {
    listeners.forEach((fn) => {
      try {
        fn(event, detail);
      } catch (e) {
        console.warn("comms listener", e);
      }
    });
  }

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function startPolling() {
    if (pollTimer || !configured()) return;
    pollTimer = setInterval(() => emit("poll"), POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function subscribeRealtime() {
    const client = sb();
    if (!client || client._gajRealtime) return;
    client._gajRealtime = true;

    client
      .channel("gaj-comms")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        (payload) => emit("chat_message", payload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_posts" },
        (payload) => emit("board_post", payload)
      )
      .subscribe();
  }

  async function fetchBoardPosts() {
    const client = sb();
    if (!client) return [];
    const { data, error } = await client
      .from("board_posts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function postBoardMessage(author, body, parentId) {
    const client = sb();
    if (!client) throw new Error("Cloud not configured");
    const row = { author, body: body.trim(), parent_id: parentId || null };
    const { data, error } = await client
      .from("board_posts")
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    emit("board_post", { eventType: "INSERT", new: data });
    return data;
  }

  async function resolveBoardPost(id, resolved) {
    const client = sb();
    if (!client) throw new Error("Cloud not configured");
    const { error } = await client
      .from("board_posts")
      .update({ resolved: !!resolved })
      .eq("id", id);
    if (error) throw error;
    emit("board_post", { eventType: "UPDATE" });
  }

  async function fetchOpenSessions() {
    const client = sb();
    if (!client) return [];
    const { data, error } = await client
      .from("chat_sessions")
      .select("*")
      .eq("status", "open")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function getOrCreateSession(userId) {
    const client = sb();
    if (!client) throw new Error("Cloud not configured");
    const { data: existing } = await client
      .from("chat_sessions")
      .select("*")
      .eq("started_by", userId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1);
    if (existing && existing.length) return existing[0];

    const { data, error } = await client
      .from("chat_sessions")
      .insert({ started_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function fetchMessages(sessionId) {
    const client = sb();
    if (!client) return [];
    const { data, error } = await client
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function sendChatMessage(sessionId, author, body) {
    const client = sb();
    if (!client) throw new Error("Cloud not configured");
    const text = body.trim();
    if (!text) return null;

    const { data, error } = await client
      .from("chat_messages")
      .insert({ session_id: sessionId, author, body: text })
      .select()
      .single();
    if (error) throw error;

    await client
      .from("chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    emit("chat_message", { eventType: "INSERT", new: data });
    return data;
  }

  async function markSessionRead(userId, sessionId) {
    const client = sb();
    if (!client) return;
    const now = new Date().toISOString();
    const { error } = await client.from("chat_reads").upsert(
      {
        user_id: userId,
        session_id: sessionId,
        last_read_at: now,
      },
      { onConflict: "user_id,session_id" }
    );
    if (error) console.warn("mark read", error);
  }

  async function fetchReads(userId) {
    const client = sb();
    if (!client) return [];
    const { data, error } = await client
      .from("chat_reads")
      .select("*")
      .eq("user_id", userId);
    if (error) return [];
    return data || [];
  }

  async function countUnreadChats(userId) {
    if (!configured()) return 0;
    try {
      const [sessions, reads] = await Promise.all([
        fetchOpenSessions(),
        fetchReads(userId),
      ]);
      const readMap = new Map(reads.map((r) => [r.session_id, r.last_read_at]));
      let n = 0;
      for (const s of sessions) {
        const lastRead = readMap.get(s.id) || "1970-01-01";
        const { count, error } = await sb()
          .from("chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("session_id", s.id)
          .neq("author", userId)
          .gt("created_at", lastRead);
        if (!error && count > 0) n += 1;
      }
      return n;
    } catch {
      return 0;
    }
  }

  async function countUnreadBoard(userId) {
    if (!configured()) return 0;
    try {
      const posts = await fetchBoardPosts();
      const fromOther = posts.filter(
        (p) => p.author !== userId && !p.parent_id && !p.resolved
      );
      return fromOther.length;
    } catch {
      return 0;
    }
  }

  async function notifyEmailChatStarted(sessionId, preview) {
    const c = global.GAJ_CONFIG || {};
    if (!c.emailjsPublicKey || !c.emailjsServiceId || !c.emailjsTemplateId) {
      return false;
    }
    if (!global.emailjs) return false;
    try {
      global.emailjs.init({ publicKey: c.emailjsPublicKey });
      await global.emailjs.send(
        c.emailjsServiceId,
        c.emailjsTemplateId,
        {
          to_email: c.notifyEmail || "john.raymond.jr@gmail.com",
          from_name: "Jack — Talk to Jack",
          message: preview || "Jack opened live support on GET A JOB.",
          session_id: sessionId,
          reply_url:
            (global.location.origin || "") +
            (global.location.pathname || "").replace(/[^/]+$/, "") +
            "inbox.html",
        },
        c.emailjsPublicKey
      );
      return true;
    } catch (e) {
      console.warn("email notify", e);
      return false;
    }
  }

  function init() {
    if (!configured()) return;
    subscribeRealtime();
    startPolling();
  }

  global.GAJComms = {
    configured,
    on,
    init,
    startPolling,
    stopPolling,
    fetchBoardPosts,
    postBoardMessage,
    resolveBoardPost,
    fetchOpenSessions,
    getOrCreateSession,
    fetchMessages,
    sendChatMessage,
    markSessionRead,
    countUnreadChats,
    countUnreadBoard,
    notifyEmailChatStarted,
  };
})(window);
