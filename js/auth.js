(function (global) {
  "use strict";

  const SESSION_KEY = "gaj_session";
  const USERS = {
    master: { password: "master", displayName: "Master" },
    drJobless: { password: "thanksJack", displayName: "Dr. Jobless" },
  };

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(username) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ user: username, at: Date.now() })
    );
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function login(username, password) {
    const key = (username || "").trim();
    const account = USERS[key];
    if (!account || account.password !== password) {
      return { ok: false, error: "Invalid username or password." };
    }
    setSession(key);
    return { ok: true, user: key, displayName: account.displayName };
  }

  function logout() {
    clearSession();
  }

  function currentUser() {
    const s = getSession();
    if (!s || !USERS[s.user]) return null;
    return {
      id: s.user,
      displayName: USERS[s.user].displayName,
    };
  }

  function isLoggedIn() {
    return !!currentUser();
  }

  function showLogin() {
    document.getElementById("login-screen")?.classList.remove("hidden");
    document.getElementById("app-shell")?.classList.add("hidden");
    document.body.classList.remove("logged-in");
  }

  function showApp(user) {
    document.getElementById("login-screen")?.classList.add("hidden");
    document.getElementById("app-shell")?.classList.remove("hidden");
    document.body.classList.add("logged-in");
    const label = document.getElementById("user-label");
    if (label) label.textContent = user.displayName;
  }

  function bindLoginForm(onSuccess) {
    const form = document.getElementById("login-form");
    const errEl = document.getElementById("login-error");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = form.username.value.trim();
      const password = form.password.value;
      const result = login(username, password);
      if (!result.ok) {
        if (errEl) {
          errEl.textContent = result.error;
          errEl.hidden = false;
        }
        return;
      }
      if (errEl) errEl.hidden = true;
      form.password.value = "";
      showApp({ id: result.user, displayName: result.displayName });
      if (onSuccess) onSuccess(result.user);
    });

    document.getElementById("logout-btn")?.addEventListener("click", () => {
      logout();
      showLogin();
      if (global.GAJ && global.GAJ.onLogout) global.GAJ.onLogout();
    });
  }

  function requireAuth(onReady) {
    bindLoginForm(onReady);
    const user = currentUser();
    if (user) {
      showApp(user);
      onReady(user.id);
    } else {
      showLogin();
    }
  }

  global.GAJAuth = {
    currentUser,
    isLoggedIn,
    requireAuth,
    logout,
    showLogin,
  };
})(window);
