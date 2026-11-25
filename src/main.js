import "./style.css";
import { supabase, supabaseConfigured } from "./lib/supabase.js";

const initialState = {
  demoBalance: 10000,
  liveBalance: 0,
  payout: 82,
  duration: 10,
  volatility: 0.62,
  drift: 0,
  chartSpeed: 1,
  mode: "demo",
  selectedBot: "Pulse",
  tradeType: "digits",
  stake: 25,
  activeView: "trade",
  history: [],
  trades: [],
};

const defaultStrategyBots = [
  { id: "pulse", name: "Pulse", strategyKey: "Pulse", type: "Momentum crossover", description: "Short momentum signals", tier: "Balanced", icon: "↗", color: "#9d8aff", price: 0, owned: true },
  { id: "sentry", name: "Sentry", strategyKey: "Sentry", type: "Trend confirmation", description: "Multiple indicators aligned", tier: "Conservative", icon: "◉", color: "#54d5b6", price: 0, owned: true },
  { id: "orbit", name: "Orbit", strategyKey: "Orbit", type: "Range movement", description: "Looks for price movement near recent range", tier: "Experimental", icon: "◎", color: "#f6b95d", price: 0, owned: true },
  { id: "lamia", name: "LAMIA", strategyKey: "LAMIA", type: "Quick Trade", description: "Three-tick momentum signal", tier: "Fast", icon: "↗", color: "#ff8c72", price: 0, owned: true },
  { id: "insta", name: "INSTA", strategyKey: "INSTA", type: "Instant Trade", description: "Last-tick direction signal", tier: "Instant", icon: "⚡", color: "#f5cf61", price: 0, owned: true },
  { id: "skpot", name: "SKPOT", strategyKey: "SKPOT", type: "Scalping", description: "Fast and slow average crossover", tier: "Short-term", icon: "⌁", color: "#61b8ed", price: 0, owned: true },
  { id: "vulja", name: "VULJA", strategyKey: "VULJA", type: "Strategy Trade", description: "Trend and momentum confirmation", tier: "Confirmed", icon: "✦", color: "#df87da", price: 0, owned: true },
];
let strategyBots = defaultStrategyBots;

const auth = {
  ready: false,
  user: null,
  profile: null,
  profileError: "",
  screen: "login",
  message: "",
  messageType: "info",
  busy: false,
};

const state = { ...initialState };
const app = document.querySelector("#app");

const formatMoney = (value) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatKes = (value, rate = 128) => `KSh ${(Number(value) * Number(rate)).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
let price = 3842.61;
let chartPoints = [];
let livePrice = 3842.61;
let liveChartPoints = [];
let chartTimeframe = "1m";
let chartPointer = null;
let chartTimer;
let toastTimer;
let botSignal = null;
let settingsSaveTimer;
let workspaceUserId = null;
let workspaceLoadPromise = null;
let chartPollVersion = 0;
let pendingLocalSettings = false;
let walletTransactions = [];
let walletTrades = [];
let walletScreen = "overview";
let currentDeposit = null;
let walletRate = 128;
let walletLastAttemptAt = 0;
let walletAdminData = null;
let walletAdminLoading = false;
let walletAdminLoaded = false;
let walletAdminLastAttemptAt = 0;
let walletAdminError = "";
let walletBusy = false;
let strategyCatalogError = "";
let adminOverviewData = null;
let adminTransactionRows = [];
let adminTransactionTotal = 0;
let adminTransactionStatus = "all";
let adminTransactionType = "all";
let adminTransactionOffset = 0;
let adminTransactionLoading = false;
let adminUserRows = [];
let adminUserTotal = 0;
let adminUserSearch = "";
let adminUserOffset = 0;
let adminUserLoading = false;
let notificationData = { unreadCount: 0, items: [] };
let notificationPanelOpen = false;
let notificationLastAttemptAt = 0;
let notificationLoading = false;
let notificationError = "";

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
}

function render() {
  if (!auth.ready || !auth.user || auth.screen === "admin-login" || auth.screen === "admin-denied" || auth.screen === "funds-terms") {
    renderAuth();
    return;
  }
  if (auth.screen === "admin-denied") {
    renderAuth();
    return;
  }
  const isAdmin = state.activeView === "admin";
  const isHistory = state.activeView === "history";
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <button class="brand" type="button" data-action="admin-gate" aria-label="PIPMASTER admin sign in">
          <span class="brand-mark"><span></span><span></span><span></span></span>
          <span>PIP<span>MASTER</span></span>
        </button>
        <div class="side-label">WORKSPACE</div>
        <nav class="side-nav" aria-label="Main navigation">
          ${navItem("trade", "⌁", "Trade")}
          ${navItem("bots", "◈", "Bot market", '<span class="nav-tag">NEW</span>')}
          ${navItem("history", "↗", "Activity")}
          ${navItem("wallet", "▣", "Wallet")}
        </nav>
        <div class="side-spacer"></div>
        <div class="market-status"><span class="status-dot"></span><span>PIPMASTER market</span><strong>ONLINE</strong></div>
        <div class="sidebar-foot"><span class="avatar">${avatarMarkup()}</span><div><strong>${escapeHtml(auth.profile?.full_name || auth.user.email || "Account")}</strong><small>Signed in</small></div><button class="more" data-view="profile" aria-label="Open profile">···</button></div>
      </aside>

      <main class="main">
        <header class="topbar">
          <button class="mobile-brand" type="button" data-action="admin-gate" aria-label="PIPMASTER admin sign in"><span class="brand-mark"><span></span><span></span><span></span></span> PIP<span>MASTER</span></button>
          <div class="breadcrumb"><span>Workspace</span><b>/</b><strong>${isAdmin ? "Admin controls" : isHistory ? "Activity" : "Trading terminal"}</strong></div>
          <div class="top-actions">
            <div class="account-chip"><span class="status-dot"></span> ${state.mode === "demo" ? "Demo account" : "Live wallet"}</div>
            <div class="notification-control">
              <button class="icon-button" type="button" title="Notifications" aria-label="Notifications" aria-expanded="${notificationPanelOpen}" data-action="notifications">♧<span class="notification-count ${notificationData.unreadCount ? "visible" : ""}">${notificationData.unreadCount > 99 ? "99+" : notificationData.unreadCount || ""}</span></button>
              ${notificationPanelOpen ? notificationPanel() : ""}
            </div>
            <button class="avatar small" data-view="profile" aria-label="Open profile">${avatarMarkup()}</button>
          </div>
        </header>

        <div class="content">
          ${state.activeView === "trade" ? tradingView() : isAdmin ? adminView() : isHistory ? historyView() : state.activeView === "profile" ? profileView() : simpleView(state.activeView)}
        </div>
        <nav class="mobile-nav" aria-label="Mobile navigation">
          ${navItem("trade", "⌁", "Trade")}
          ${navItem("bots", "◈", "Bots")}
          ${navItem("history", "↗", "Activity")}
          ${navItem("wallet", "▣", "Wallet")}
        </nav>
        <div class="toast" id="toast" role="status"></div>
      </main>
    </div>`;
  bindEvents();
  if (state.activeView === "admin" && auth.profile?.role === "admin" && !walletAdminLoading && !walletAdminLoaded) {
    loadWalletAdminData();
  }
  if (state.activeView === "trade") {
    const canvas = document.querySelector("#price-chart");
    drawChart(canvas);
    bindChartInteractions(canvas);
  }
  syncNotificationBadge();
}

function avatarMarkup() {
  if (auth.profile?.avatar_url) {
    return `<img class="avatar-image" src="${escapeHtml(auth.profile.avatar_url)}" alt="">`;
  }
  const initials = (auth.profile?.full_name || auth.user?.email || "PM")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
  return escapeHtml(initials || "PM");
}

function renderAuth() {
  if (auth.screen === "funds-terms") {
    app.innerHTML = `<main class="auth-screen"><section class="auth-card terms-auth-card">
      <button class="auth-brand" type="button" data-action="admin-gate" aria-label="PIPMASTER admin sign in"><span class="brand-mark"><span></span><span></span><span></span></span><span>PIP<span>MASTER</span></span></button>
      ${fundsTermsContent()}
      <button class="auth-link centered" data-action="close-funds-terms">${auth.user ? "Return to wallet" : "Back to sign in"}</button>
    </section></main>`;
    app.querySelector('[data-action="close-funds-terms"]')?.addEventListener("click", () => {
      auth.screen = auth.user ? "workspace" : "login";
      if (auth.user) {
        state.activeView = "wallet";
        walletScreen = "overview";
      }
      render();
    });
    return;
  }
  const loading = !auth.ready;
  const adminLogin = auth.screen === "admin-login";
  const denied = auth.screen === "admin-denied";
  const recovery = auth.screen === "forgot-password";
  const reset = auth.screen === "reset-password";
  const signup = auth.screen === "signup";
  const login = auth.screen === "login" || adminLogin;
  const configMissing = !supabaseConfigured;
  const title = loading ? "Checking your session" : denied ? "Admin access required" : reset ? "Choose a new password" : recovery ? "Reset your password" : signup ? "Create your account" : adminLogin ? "Admin sign in" : "Welcome back";
  const subtitle = loading ? "Please wait a moment." : denied
    ? "This account does not have administrator access."
    : reset ? "Use a strong password you have not used elsewhere."
      : recovery ? "We’ll email you a secure password-reset link."
        : signup ? "Create your PIPMASTER account to continue."
          : adminLogin ? "Sign in with the pre-provisioned administrator account."
            : "Sign in to your account to continue.";

  let form = "";
  if (configMissing) {
    form = `<div class="auth-alert error"><strong>Supabase setup is required</strong><p>Authentication and remote app data are intentionally fail-closed. Configure the GitHub Actions variables <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then apply all Supabase migrations before sign-up can work.</p></div>`;
  } else if (denied) {
    form = `<div class="auth-alert error"><strong>This account is not an administrator.</strong><p>Admin access is granted from the protected database, not by choosing an email address on this screen.</p></div><div class="auth-actions"><button class="auth-primary" data-action="admin-retry">Try admin sign in</button><button class="auth-link" data-action="leave-admin">Return to trading</button></div>`;
  } else if (login) {
    form = `    <form class="auth-form" data-form="login">
      <label>Email address<input name="email" type="email" autocomplete="${adminLogin ? "username" : "email"}" placeholder="you@example.com" required></label>
      <label>Password<span class="password-field"><input name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required><button type="button" class="password-toggle" data-action="toggle-password" aria-label="Show password">Show</button></span></label>
      <div class="auth-options"><span class="remember-option">Session is not saved on this device</span>${!adminLogin ? `<button type="button" class="auth-link" data-screen="forgot-password">Forgot password?</button>` : ""}</div>
      <button class="auth-primary" type="submit" ${auth.busy ? "disabled" : ""}>${auth.busy ? "Please wait…" : adminLogin ? "Sign in to admin" : "Sign in"}</button>
    </form>`;
  } else if (signup) {
    form = `<form class="auth-form" data-form="signup">
      <label>Full name<input name="full_name" autocomplete="name" placeholder="Your name" required maxlength="80"></label>
      <label>Username<input name="username" autocomplete="username" placeholder="Choose a username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" title="Use 3–24 letters, numbers, or underscores"></label>
      <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
      <label>Password<input name="password" type="password" autocomplete="new-password" placeholder="At least 10 characters" required minlength="10"></label>
      <label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" placeholder="Enter the password again" required minlength="10"></label>
      <button class="auth-primary" type="submit" ${auth.busy ? "disabled" : ""}>${auth.busy ? "Creating account…" : "Create account"}</button>
    </form>`;
  } else if (recovery) {
    form = `<form class="auth-form" data-form="forgot-password">
      <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
      <button class="auth-primary" type="submit" ${auth.busy ? "disabled" : ""}>${auth.busy ? "Sending…" : "Send reset link"}</button>
      <button class="auth-link centered" type="button" data-screen="login">Back to sign in</button>
    </form>`;
  } else if (reset) {
    form = `<form class="auth-form" data-form="reset-password">
      <label>New password<input name="password" type="password" autocomplete="new-password" placeholder="At least 10 characters" required minlength="10"></label>
      <label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" placeholder="Enter the password again" required minlength="10"></label>
      <button class="auth-primary" type="submit" ${auth.busy ? "disabled" : ""}>${auth.busy ? "Updating…" : "Update password"}</button>
    </form>`;
  }

  app.innerHTML = `<main class="auth-screen"><section class="auth-card">
    <button class="auth-brand" type="button" data-action="admin-gate" aria-label="PIPMASTER admin sign in"><span class="brand-mark"><span></span><span></span><span></span></span><span>PIP<span>MASTER</span></span></button>
    <div class="auth-heading"><div class="eyebrow">${adminLogin ? "RESTRICTED AREA" : "SECURE ACCOUNT"}</div><h1>${title}</h1><p>${subtitle}</p></div>
    ${auth.message ? `<div class="auth-alert ${auth.messageType}">${escapeHtml(auth.message)}</div>` : ""}
    ${auth.profileError ? `<div class="auth-alert error">${escapeHtml(auth.profileError)}</div>` : ""}
    ${form}
    ${!configMissing && !denied ? `<div class="auth-switch">${signup ? `Already have an account? <button class="auth-link" data-screen="login">Sign in</button>` : login && !adminLogin ? `New to PIPMASTER? <button class="auth-link" data-screen="signup">Create account</button>` : adminLogin ? `Administrator access only · <button class="auth-link" data-action="leave-admin">Back</button>` : ""}</div>` : ""}
    <button class="auth-link centered funds-terms-link" data-action="show-funds-terms">Wallet funds terms</button>
    <div class="auth-security"><span>⌑</span> Passwords are handled by Supabase Auth and are never stored in this site’s source code.</div>
  </section></main>`;
  bindAuthEvents();
}

function profileView() {
  const profile = auth.profile || {};
  return `<section class="page-heading"><div><div class="eyebrow">YOUR ACCOUNT</div><h1>Profile & security</h1><p>Manage your personal information and account access.</p></div><button class="secondary-button" data-action="sign-out">Sign out</button></section>
    ${auth.profileError ? `<div class="notice notice-warn"><span>ⓘ</span><div><strong>Profile storage needs setup</strong><p>${escapeHtml(auth.profileError)}</p></div></div>` : ""}
    <section class="panel profile-panel">
      <div class="profile-cover"><div class="profile-avatar">${avatarMarkup()}</div><div><span class="eyebrow">PIPMASTER MEMBER</span><strong>${escapeHtml(profile.full_name || auth.user.email || "Your profile")}</strong><small>${escapeHtml(auth.user.email || "")}</small></div><label class="avatar-upload">Change photo<input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp" aria-label="Upload profile photo"></label></div>
      <form class="profile-form" data-form="profile">
        <div class="profile-form-heading"><h2>Personal information</h2><p>Your username is unique to your account.</p></div>
        <div class="profile-fields">
          <label>Full name<input name="full_name" autocomplete="name" maxlength="80" value="${escapeHtml(profile.full_name || "")}" required></label>
          <label>Username<input name="username" autocomplete="nickname" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" value="${escapeHtml(profile.username || "")}" required></label>
          <label>Email address<input value="${escapeHtml(auth.user.email || "")}" disabled><small>Email change requires a confirmation link.</small></label>
          <label>Phone number<input name="phone" type="tel" autocomplete="tel" maxlength="32" value="${escapeHtml(profile.phone || "")}" placeholder="+1 555 0100"></label>
          <label>Country<input name="country" autocomplete="country-name" maxlength="80" value="${escapeHtml(profile.country || "")}" placeholder="Country"></label>
          <label>Time zone<input name="timezone" list="timezones" maxlength="64" value="${escapeHtml(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}"><datalist id="timezones"><option value="UTC"><option value="Africa/Nairobi"><option value="Europe/London"><option value="America/New_York"><option value="Asia/Dubai"></datalist></label>
        </div>
        <div class="profile-form-footer"><span class="profile-message ${auth.messageType}" id="profile-message">${auth.message ? escapeHtml(auth.message) : ""}</span><button class="auth-primary compact" type="submit" ${auth.busy ? "disabled" : ""}>${auth.busy ? "Saving…" : "Save changes"}</button></div>
      </form>
      <form class="security-section email-change-form" data-form="profile-email"><div><h2>Change email address</h2><p>We’ll require confirmation before the new address takes effect.</p></div><label class="email-change-input"><span>New email</span><input name="email" type="email" autocomplete="email" required placeholder="new-address@example.com"></label><button class="subtle-button" type="submit" ${auth.busy ? "disabled" : ""}>${auth.busy ? "Sending…" : "Update email"}</button></form>
      <div class="security-section"><div><h2>Password & security</h2><p>Reset your password using a secure email link.</p></div><button class="subtle-button" data-action="profile-reset">Send password reset link</button></div>
      <div class="security-section danger-zone"><div><h2>Sign out</h2><p>End this session on this device.</p></div><button class="secondary-button" data-action="sign-out">Sign out</button></div>
    </section>`;
}

async function loadProfile(user) {
  auth.profileError = "";
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, role, full_name, username, phone, country, timezone, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    auth.profile = { role: "user", full_name: user.user_metadata?.full_name || "", username: user.user_metadata?.username || "" };
    auth.profileError = "Supabase profiles are not ready yet. Apply the migration in supabase/migrations before using saved profiles.";
    return;
  }
  auth.profile = data || { role: "user", full_name: user.user_metadata?.full_name || "", username: user.user_metadata?.username || "" };
}

async function refreshTerminalSnapshot(renderOnChange = false) {
  const { data, error } = await supabase.rpc("get_terminal_snapshot");
  if (error) throw error;

  const previousSettings = JSON.stringify([state.volatility, state.drift, state.chartSpeed, state.payout]);
  const previousTrades = JSON.stringify(state.trades);
  price = Number(data.price);
  state.demoBalance = Number(data.demoBalance);
  if (!pendingLocalSettings) {
    state.volatility = Number(data.settings.volatility);
    state.drift = Number(data.settings.drift);
    state.chartSpeed = Number(data.settings.chartSpeed);
    state.payout = Number(data.settings.payout);
  }
  state.trades = Array.isArray(data.trades) ? data.trades : [];
  chartPoints = (Array.isArray(data.ticks) ? data.ticks : [])
    .map((tick, index) => ({ x: index, y: Number(tick.price), time: tickTimestamp(tick) }))
    .filter((point) => Number.isFinite(point.y));

  const settingsChanged = !pendingLocalSettings
    && previousSettings !== JSON.stringify([state.volatility, state.drift, state.chartSpeed, state.payout]);
  const tradesChanged = previousTrades !== JSON.stringify(state.trades);
  const priceEl = document.querySelector("#current-price");
  const changeEl = document.querySelector("#price-change");
  const clock = document.querySelector("#chart-clock");
  const canvas = document.querySelector("#price-chart");
  if (state.mode === "demo") {
    if (priceEl) priceEl.textContent = price.toFixed(2);
    if (changeEl) {
      const previousPrice = Number(data.previousPrice);
      const change = previousPrice ? ((price - previousPrice) / previousPrice) * 100 : 0;
      changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
      changeEl.className = change >= 0 ? "positive" : "negative";
    }
    if (clock) clock.textContent = new Date().toLocaleTimeString();
  }
  if (canvas) drawChart(canvas);
  if (renderOnChange && (settingsChanged || tradesChanged)) render();
}

async function refreshLiveMarketSnapshot() {
  const { data, error } = await supabase.rpc("get_live_market_snapshot");
  if (error) throw error;

  livePrice = Number(data.price);
  liveChartPoints = (Array.isArray(data.ticks) ? data.ticks : [])
    .map((tick, index) => ({ x: index, y: Number(tick.price), time: tickTimestamp(tick) }))
    .filter((point) => Number.isFinite(point.y));

  if (state.mode === "live") {
    const priceEl = document.querySelector("#current-price");
    const changeEl = document.querySelector("#price-change");
    const clock = document.querySelector("#chart-clock");
    const canvas = document.querySelector("#price-chart");
    const previousPrice = liveChartPoints.length > 1
      ? liveChartPoints[liveChartPoints.length - 2].y
      : livePrice;
    const change = previousPrice ? ((livePrice - previousPrice) / previousPrice) * 100 : 0;
    if (priceEl) priceEl.textContent = livePrice.toFixed(2);
    if (changeEl) {
      changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
      changeEl.className = change >= 0 ? "positive" : "negative";
    }
    if (clock) clock.textContent = new Date().toLocaleTimeString();
    if (canvas) drawChart(canvas);
  }
}

async function refreshWalletSnapshot(renderOnChange = false) {
  const { data, error } = await supabase.rpc("get_wallet_snapshot");
  if (error) throw error;

  const previousBalance = state.liveBalance;
  const previousRate = walletRate;
  const previousTransactions = JSON.stringify(walletTransactions);
  const previousTrades = JSON.stringify(walletTrades);
  state.liveBalance = Number(data.balance);
  walletRate = Number(data.usdToKes);
  walletTransactions = Array.isArray(data.transactions) ? data.transactions : [];
  walletTrades = Array.isArray(data.walletTrades) ? data.walletTrades : [];
  walletLastAttemptAt = Date.now();
  const changed = previousBalance !== state.liveBalance
    || previousRate !== walletRate
    || previousTransactions !== JSON.stringify(walletTransactions)
    || previousTrades !== JSON.stringify(walletTrades);

  const balance = document.querySelector("#wallet-available");
  const kes = document.querySelector("#wallet-kes");
  if (balance) balance.textContent = formatMoney(state.liveBalance);
  if (kes) kes.textContent = formatKes(state.liveBalance, walletRate);
  if (renderOnChange && changed && (
    (state.activeView === "wallet" && walletScreen === "overview")
    || (state.activeView === "trade" && state.mode === "live")
    || state.activeView === "history"
  )) render();
}

async function initializeWorkspace(user) {
  if (workspaceUserId === user.id) {
    if (workspaceLoadPromise) await workspaceLoadPromise;
    return;
  }

  workspaceUserId = user.id;
  workspaceLoadPromise = (async () => {
    try {
      await Promise.all([
        loadProfile(user),
        loadStrategyCatalog(),
        refreshTerminalSnapshot(),
        refreshWalletSnapshot(),
      ]);
      if (window.location.hash === "#/admin/setup" && auth.profile?.role === "admin") {
        state.activeView = "admin";
        auth.screen = "workspace";
      } else if (window.location.hash === "#/admin/setup") {
        auth.screen = "admin-denied";
      } else {
        auth.screen = window.location.hash.includes("type=recovery") ? "reset-password" : "workspace";
      }
      startChart();
      void loadNotifications();
    } catch (error) {
      workspaceUserId = null;
      throw error;
    }
  })();
  try {
    await workspaceLoadPromise;
  } finally {
    workspaceLoadPromise = null;
  }
}

async function loadStrategyCatalog() {
  const { data, error } = await supabase.rpc("get_strategy_catalog");
  if (error) {
    strategyCatalogError = `Live bot catalog unavailable: ${error.message}`;
    strategyBots = defaultStrategyBots;
    return;
  }
  if (!Array.isArray(data)) {
    strategyCatalogError = "Live bot catalog returned an invalid response.";
    strategyBots = defaultStrategyBots;
    return;
  }
  strategyCatalogError = "";
  strategyBots = data.map((bot) => ({
    ...bot,
    price: Number(bot.price) || 0,
    owned: Boolean(bot.owned),
  }));
  if (!strategyBots.some((bot) => bot.id === state.selectedBot || bot.name === state.selectedBot)) {
    state.selectedBot = strategyBots[0]?.id || "";
  }
}

async function beginAuth() {
  const recoveringPassword = window.location.hash.includes("type=recovery");
  auth.screen = recoveringPassword
    ? "reset-password"
    : window.location.hash === "#/signup"
      ? "signup"
      : window.location.hash === "#/admin/setup"
        ? "admin-login"
        : "login";
  render();
  if (!supabaseConfigured) {
    auth.ready = true;
    render();
    return;
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    auth.user = data.session?.user || null;
    if (auth.user) {
      await initializeWorkspace(auth.user);
    }
  } catch (error) {
    auth.message = `Could not restore your sign-in session: ${error.message}`;
    auth.messageType = "error";
  } finally {
    auth.ready = true;
    supabase.auth.onAuthStateChange((event, session) => {
      auth.user = session?.user || null;
      if (!auth.user) {
        clearTimeout(chartTimer);
        clearTimeout(settingsSaveTimer);
        chartPollVersion += 1;
        workspaceUserId = null;
        walletLastAttemptAt = 0;
        walletTransactions = [];
        walletTrades = [];
        walletRate = 128;
        walletScreen = "overview";
        currentDeposit = null;
        walletAdminData = null;
        walletAdminLoading = false;
        walletAdminLoaded = false;
        walletAdminLastAttemptAt = 0;
        walletAdminError = "";
        pendingLocalSettings = false;
        Object.assign(state, initialState);
        state.trades = [];
        chartPoints = [];
        liveChartPoints = [];
        botSignal = null;
        auth.profile = null;
        auth.profileError = "";
        auth.screen = "login";
      } else {
        if (event === "PASSWORD_RECOVERY") auth.screen = "reset-password";
        queueMicrotask(async () => {
          try {
            await initializeWorkspace(auth.user);
          } catch (error) {
            auth.message = `Could not load remote demo data: ${error.message}`;
            auth.messageType = "error";
          }
          render();
        });
      }
      render();
    });
    render();
  }
}

function bindAuthEvents() {
  app.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => {
    auth.screen = button.dataset.screen;
    auth.message = "";
    auth.messageType = "info";
    render();
  }));
  app.querySelectorAll('[data-action="admin-gate"]').forEach((button) => button.addEventListener("click", () => {
    auth.message = "";
    if (auth.profile?.role === "admin") {
      auth.screen = "workspace";
      state.activeView = "admin";
      render();
      return;
    }
    auth.screen = "admin-login";
    render();
  }));
  app.querySelectorAll('[data-action="leave-admin"]').forEach((button) => button.addEventListener("click", () => {
    auth.screen = auth.user ? "workspace" : "login";
    auth.message = "";
    render();
  }));
  app.querySelector('[data-action="admin-retry"]')?.addEventListener("click", () => {
    auth.screen = "admin-login";
    auth.message = "";
    render();
  });
  app.querySelector('[data-action="show-funds-terms"]')?.addEventListener("click", () => {
    auth.screen = "funds-terms";
    render();
  });
  app.querySelector('[data-action="toggle-password"]')?.addEventListener("click", (event) => {
    const input = app.querySelector('[name="password"]');
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    event.currentTarget.textContent = visible ? "Hide" : "Show";
  });
  app.querySelectorAll(".auth-form").forEach((form) => form.addEventListener("submit", handleAuthSubmit));
}

function fundsTermsContent() {
  return `<div class="funds-terms">
    <div class="eyebrow">WALLET INFORMATION</div>
    <h1>Wallet funds terms</h1>
    <p>These terms explain how wallet deposits and withdrawals are currently handled.</p>
    <h2>Currency and conversion</h2>
    <p>The wallet balance is recorded in US dollars (USD). KSh amounts are estimates using the exchange rate currently shown in the wallet; the rate is managed by PIPMASTER and may change. The USD amount is the transaction amount.</p>
    <h2>Deposits</h2>
    <p>Deposits must be between $2.00 and $7,692.00. After you start a deposit request, manually send the payment from your phone using the bank transfer or M-PESA Paybill details shown. PIPMASTER does not charge a fee for Paybill deposits; your mobile network or payment provider may have separate charges. Then submit the bank reference or M-PESA transaction code. Your request appears in admin review, and funds are added only after the payment is verified and an admin confirms it. Do not send money to details obtained outside your signed-in wallet.</p>
    <h2>Withdrawals</h2>
    <p>The minimum withdrawal is $5.00. A withdrawal fee of 7.68% of the requested amount (equivalent to $0.384 per $5.00) is rounded to the nearest cent and shown before you submit. The remaining amount is the expected bank payout. The requested amount is reserved from your available balance while the request is pending; if it is rejected, the reserved amount is returned.</p>
    <p>Weekday requests may be submitted at any time. Weekend requests are available Saturday and Sunday from 9:00 AM to 1:00 PM East Africa Time. After a withdrawal request is approved, allow up to five business days for processing.</p>
    <h2>Records and support</h2>
    <p>Wallet requests and their status are recorded in your account activity. Keep your transfer receipt and reference until the request reaches a final status. Check your bank details carefully before requesting a withdrawal.</p>
    <p class="terms-note">These operational terms do not replace any disclosures required by applicable financial services, consumer protection, tax, or privacy laws. Have the final terms reviewed for the jurisdictions where the service is offered.</p>
  </div>`;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!supabase) {
    auth.message = "Supabase is not configured. Add the public project URL and anon key to your environment.";
    auth.messageType = "error";
    render();
    return;
  }
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const formType = form.dataset.form;
  auth.busy = true;
  auth.message = "";
  render();
  try {
    if (formType === "signup") {
      if (values.password !== values.confirm_password) throw new Error("The passwords do not match.");
      if (!/^[A-Za-z0-9_]{3,24}$/.test(values.username)) throw new Error("Username must be 3–24 letters, numbers, or underscores.");
      const { data, error } = await supabase.auth.signUp({
        email: String(values.email).trim(),
        password: String(values.password),
        options: {
          emailRedirectTo: getRedirectUrl(),
          data: { full_name: String(values.full_name).trim(), username: String(values.username).trim() },
        },
      });
      if (error) throw error;
      if (data.session) {
        auth.user = data.user;
        await initializeWorkspace(data.user);
        auth.message = "";
      } else {
        auth.screen = "login";
        auth.message = "Account created. Check your email to confirm the address, then sign in.";
        auth.messageType = "success";
      }
    } else if (formType === "login") {
      const adminAttempt = auth.screen === "admin-login";
      const { data, error } = await supabase.auth.signInWithPassword({
        email: String(values.email).trim(),
        password: String(values.password),
      });
      if (error) throw error;
      auth.user = data.user;
      await initializeWorkspace(data.user);
      if (adminAttempt) {
        if (auth.profile?.role !== "admin") {
          auth.screen = "admin-denied";
          auth.message = "This account does not have admin access.";
          auth.messageType = "error";
        } else {
          auth.screen = "workspace";
          state.activeView = "admin";
        }
      } else {
        auth.screen = "workspace";
      }
    } else if (formType === "forgot-password") {
      const { error } = await supabase.auth.resetPasswordForEmail(String(values.email).trim(), {
        redirectTo: getRedirectUrl(),
      });
      if (error) throw error;
      auth.screen = "login";
      auth.message = "If an account exists for that address, a password-reset link has been sent.";
      auth.messageType = "success";
    } else if (formType === "reset-password") {
      if (values.password !== values.confirm_password) throw new Error("The passwords do not match.");
      const { error } = await supabase.auth.updateUser({ password: String(values.password) });
      if (error) throw error;
      auth.screen = "workspace";
      auth.message = "";
    } else if (formType === "profile") {
      const profile = {
        full_name: String(values.full_name).trim(),
        username: String(values.username).trim(),
        phone: String(values.phone).trim(),
        country: String(values.country).trim(),
        timezone: String(values.timezone).trim() || "UTC",
        updated_at: new Date().toISOString(),
      };
      if (!/^[A-Za-z0-9_]{3,24}$/.test(profile.username)) throw new Error("Username must be 3–24 letters, numbers, or underscores.");
      const { data, error } = await supabase.from("profiles").update(profile).eq("user_id", auth.user.id).select("user_id, role, full_name, username, phone, country, timezone, avatar_url").single();
      if (error) throw error;
      auth.profile = data;
      auth.message = "Profile updated.";
      auth.messageType = "success";
    } else if (formType === "profile-email") {
      const email = String(values.email).trim();
      if (email.toLowerCase() === auth.user.email?.toLowerCase()) throw new Error("Enter an email address different from your current one.");
      const { error } = await supabase.auth.updateUser(
        { email },
        { emailRedirectTo: getRedirectUrl() },
      );
      if (error) throw error;
      auth.message = "Check your inboxes for the confirmation link to finish changing your email.";
      auth.messageType = "success";
    }
  } catch (error) {
    auth.message = error.message || "That request could not be completed.";
    auth.messageType = "error";
  } finally {
    auth.busy = false;
    render();
  }
}

async function uploadAvatar(file) {
  if (!file || !supabase || !auth.user) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    auth.message = "Choose a JPG, PNG, or WebP image.";
    auth.messageType = "error";
    render();
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    auth.message = "Profile photos must be 5 MB or smaller.";
    auth.messageType = "error";
    render();
    return;
  }
  auth.busy = true;
  render();
  try {
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const objectPath = `${auth.user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(objectPath, file, { upsert: false, contentType: file.type });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from("avatars").getPublicUrl(objectPath);
    const { data: profile, error } = await supabase.from("profiles").update({
      avatar_url: data.publicUrl,
      updated_at: new Date().toISOString(),
    }).eq("user_id", auth.user.id).select("user_id, role, full_name, username, phone, country, timezone, avatar_url").single();
    if (error) throw error;
    auth.profile = profile;
    auth.message = "Profile photo updated.";
    auth.messageType = "success";
  } catch (error) {
    auth.message = `Photo upload failed: ${error.message}`;
    auth.messageType = "error";
  } finally {
    auth.busy = false;
    render();
  }
}

function getRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) {
    auth.message = `Sign out failed: ${error.message}`;
    auth.messageType = "error";
    render();
    return;
  }
  auth.user = null;
  auth.profile = null;
  auth.screen = "login";
  workspaceUserId = null;
  workspaceLoadPromise = null;
  walletTransactions = [];
  walletTrades = [];
  walletAdminData = null;
  walletAdminLoaded = false;
  walletAdminError = "";
  adminOverviewData = null;
  adminTransactionRows = [];
  adminTransactionTotal = 0;
  adminTransactionOffset = 0;
  adminUserRows = [];
  adminUserTotal = 0;
  adminUserOffset = 0;
  walletLastAttemptAt = 0;
  walletAdminLastAttemptAt = 0;
  notificationPanelOpen = false;
  notificationData = { unreadCount: 0, items: [] };
  notificationError = "";
  notificationLastAttemptAt = 0;
  strategyBots = defaultStrategyBots;
  strategyCatalogError = "";
  state.activeView = "trade";
  render();
}

function navItem(view, icon, label, badge = "") {
  return `<button class="nav-item ${state.activeView === view ? "active" : ""}" data-view="${view}"><span class="nav-icon">${icon}</span>${label}${badge}</button>`;
}

function tradingView() {
  const active = state.mode === "demo" ? state.demoBalance : state.liveBalance;
  const activeTrades = state.mode === "live" ? walletTrades : state.trades;
  const isLive = state.mode === "live";
  const activePrice = isLive ? livePrice : price;
  const activeChartPoints = isLive ? liveChartPoints : chartPoints;
  const previousPrice = activeChartPoints.length > 1
    ? activeChartPoints[activeChartPoints.length - 2].y
    : activePrice;
  const priceChange = previousPrice ? ((activePrice - previousPrice) / previousPrice) * 100 : 0;
  return `
    <section class="page-heading">
      <div><div class="eyebrow"><span class="status-dot"></span> ${isLive ? "LIVE MARKET" : "DEMO MARKET"}</div><h1>Trading terminal</h1><p>${isLive ? "Wallet positions use the Live market." : "Explore the Demo market using demo funds."}</p></div>
      <div class="mode-switch" role="group" aria-label="Account mode">
        <button class="${state.mode === "demo" ? "selected" : ""}" data-mode="demo">Demo</button>
        <button class="${state.mode === "live" ? "selected" : ""}" data-mode="live">Live</button>
      </div>
    </section>
    <section class="balance-row">
      <div class="balance-card ${state.mode === "demo" ? "primary-balance" : ""}"><div class="balance-top"><span>DEMO BALANCE</span><span class="balance-icon">◈</span></div><strong>${formatMoney(state.demoBalance)}</strong><small><span class="positive">↗ Demo funds</span> · Auto-restores at $0 after settlement</small></div>
      <div class="balance-card ${state.mode === "live" ? "primary-balance" : ""}"><div class="balance-top"><span>LIVE WALLET</span><span class="balance-icon muted">▤</span></div><strong>${formatMoney(state.liveBalance)}</strong><small>${formatKes(state.liveBalance, walletRate)} · Available balance</small></div>
      <button class="balance-card add-funds" data-view="wallet"><span class="plus">+</span><span><strong>Open wallet</strong><small>Deposit or withdraw funds</small></span><span class="arrow">↗</span></button>
    </section>
    <div class="terminal-grid">
      <section class="panel chart-panel ${isLive ? "live-chart" : "demo-chart"}">
        <div class="panel-heading chart-heading">
          <div class="asset-title"><div class="asset-icon">P</div><div><strong>${isLive ? "PIPMASTER Live Market" : "PIPMASTER Demo Market"}</strong><small>${isLive ? "Live wallet market" : "Demo funds market"}</small></div><span class="live-pill"><i></i> ${isLive ? "LIVE MARKET" : "DEMO MARKET"}</span></div>
          <div class="price-summary"><div class="price-value"><strong id="current-price">${activePrice.toFixed(2)}</strong><small>USD</small></div><span class="${priceChange >= 0 ? "positive" : "negative"}" id="price-change">${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%</span></div>
        </div>
        <div class="chart-toolbar">
          <div class="chart-tabs"><button class="active">Chart</button><button data-view="history">${isLive ? "Live positions" : "Positions"} <span class="count">${activeTrades.filter((trade) => trade.status === "open").length}</span></button></div>
          <div class="timeframes"><span class="chart-type-label">Candles</span>${["1m", "5m", "15m", "1h"].map((item) => `<button class="${item === chartTimeframe ? "active" : ""}" data-timeframe="${item}">${item}</button>`).join("")}</div>
        </div>
        <div class="chart-wrap"><canvas id="price-chart" role="img" aria-label="${isLive ? "Live" : "Demo"} PIPMASTER candlestick chart with price and time scales"></canvas></div>
        <div class="chart-legend"><span><b>O</b><strong id="chart-open">—</strong><b>H</b><strong id="chart-high">—</strong><b>L</b><strong id="chart-low">—</strong><b>C</b><strong id="chart-close">—</strong></span><span class="chart-source">PIPMASTER market · <span id="chart-clock">--:--:--</span></span></div>
      </section>

      <section class="panel trade-panel">${tradePanelView(active)}</section>
    </div>

    <section class="lower-grid">
      <section class="panel scanner-panel">
        <div class="panel-heading"><div class="scanner-title"><div class="scanner-icon">✳</div><div><h2>AI Market Scanner</h2><p>Indicator analysis of shared PIPMASTER market history</p></div></div><button class="subtle-button" data-action="scan">Run scan <span>↗</span></button></div>
        <div class="scanner-result" id="scanner-result"><div class="scan-meter"><div class="meter-ring">—</div></div><div><span class="eyebrow">INDICATOR-BASED · MARKET SIGNALS</span><strong>Scanner ready</strong></div></div>
      </section>
      <section class="panel bots-panel">
        <div class="panel-heading"><div><h2>Trading bots</h2><p>Signals for the shared PIPMASTER market</p></div><button class="text-button" data-view="bots">Browse all <span>→</span></button></div>
        <div class="bot-cards">
          ${strategyBots.map(botCard).join("")}
        </div>
        <div class="bot-run-row"><span class="bots-note">Review each signal before opening a position. No win probability is guaranteed.</span><button class="subtle-button" data-action="run-bot">Generate signal</button></div>
        ${botSignal ? `<div class="bot-signal"><div><span class="eyebrow">${escapeHtml(botSignal.bot)} · ${isLive ? "LIVE WALLET" : "DEMO"} SIGNAL</span><strong>${botSignal.choice === "over" ? "OVER" : "UNDER"} · ${botSignal.strength} signal strength</strong><small>Indicator signal only; it is not a win probability. Review before placing.</small></div><button class="subtle-button" data-action="use-signal">Use signal</button></div>` : ""}
      </section>
    </section>

    <section class="panel activity-panel">
      <div class="panel-heading"><div><h2>Recent activity</h2><p>${isLive ? "Your recent wallet-funded positions" : "Your latest demo positions"}</p></div><button class="text-button" data-view="history">View activity <span>→</span></button></div>
      ${tradeTable(activeTrades.slice(0, 4), isLive)}
    </section>`;
}

function tradePanelView(availableBalance) {
  const isLive = state.mode === "live";
  if (availableBalance < 1) {
    const minimumTopUp = Math.max(2, Math.ceil((1 - availableBalance) * 100) / 100);
    return `<div class="wallet-live-message">
      <span class="balance-icon">◈</span>
      <h2>Insufficient ${isLive ? "wallet" : "demo"} balance</h2>
      <p>The minimum trade is $1.00. Your available ${isLive ? "wallet" : "demo"} balance is ${formatMoney(availableBalance)}.${isLive ? ` Deposit at least ${formatMoney(minimumTopUp)} (wallet deposits start at $2.00) to unlock live trading controls.` : " Reset your demo balance to continue."}</p>
      ${isLive
        ? `<button class="auth-primary compact" type="button" data-view="wallet">Deposit funds</button>`
        : `<button class="auth-primary compact" type="button" data-action="reset-demo">Reset demo balance</button>`}
    </div>`;
  }

  const stake = Math.min(state.stake, availableBalance);
  return `<div class="panel-heading"><div><h2>Place a ${isLive ? "live" : "demo"} position</h2><p>${isLive ? "Uses available wallet funds on the live market." : "Test your strategy with demo funds on the Demo market."}</p></div><span class="${isLive ? "live-pill" : "demo-label"}">${isLive ? "LIVE" : "DEMO"}</span></div>
    <div class="trade-field"><label>TRADE TYPE</label><div class="segmented" role="tablist"><button class="${state.tradeType === "digits" ? "selected" : ""}" data-trade-type="digits">Even / Odd</button><button class="${state.tradeType === "direction" ? "selected" : ""}" data-trade-type="direction">Over / Under</button></div></div>
    <div class="trade-field"><label>TRADE DURATION</label><div class="duration-select">${[10, 30, 60, 300].map((seconds) => `<button class="${state.duration === seconds ? "selected" : ""}" data-duration="${seconds}">${seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</button>`).join("")}</div></div>
    <div class="trade-field"><label>STAKE <span>Available ${formatMoney(availableBalance)}</span></label><div class="stake-control"><button data-stake="-">−</button><div><span>$</span><input id="stake" inputmode="decimal" type="number" min="1" max="${availableBalance}" step="0.01" value="${stake}" aria-label="Trade stake"></div><button data-stake="+">+</button></div><div class="quick-stakes">${[1, 5, 10, 25].map((amount) => `<button data-quick-stake="${amount}">$${amount}</button>`).join("")}</div></div>
    <div class="payout-preview"><span>Potential return <small>incl. stake</small></span><strong id="potential-return">${formatMoney(stake * (1 + state.payout / 100))}</strong><span class="payout-rate">${state.payout}% payout</span></div>
    <div class="trade-actions"><button class="trade-button even" data-choice="${state.tradeType === "digits" ? "even" : "over"}"><span>${state.tradeType === "digits" ? "EVEN" : "OVER"}</span><small>${state.tradeType === "digits" ? "Last digit 0, 2, 4, 6, 8" : "Price finishes above entry"}</small><b>↗</b></button><button class="trade-button odd" data-choice="${state.tradeType === "digits" ? "odd" : "under"}"><span>${state.tradeType === "digits" ? "ODD" : "UNDER"}</span><small>${state.tradeType === "digits" ? "Last digit 1, 3, 5, 7, 9" : "Price finishes below entry"}</small><b>↘</b></button></div>
  `;
}

function botCard(bot) {
  const selected = state.selectedBot === bot.id || state.selectedBot === bot.name;
  const accessLabel = bot.price > 0 && !bot.owned ? `Unlock ${formatMoney(bot.price)}` : bot.tier;
  return `<button class="bot-card ${selected ? "selected" : ""}" data-bot="${escapeHtml(bot.id)}"><span class="bot-symbol" style="--bot-color:${bot.color}">${escapeHtml(bot.icon)}</span><span class="bot-info"><strong>${escapeHtml(bot.name)}</strong><small>${escapeHtml(bot.description)}</small></span><span class="bot-tier">${escapeHtml(accessLabel)}</span></button>`;
}

function tradeTable(trades, isLive = false) {
  if (!trades.length) return `<div class="empty-state"><span>⌁</span><strong>No ${isLive ? "live" : "demo"} positions yet</strong><p>${isLive ? "Your wallet-funded positions will appear here." : "Place a demo position to see activity here."}</p></div>`;
  return `<div class="table-scroll"><table><thead><tr><th>TRADE</th><th>TYPE</th><th>STAKE</th><th>RESULT</th><th>STATUS</th><th>TIME</th></tr></thead><tbody>${trades.map((trade) => {
    const isOpen = trade.status === "open";
    const status = trade.status;
    const statusClass = isOpen ? "open" : trade.status === "lost" ? "lost" : "closed";
    return `<tr><td><span class="trade-asset-icon">P</span>PIPMASTER Market</td><td><span class="outcome-type ${trade.choice}">${escapeHtml(trade.choice.toUpperCase())}</span></td><td>${formatMoney(trade.stake)}</td><td class="${trade.result > 0 ? "positive" : isOpen ? "" : "negative"}">${isOpen ? "—" : `${trade.result > 0 ? "+" : "−"}${formatMoney(Math.abs(trade.result))}`}</td><td><span class="status-badge ${statusClass}">${escapeHtml(status)}</span></td><td>${new Date(trade.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function historyView() {
  return `<section class="page-heading"><div><div class="eyebrow">ACCOUNT</div><h1>Activity</h1><p>Review wallet transactions and your live and demo positions.</p></div></section><section class="panel activity-panel full-panel"><div class="panel-heading"><div><h2>Wallet transactions</h2><p>${walletTransactions.length} transactions · all amounts in USD</p></div><button class="subtle-button" data-view="wallet">Open wallet</button></div>${walletTransactionsTable(walletTransactions)}</section><section class="panel activity-panel full-panel"><div class="panel-heading"><div><h2>Live wallet positions</h2><p>${walletTrades.length} positions · settled from your wallet balance</p></div></div>${tradeTable(walletTrades, true)}</section><section class="panel activity-panel full-panel"><div class="panel-heading"><div><h2>Demo trade history</h2><p>${state.trades.length} positions</p></div><button class="secondary-button" data-action="clear-history">Clear demo history</button></div>${tradeTable(state.trades)}</section>`;
}

function adminView() {
  return `<section class="page-heading"><div><div class="eyebrow">PIPMASTER ADMINISTRATION</div><h1>Admin dashboard</h1><p>Manage users, wallet requests, bot access, operating expenses, and shared market settings.</p></div><button class="subtle-button" type="button" data-action="wallet-admin-refresh">Refresh dashboard</button></section>
    ${walletAdminError ? `<div class="notice notice-warn"><span>ⓘ</span><div><strong>Admin data needs attention</strong><p>${escapeHtml(walletAdminError)}</p></div></div>` : ""}
    ${adminFinancialSummary()}
    ${adminTransactionsPanel()}
    ${adminUsersPanel()}
    ${adminStrategiesPanel()}
    ${adminBusinessPanel()}
    <div class="admin-grid">
      <section class="panel settings-panel"><div class="panel-heading"><div><h2>Shared market</h2><p>Manage the PIPMASTER Live and Demo markets.</p></div><span class="setting-icon">⌁</span></div>
        ${rangeSetting("volatility", "Volatility", state.volatility, 0.1, 1, 0.01, `${Math.round(state.volatility * 100)}%`, "Changes the size of market price movements.")}
        ${rangeSetting("drift", "Price drift", state.drift, -0.5, 0.5, 0.01, `${state.drift > 0 ? "+" : ""}${Math.round(state.drift * 100)}%`, "Adds a small upward or downward bias to market prices.")}
        ${rangeSetting("chartSpeed", "Chart speed", state.chartSpeed, 0.5, 2, 0.1, `${state.chartSpeed.toFixed(1)}×`, "Changes how quickly market ticks are drawn.")}
        <div class="setting-block"><div class="setting-label"><div><strong>Position payout</strong><small>Profit percentage for new demo and wallet positions.</small></div><div class="range-value"><input type="number" id="payout-input" min="1" max="95" value="${state.payout}">%</div></div><input class="range-input" data-setting="payout" type="range" min="1" max="95" step="1" value="${state.payout}"><div class="setting-hint">Wallet positions snapshot this setting when opened. Returns are not guaranteed.</div></div>
        <div class="setting-block"><div class="setting-label"><div><strong>Trade durations</strong><small>Available position expiry options.</small></div></div><div class="setting-options">${[10, 30, 60, 300].map((seconds) => `<button class="option-chip ${state.duration === seconds ? "selected" : ""}" data-duration="${seconds}">${seconds < 60 ? `${seconds}s` : `${seconds / 60} min`}</button>`).join("")}</div></div>
      </section>
      <section class="panel admin-side-panel"><div class="panel-heading"><div><h2>My account</h2><p>Administrator account overview</p></div><span class="status-badge open">ACTIVE</span></div><div class="admin-stat"><span>Demo balance</span><strong>${formatMoney(state.demoBalance)}</strong></div><div class="admin-stat"><span>My wallet balance</span><strong>${formatMoney(state.liveBalance)}</strong></div><div class="admin-stat"><span>Registered users</span><strong>${Number(adminOverviewData?.summary?.registeredUsers || 0).toLocaleString()}</strong></div><button class="secondary-button wide" data-action="reset-demo">Reset demo balance</button>
        <div class="admin-separator"></div><div class="admin-helper"><span>ⓘ</span><p>All user balances, requests, and expense totals below are read from protected Supabase records.</p></div>
      </section>
    </div>
    ${adminAnnouncementPanel()}
    ${walletAdminPanel()}`;
}

function adminFinancialSummary() {
  const summary = adminOverviewData?.summary;
  if (!summary) {
    return `<section class="admin-metric-grid"><div class="panel empty-state">Loading business and account totals…</div></section>`;
  }
  const metrics = [
    ["Registered users", Number(summary.registeredUsers || 0).toLocaleString(), "ALL ACCOUNTS"],
    ["User wallet balances", formatMoney(summary.totalWalletBalances), "CURRENT CUSTOMER FUNDS"],
    ["Confirmed deposits", formatMoney(summary.confirmedDeposits), "PAID IN"],
    ["Withdrawals sent", formatMoney(summary.paidWithdrawalPayouts), "CONFIRMED PAYOUTS"],
    ["Pending withdrawal reserves", formatMoney(summary.pendingWithdrawalReserves), "FULL AMOUNT RESERVED"],
    ["Open trade exposure", formatMoney(summary.openTradeMaximumExposure), "MAXIMUM PAYOUT"],
    ["Paid expenses", formatMoney(summary.paidExpenses), "RECORDED EXPENSES"],
    ["Unpaid expenses", formatMoney(summary.unpaidExpenses), "RECORDED LIABILITIES"],
    ["Net retained estimate", formatMoney(summary.estimatedNetRetained), "NOT AUDITED PROFIT"],
  ];
  return `<section class="admin-metric-grid">${metrics.map(([label, value, note]) => `<article class="panel admin-metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("")}
    <article class="panel admin-metric-card"><span>Pending requests</span><strong>${Number(summary.pendingTransactions || 0).toLocaleString()}</strong><small>${formatMoney(summary.pendingDepositAmount)} deposit requests</small></article>
    <article class="panel admin-metric-card"><span>Completed / rejected</span><strong>${Number(summary.completedTransactions || 0).toLocaleString()} / ${Number(summary.rejectedTransactions || 0).toLocaleString()}</strong><small>CONFIRMED / REJECTED REQUESTS</small></article>
    <article class="panel admin-metric-card"><span>Bot purchases</span><strong>${formatMoney(summary.botSales)}</strong><small>ONE-TIME UNLOCKS · ALREADY IN WALLET BALANCE</small></article>
    <p class="admin-accounting-note">Net retained estimate = confirmed deposits − completed withdrawals − current user balances − full pending withdrawal reserves − maximum open-trade exposure − recorded paid and unpaid expenses. It is an operational estimate, not audited profit; it excludes external cash, processor fees, taxes, and unrecorded liabilities.</p>
  </section>`;
}

function adminTransactionsPanel() {
  const pageEnd = Math.min(adminTransactionOffset + adminTransactionRows.length, adminTransactionTotal);
  return `<section class="panel admin-data-panel">
    <div class="panel-heading"><div><h2>Transaction history</h2><p>Search every deposit and withdrawal by status; pending actions remain available in the review queue below.</p></div><span class="status-badge open">${adminTransactionTotal.toLocaleString()} RECORDS</span></div>
    <div class="admin-filter-row">
      <label>Status<select data-admin-transaction-status><option value="all" ${adminTransactionStatus === "all" ? "selected" : ""}>All statuses</option><option value="awaiting_payment" ${adminTransactionStatus === "awaiting_payment" ? "selected" : ""}>Awaiting payment</option><option value="pending" ${adminTransactionStatus === "pending" ? "selected" : ""}>Pending review</option><option value="confirmed" ${adminTransactionStatus === "confirmed" ? "selected" : ""}>Confirmed</option><option value="rejected" ${adminTransactionStatus === "rejected" ? "selected" : ""}>Rejected</option></select></label>
      <label>Type<select data-admin-transaction-type><option value="all" ${adminTransactionType === "all" ? "selected" : ""}>Deposits and withdrawals</option><option value="deposit" ${adminTransactionType === "deposit" ? "selected" : ""}>Deposits</option><option value="withdrawal" ${adminTransactionType === "withdrawal" ? "selected" : ""}>Withdrawals</option></select></label>
      <span class="admin-page-count">${adminTransactionTotal ? `${adminTransactionOffset + 1}–${pageEnd} of ${adminTransactionTotal}` : "No records"}</span>
      <button class="secondary-button" type="button" data-action="transactions-prev" ${adminTransactionOffset <= 0 || adminTransactionLoading ? "disabled" : ""}>Previous</button>
      <button class="secondary-button" type="button" data-action="transactions-next" ${pageEnd >= adminTransactionTotal || adminTransactionLoading ? "disabled" : ""}>Next</button>
    </div>
    ${adminTransactionLoading ? `<div class="empty-state">Loading transaction history…</div>` : adminTransactionRows.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>DATE</th><th>USER</th><th>TYPE</th><th>AMOUNT / PAYOUT</th><th>STATUS</th><th>REFERENCE / NOTE</th></tr></thead><tbody>${adminTransactionRows.map((row) => `<tr><td>${new Date(Number(row.time)).toLocaleString()}</td><td><strong>${escapeHtml(row.fullName || row.email || "User")}</strong><small>${escapeHtml(row.email || "")}</small></td><td>${escapeHtml(row.type)}</td><td>${formatMoney(row.amount)}${row.type === "withdrawal" ? `<small>Fee ${formatMoney(row.fee)} · payout ${formatMoney(row.payout)}</small>` : ""}</td><td>${row.type === "deposit" && row.status === "pending"
      ? `<button class="wallet-status pending wallet-status-action" type="button" data-action="review-wallet" data-id="${escapeHtml(row.id)}" data-approve="true" aria-label="Confirm deposit and credit ${escapeHtml(row.email || "user")}" title="Verify the payment, then confirm to credit the user's wallet"><span>pending</span><small>Confirm deposit</small></button>`
      : `<span class="wallet-status ${escapeHtml(row.status)}">${escapeHtml((row.status || "").replaceAll("_", " "))}</span>`}</td><td>${escapeHtml(row.reference || row.note || row.destination?.accountNumber || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>No matching wallet requests</strong><p>Choose another status or transaction type.</p></div>`}
  </section>`;
}

function adminUsersPanel() {
  const pageEnd = Math.min(adminUserOffset + adminUserRows.length, adminUserTotal);
  return `<section class="panel admin-data-panel">
    <div class="panel-heading"><div><h2>Registered users & balances</h2><p>Search registered accounts and review their current wallet balance.</p></div><span class="status-badge open">${adminUserTotal.toLocaleString()} USERS</span></div>
    <form class="admin-filter-row" data-form="admin-user-search"><label class="admin-search-field">Search users<input name="search" value="${escapeHtml(adminUserSearch)}" placeholder="Email, name, or username"></label><button class="auth-primary compact" type="submit">Search</button><span class="admin-page-count">${adminUserTotal ? `${adminUserOffset + 1}–${pageEnd} of ${adminUserTotal}` : "No users"}</span><button class="secondary-button" type="button" data-action="users-prev" ${adminUserOffset <= 0 || adminUserLoading ? "disabled" : ""}>Previous</button><button class="secondary-button" type="button" data-action="users-next" ${pageEnd >= adminUserTotal || adminUserLoading ? "disabled" : ""}>Next</button></form>
    ${adminUserLoading ? `<div class="empty-state">Loading registered users…</div>` : adminUserRows.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>WALLET BALANCE</th><th>REGISTERED</th></tr></thead><tbody>${adminUserRows.map((user) => `<tr><td><strong>${escapeHtml(user.fullName || user.email || "User")}</strong><small>${escapeHtml(user.email || "")}${user.username ? ` · @${escapeHtml(user.username)}` : ""}</small></td><td>${escapeHtml(user.role || "user")}</td><td>${formatMoney(user.balance)}</td><td>${new Date(Number(user.createdAt)).toLocaleDateString()}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>No registered users found</strong><p>Try a different search.</p></div>`}
  </section>`;
}

function strategyEditorFields(strategy = {}) {
  const keys = ["Pulse", "Sentry", "Orbit", "LAMIA", "INSTA", "SKPOT", "VULJA"];
  return `<div class="strategy-editor-fields">
    <label>Name<input name="name" value="${escapeHtml(strategy.name || "")}" maxlength="80" required></label>
    <label>Signal algorithm<select name="algorithm_key" required>${keys.map((key) => `<option value="${key}" ${strategy.strategyKey === key ? "selected" : ""}>${key}</option>`).join("")}</select></label>
    <label>Bot type<input name="strategy_type" value="${escapeHtml(strategy.type || "")}" maxlength="80" required></label>
    <label>Tier label<input name="tier" value="${escapeHtml(strategy.tier || "Standard")}" maxlength="40" required></label>
    <label>One-time price (USD)<input name="price_usd" type="number" min="0" max="100000" step="0.01" value="${Number(strategy.price || 0).toFixed(2)}" required></label>
    <label>Icon<input name="icon" value="${escapeHtml(strategy.icon || "◈")}" maxlength="8" required></label>
    <label>Color<input name="color" type="color" value="${escapeHtml(strategy.color || "#61b8ed")}" required></label>
    <label class="strategy-description-field">Description<input name="description" value="${escapeHtml(strategy.description || "")}" maxlength="300" required></label>
  </div>`;
}

function adminStrategiesPanel() {
  const strategies = adminOverviewData?.strategies || [];
  return `<section class="panel admin-data-panel bots-admin-panel">
    <div class="panel-heading"><div><h2>Bot catalog & pricing</h2><p>One-time wallet unlocks. Removing a bot hides it from new users; prior purchases and activity stay stored. New bot names use one of the supported signal algorithms.</p></div><span class="eyebrow">${strategies.length} STORED BOTS</span></div>
    ${strategies.map((bot) => `<article class="admin-strategy-item ${bot.active ? "" : "inactive"}">
      <div class="admin-strategy-summary"><span class="bot-symbol" style="--bot-color:${bot.color}">${escapeHtml(bot.icon)}</span><div><strong>${escapeHtml(bot.name)}</strong><small>${Number(bot.purchases || 0).toLocaleString()} unlocks · ${formatMoney(bot.sales)} sales · ${bot.active ? "Visible in catalog" : "Removed from catalog"}</small></div><span class="status-badge ${bot.active ? "open" : "rejected"}">${bot.active ? "ACTIVE" : "REMOVED"}</span></div>
      <form class="admin-strategy-form" data-form="admin-strategy-edit" data-id="${escapeHtml(bot.id)}">${strategyEditorFields(bot)}<div class="admin-form-actions"><button class="auth-primary compact" type="submit">Save bot</button><button class="secondary-button" type="button" data-action="toggle-strategy" data-id="${escapeHtml(bot.id)}" data-active="${bot.active}">${bot.active ? "Remove from market" : "Restore bot"}</button></div></form>
    </article>`).join("") || `<div class="empty-state">Loading stored bot catalog…</div>`}
    <details class="admin-create-details"><summary>Add a bot to the catalog</summary><form class="admin-strategy-form" data-form="admin-strategy-add">${strategyEditorFields()}<div class="admin-form-actions"><button class="auth-primary compact" type="submit">Add bot</button></div></form></details>
  </section>`;
}

function adminBusinessPanel() {
  const expenses = adminOverviewData?.expenses || [];
  const categories = ["Operations", "Hosting", "Marketing", "Payroll", "Banking fees", "Equipment", "Other"];
  return `<section class="panel admin-data-panel">
    <div class="panel-heading"><div><h2>Business expenses</h2><p>Record paid costs and unpaid accrued liabilities in USD. Paid and unpaid non-void records reduce the net-retained estimate.</p></div><span class="status-badge open">${formatMoney(adminOverviewData?.summary?.paidExpenses || 0)} PAID</span></div>
    <form class="admin-expense-form" data-form="admin-expense">
      <label>Category<select name="category" required>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select></label>
      <label>Amount (USD)<input name="amount_usd" type="number" min="0.01" max="100000000" step="0.01" required></label>
      <label>Date<input name="expense_date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
      <label>Status<select name="status"><option value="unpaid">Unpaid / accrued</option><option value="paid">Paid</option></select></label>
      <label class="expense-description-field">Description<input name="description" maxlength="500" placeholder="Supplier, reason, or accounting note"></label>
      <button class="auth-primary compact" type="submit">Record expense</button>
    </form>
    ${expenses.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>DATE</th><th>CATEGORY / DESCRIPTION</th><th>AMOUNT</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${expenses.map((expense) => `<tr><td>${escapeHtml(expense.date)}</td><td><strong>${escapeHtml(expense.category)}</strong><small>${escapeHtml(expense.description || "—")}</small></td><td>${formatMoney(expense.amount)}</td><td><span class="wallet-status ${expense.status === "paid" ? "confirmed" : expense.status === "void" ? "rejected" : "pending"}">${escapeHtml(expense.status)}</span></td><td>${expense.status === "void" ? "—" : `<button class="table-action" type="button" data-action="expense-status" data-id="${escapeHtml(expense.id)}" data-status="${expense.status === "paid" ? "unpaid" : "paid"}">${expense.status === "paid" ? "Mark unpaid" : "Mark paid"}</button><button class="table-action danger" type="button" data-action="expense-status" data-id="${escapeHtml(expense.id)}" data-status="void">Void</button>`}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>No business expenses recorded</strong><p>New expenses will appear here and remain in the database.</p></div>`}
    <p class="admin-accounting-note">Expense history is retained; voiding a record excludes it from totals without deleting the audit record. The dashboard shows the latest 100 expense records.</p>
  </section>`;
}

function adminAnnouncementPanel() {
  return `<section class="panel admin-data-panel">
    <div class="panel-heading"><div><h2>Notify all users</h2><p>Send a persistent in-app announcement to every registered account, including administrators.</p></div></div>
    <form class="admin-announcement-form" data-form="admin-announcement"><label>Title<input name="title" maxlength="120" required></label><label>Message<textarea name="message" rows="3" maxlength="500" required></textarea></label><button class="auth-primary compact" type="submit">Publish announcement</button></form>
  </section>`;
}

function walletAdminPanel() {
  const settings = walletAdminData?.settings || {};
  const requests = walletAdminData?.requests || [];
  return `<section class="panel wallet-admin-panel">
    <div class="panel-heading"><div><h2>Wallet payment settings</h2><p>Payment details are shown only to a signed-in user after they start a deposit request.</p></div><button class="subtle-button" type="button" data-action="wallet-admin-refresh">Refresh</button></div>
    ${walletAdminError ? `<div class="notice notice-warn"><span>ⓘ</span><div><strong>Wallet admin data could not be loaded</strong><p>${escapeHtml(walletAdminError)}</p></div></div>` : ""}
    ${walletAdminLoading ? `<div class="empty-state">Loading wallet requests…</div>` : ""}
    <form class="wallet-admin-form" data-form="wallet-settings">
      <div class="profile-form-heading"><h2>Deposit payment details</h2><p>These details are shown after a user starts a deposit. Changes apply to new requests; existing requests keep their saved instructions. Never enter a bank password, PIN, or one-time security code here.</p></div>
      <div class="profile-fields">
        <label>Bank name (optional)<input name="bank_name" value="${escapeHtml(settings.bankName || "")}" maxlength="120"></label>
        <label>Account name (optional)<input name="account_name" value="${escapeHtml(settings.accountName || "")}" maxlength="120"></label>
        <label>Account number (optional)<input name="account_number" value="${escapeHtml(settings.accountNumber || "")}" maxlength="120"></label>
        <label>Branch (optional)<input name="branch_name" value="${escapeHtml(settings.branchName || "")}" maxlength="120"></label>
        <label>SWIFT/BIC (optional)<input name="swift_code" value="${escapeHtml(settings.swiftCode || "")}" maxlength="32"></label>
        <label>USD to KSh rate<input name="usd_to_kes" type="number" min="1" max="100000" step="0.0001" value="${escapeHtml(settings.usdToKes ?? 128)}" required></label>
        <label class="wallet-instructions-field">Bank transfer instructions (optional)<textarea name="deposit_instructions" rows="4" maxlength="2000">${escapeHtml(settings.depositInstructions || "")}</textarea></label>
        <div class="wallet-paybill-heading"><h2>M-PESA Paybill</h2><p>Paybill deposits are free of PIPMASTER fees.</p></div>
        <label>Paybill number<input name="paybill_number" value="${escapeHtml(settings.paybillNumber || "522533")}" maxlength="120" required></label>
        <label>Paybill account number<input name="paybill_account_number" value="${escapeHtml(settings.paybillAccountNumber || "8126239")}" maxlength="120" required></label>
        <label>Paybill account name<input name="paybill_account_name" value="${escapeHtml(settings.paybillAccountName || "PIPMASTER")}" maxlength="120" required></label>
      </div>
      <button class="auth-primary compact" type="submit" ${walletBusy ? "disabled" : ""}>${walletBusy ? "Saving…" : "Save payment settings"}</button>
    </form>
    <div class="wallet-admin-queue">
      <div class="panel-heading"><div><h2>Pending wallet requests</h2><p>Deposit requests appear after users submit a payment code. Verify it through the bank or M-PESA; confirming credits the user. Confirm withdrawals only after sending the payout.</p></div><span class="status-badge open">${requests.length} PENDING</span></div>
      ${requests.length ? requests.map(walletAdminRequestRow).join("") : `<div class="empty-state"><span>✓</span><strong>No pending requests</strong><p>New deposit and withdrawal requests will appear here.</p></div>`}
    </div>
  </section>`;
}

function walletAdminRequestRow(request) {
  const isDeposit = request.type === "deposit";
  const destination = request.destination || {};
  return `<article class="wallet-review-item">
    <div class="wallet-review-heading"><div><span class="eyebrow">${isDeposit ? "DEPOSIT" : "WITHDRAWAL"} · ${escapeHtml(request.email || "User")}</span><strong>${formatMoney(request.amount)}</strong></div><time>${new Date(Number(request.time)).toLocaleString()}</time></div>
    <div class="wallet-review-details">
      ${request.fullName ? `<span>Account name: ${escapeHtml(request.fullName)}</span>` : ""}
      ${isDeposit ? `<span>Payment reference: <strong>${escapeHtml(request.reference || "Not submitted")}</strong></span>` : `<span>Fee ${formatMoney(request.fee)} · Payout ${formatMoney(request.payout)}</span><span>${escapeHtml(destination.bankName || "")} · ${escapeHtml(destination.accountName || "")} · ${escapeHtml(destination.accountNumber || "")}${destination.branchName ? ` · ${escapeHtml(destination.branchName)}` : ""}</span>`}
    </div>
    <label class="wallet-review-note">Message for user (optional)<input maxlength="500" data-wallet-review-note="${escapeHtml(request.id)}" placeholder="Status or next steps"></label>
    <div class="wallet-review-actions">
      <button class="auth-primary compact" type="button" data-action="review-wallet" data-id="${escapeHtml(request.id)}" data-approve="true">${isDeposit ? "Confirm deposit" : "Confirm sent"}</button>
      <button class="secondary-button" type="button" data-action="review-wallet" data-id="${escapeHtml(request.id)}" data-approve="false">Reject request</button>
    </div>
  </article>`;
}

async function loadWalletAdminData() {
  if (walletAdminLoading || auth.profile?.role !== "admin") return;
  walletAdminLastAttemptAt = Date.now();
  walletAdminLoading = true;
  walletAdminError = "";
  try {
    const [walletResult, overviewResult, transactionsResult, usersResult] = await Promise.all([
      supabase.rpc("get_wallet_admin_snapshot"),
      supabase.rpc("get_admin_overview"),
      supabase.rpc("get_admin_transactions", {
        p_status: adminTransactionStatus,
        p_type: adminTransactionType,
        p_offset: adminTransactionOffset,
        p_limit: 50,
      }),
      supabase.rpc("get_admin_users", {
        p_search: adminUserSearch,
        p_offset: adminUserOffset,
        p_limit: 50,
      }),
    ]);
    if (walletResult.error) throw new Error(`Wallet requests: ${walletResult.error.message}`);
    if (overviewResult.error) throw new Error(`Dashboard totals: ${overviewResult.error.message}`);
    if (transactionsResult.error) throw new Error(`Transaction history: ${transactionsResult.error.message}`);
    if (usersResult.error) throw new Error(`User list: ${usersResult.error.message}`);
    walletAdminData = walletResult.data;
    adminOverviewData = overviewResult.data;
    adminTransactionRows = transactionsResult.data?.items || [];
    adminTransactionTotal = Number(transactionsResult.data?.total || 0);
    adminUserRows = usersResult.data?.items || [];
    adminUserTotal = Number(usersResult.data?.total || 0);
    walletAdminLoaded = true;
  } catch (error) {
    walletAdminError = error.message || "Could not load wallet administration data.";
    walletAdminLoaded = true;
  } finally {
    walletAdminLoading = false;
    if (state.activeView === "admin") render();
  }
}

async function loadAdminTransactions() {
  if (auth.profile?.role !== "admin" || adminTransactionLoading) return;
  adminTransactionLoading = true;
  if (state.activeView === "admin") render();
  try {
    const { data, error } = await supabase.rpc("get_admin_transactions", {
      p_status: adminTransactionStatus,
      p_type: adminTransactionType,
      p_offset: adminTransactionOffset,
      p_limit: 50,
    });
    if (error) throw error;
    adminTransactionRows = data?.items || [];
    adminTransactionTotal = Number(data?.total || 0);
  } catch (error) {
    walletAdminError = `Transaction history: ${error.message}`;
  } finally {
    adminTransactionLoading = false;
    if (state.activeView === "admin") render();
  }
}

async function loadAdminUsers() {
  if (auth.profile?.role !== "admin" || adminUserLoading) return;
  adminUserLoading = true;
  if (state.activeView === "admin") render();
  try {
    const { data, error } = await supabase.rpc("get_admin_users", {
      p_search: adminUserSearch,
      p_offset: adminUserOffset,
      p_limit: 50,
    });
    if (error) throw error;
    adminUserRows = data?.items || [];
    adminUserTotal = Number(data?.total || 0);
  } catch (error) {
    walletAdminError = `User list: ${error.message}`;
  } finally {
    adminUserLoading = false;
    if (state.activeView === "admin") render();
  }
}

function rangeSetting(key, label, value, min, max, step, display, description) {
  return `<div class="setting-block"><div class="setting-label"><div><strong>${label}</strong><small>${description}</small></div><span class="range-value" id="${key}-value">${display}</span></div><input class="range-input" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}

function simpleView(view) {
  if (view === "wallet") return walletView();
  const titles = { bots: ["Trading bot signals", "Explore indicator-based strategies for the shared PIPMASTER market."], profile: ["Profile", "Manage account information stored securely in Supabase."] };
  const [title, subtitle] = titles[view] || ["Page not found", "Choose a page from the navigation."];
  return `<section class="page-heading"><div><div class="eyebrow">PIPMASTER</div><h1>${title}</h1><p>${subtitle}</p></div></section>
    ${strategyCatalogError ? `<div class="notice notice-warn"><span>ⓘ</span><div><strong>Bot catalog could not be refreshed</strong><p>${escapeHtml(strategyCatalogError)} Existing built-in strategies are shown; purchases require the database migration.</p></div></div>` : ""}
    <section class="bot-list">${strategyBots.map((bot) => `<button class="bot-market-card ${state.selectedBot === bot.id || state.selectedBot === bot.name ? "selected" : ""}" data-bot="${escapeHtml(bot.id)}"><span class="bot-symbol" style="--bot-color:${bot.color}">${escapeHtml(bot.icon)}</span><span><strong>${escapeHtml(bot.name)}</strong><small>${escapeHtml(bot.type)} · ${escapeHtml(bot.description)}</small></span><span class="bot-tier">${bot.price > 0 && !bot.owned ? `Unlock ${formatMoney(bot.price)}` : escapeHtml(bot.tier)}</span><span class="bot-arrow">${bot.owned || !bot.price ? "→" : "BUY"}</span></button>`).join("")}</section>
    ${botSignal ? `<div class="bot-signal"><div><span class="eyebrow">${escapeHtml(botSignal.bot)} · ${state.mode === "live" ? "LIVE WALLET" : "DEMO"} SIGNAL</span><strong>${botSignal.choice.toUpperCase()} · ${botSignal.strength} signal strength</strong><small>Indicator signal only; not a win probability. Review before placing.</small></div><button class="subtle-button" data-action="use-signal">Use signal</button></div>` : ""}
    <button class="auth-primary compact bot-signal-action" type="button" data-action="run-bot" ${strategyBots.length ? "" : "disabled"}>Generate ${escapeHtml(strategyBots.find((bot) => bot.id === state.selectedBot || bot.name === state.selectedBot)?.name || "bot")} signal</button>`;
}

function walletView() {
  const pageHeading = `<section class="page-heading"><div><div class="eyebrow">ACCOUNT WALLET</div><h1>Wallet</h1><p>Manage deposits, withdrawals, and your account activity.</p></div>${walletScreen !== "overview" ? `<button class="secondary-button" data-action="wallet-back">Back to wallet</button>` : ""}</section>`;
  if (walletScreen === "terms") {
    return `${pageHeading}<section class="panel funds-terms-panel">${fundsTermsContent()}<button class="auth-link" data-action="wallet-back">Back to wallet</button></section>`;
  }
  if (walletScreen === "deposit" || walletScreen === "withdraw") {
    const isDeposit = walletScreen === "deposit";
    return `${pageHeading}<section class="panel wallet-form-panel">
      <div class="panel-heading"><div><h2>${isDeposit ? "Start a deposit" : "Request a withdrawal"}</h2><p>${isDeposit ? "Enter the amount to view bank or M-PESA Paybill instructions." : "Choose the amount and bank account for your payout."}</p></div></div>
      <div class="wallet-policy-strip">${isDeposit ? "Minimum $2 · Maximum $7,692" : "Minimum $5 · 7.68% fee · Up to 5 business days after approval"}</div>
      <form class="wallet-form" data-form="${isDeposit ? "wallet-deposit-request" : "wallet-withdrawal"}">
        <label>Amount (USD)<span class="wallet-rate-hint">≈ ${formatKes(1, walletRate)} per $1</span><input name="amount_usd" type="number" min="${isDeposit ? 2 : 5}" ${isDeposit ? 'max="7692"' : `max="${state.liveBalance}"`} step="0.01" required></label>
        ${isDeposit ? "" : `<div class="wallet-withdraw-preview"><span>Withdrawal fee (7.68%)</span><strong id="withdraw-fee">$0.00</strong><span>Expected payout</span><strong id="withdraw-payout">$0.00</strong><small>The requested amount is reserved from your available balance while this request is pending.</small></div>
          <label>Bank name<input name="bank_name" autocomplete="organization" maxlength="120" required></label>
          <label>Account holder name<input name="account_name" autocomplete="name" maxlength="120" required></label>
          <label>Account number<input name="account_number" inputmode="numeric" maxlength="120" required></label>
          <label>Branch (optional)<input name="branch_name" maxlength="120"></label>
          <p class="wallet-hours">Requests are available any time on weekdays and Saturday/Sunday from 9:00 AM to 1:00 PM EAT.</p>`}
        <button class="auth-primary" type="submit" ${walletBusy ? "disabled" : ""}>${walletBusy ? "Submitting…" : isDeposit ? "Show deposit instructions" : "Submit withdrawal request"}</button>
      </form>
    </section>`;
  }
  if (walletScreen === "deposit-instructions" && currentDeposit) {
    const details = currentDeposit.instructions || {};
    const hasBankTransfer = [details.bankName, details.accountName, details.accountNumber, details.instructions]
      .every((value) => String(value || "").trim());
    const hasPaybill = [details.paybillNumber, details.paybillAccountNumber, details.paybillAccountName]
      .every((value) => String(value || "").trim());
    return `${pageHeading}<section class="panel wallet-form-panel">
      <div class="wallet-success-banner"><strong>Deposit request created</strong><span>Use a payment option shown below, then submit the payment reference for confirmation.</span></div>
      <div class="deposit-bank-details">
        ${hasBankTransfer ? `<div class="wallet-payment-heading">Bank transfer</div>
        <div><span>Bank</span><strong>${escapeHtml(details.bankName)}</strong></div>
        <div><span>Account name</span><strong>${escapeHtml(details.accountName)}</strong></div>
        <div><span>Account number</span><strong>${escapeHtml(details.accountNumber)}</strong></div>
        ${details.branchName ? `<div><span>Branch</span><strong>${escapeHtml(details.branchName)}</strong></div>` : ""}
        ${details.swiftCode ? `<div><span>SWIFT/BIC</span><strong>${escapeHtml(details.swiftCode)}</strong></div>` : ""}
        <div class="deposit-instructions-copy"><span>Payment instructions</span><p>${escapeHtml(details.instructions)}</p></div>` : ""}
        ${hasPaybill ? `<div class="paybill-payment-method">
          <div class="paybill-method-heading"><strong>M-PESA Paybill</strong><span class="wallet-free-badge">FREE</span></div>
          <div class="paybill-method-details">
            <div><span>Paybill number</span><strong>${escapeHtml(details.paybillNumber)}</strong></div>
            <div><span>Account number</span><strong>${escapeHtml(details.paybillAccountNumber)}</strong></div>
            <div><span>Account name</span><strong>${escapeHtml(details.paybillAccountName)}</strong></div>
          </div>
          <p>On your phone, open M-PESA and choose <strong>Lipa na M-PESA → Pay Bill</strong>. Enter the Paybill and account numbers above, enter the requested deposit amount, and complete payment. Copy the transaction code from the M-PESA confirmation message.</p>
          <small>PIPMASTER does not charge a fee for Paybill deposits. Your provider may have separate charges.</small>
        </div>` : ""}
        <small>USD/KSh display rate at request time: $1 = ${Number(details.usdToKes || walletRate).toLocaleString("en-KE")} KSh.</small>
      </div>
      <form class="wallet-form" data-form="wallet-deposit-reference">
        <input type="hidden" name="transaction_id" value="${escapeHtml(currentDeposit.id)}">
        <label>Payment reference / M-PESA confirmation code<input name="reference_code" maxlength="120" required placeholder="Enter the bank or M-PESA confirmation code"></label>
        <p class="wallet-hours">Submit the code only after payment succeeds. It will appear in the admin review queue; your balance is credited only after the payment is verified and an admin confirms the deposit.</p>
        <button class="auth-primary" type="submit" ${walletBusy ? "disabled" : ""}>${walletBusy ? "Submitting…" : "Submit payment reference"}</button>
      </form>
    </section>`;
  }
  return `${pageHeading}
    <section class="wallet-overview">
      <div class="panel wallet-balance-panel">
        <div class="wallet-balance-top"><span>AVAILABLE WALLET BALANCE</span><span class="balance-icon">◈</span></div>
        <strong id="wallet-available">${formatMoney(state.liveBalance)}</strong>
        <small id="wallet-kes">${formatKes(state.liveBalance, walletRate)}</small>
        <span class="wallet-rate-hint">USD is the account currency · KSh conversion is approximate at $1 = ${Number(walletRate).toLocaleString("en-KE")} KSh</span>
      </div>
      <div class="wallet-actions">
        <button class="wallet-action-card deposit-action" data-action="wallet-deposit"><span class="wallet-action-icon">↓</span><strong>Deposit funds</strong><small>Bank or free Paybill · $2 to $7,692</small></button>
        <button class="wallet-action-card withdraw-action" data-action="wallet-withdraw"><span class="wallet-action-icon">↑</span><strong>Withdraw funds</strong><small>To your bank account · minimum $5</small></button>
      </div>
    </section>
    <div class="notice notice-warn wallet-fee-notice"><span>ⓘ</span><div><strong>Withdrawal fee: 7.68%</strong><p>The exact fee and expected payout are shown before you submit. Weekday requests are available 24 hours; weekend requests are available 9:00 AM–1:00 PM EAT. Processing may take up to 5 business days after approval.</p></div></div>
    <section class="panel activity-panel full-panel wallet-transactions-panel">
      <div class="panel-heading"><div><h2>Wallet transactions</h2><p>Deposits and withdrawals recorded for your account</p></div><button class="auth-link" data-action="wallet-terms">Funds terms</button></div>
      ${walletTransactionsTable(walletTransactions)}
    </section>`;
}

function walletTransactionsTable(transactions) {
  if (!transactions.length) {
    return `<div class="empty-state"><span>▣</span><strong>No wallet transactions yet</strong><p>Your completed and pending requests will appear here.</p></div>`;
  }
  const statusLabels = { awaiting_payment: "Awaiting payment", pending: "Pending review", confirmed: "Confirmed", rejected: "Rejected" };
  return `<div class="table-scroll wallet-table-scroll"><table class="wallet-table"><thead><tr><th>TYPE</th><th>AMOUNT</th><th>FEE</th><th>PAYOUT</th><th>STATUS</th><th>REFERENCE / DETAILS</th><th>DATE</th></tr></thead><tbody>${transactions.map((transaction) => `<tr>
    <td>${escapeHtml(transaction.type)}</td>
    <td>${formatMoney(transaction.amount)}<small>${formatKes(transaction.amount, walletRate)}</small></td>
    <td>${transaction.type === "withdrawal" ? formatMoney(transaction.fee) : "—"}</td>
    <td>${transaction.type === "withdrawal" ? formatMoney(transaction.payout) : formatMoney(transaction.amount)}</td>
    <td><span class="wallet-status ${escapeHtml(transaction.status)}">${escapeHtml(statusLabels[transaction.status] || transaction.status)}</span></td>
    <td>${transaction.type === "deposit"
      ? `${escapeHtml(transaction.reference || "Reference not submitted")}${transaction.status === "awaiting_payment" ? `<button class="table-action" data-action="show-deposit-instructions" data-id="${escapeHtml(transaction.id)}">View transfer details</button>` : ""}`
      : `${escapeHtml(transaction.destination?.bankName || "")} · ${escapeHtml(transaction.destination?.accountNumber || "")}`}
      ${transaction.note ? `<small>${escapeHtml(transaction.note)}</small>` : ""}
    </td>
    <td>${new Date(Number(transaction.time)).toLocaleString()}</td>
  </tr>`).join("")}</tbody></table></div>`;
}

function bindEvents() {
  app.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    render();
    if (state.activeView === "wallet") {
      refreshWalletSnapshot(true).catch((error) => showToast(`Wallet balance refresh failed: ${error.message}`));
    }
  }));
  app.querySelector('[data-action="wallet-deposit"]')?.addEventListener("click", () => { walletScreen = "deposit"; render(); });
  app.querySelector('[data-action="wallet-withdraw"]')?.addEventListener("click", () => { walletScreen = "withdraw"; render(); });
  app.querySelector('[data-action="wallet-back"]')?.addEventListener("click", () => { walletScreen = "overview"; currentDeposit = null; render(); });
  app.querySelector('[data-action="wallet-terms"]')?.addEventListener("click", () => { walletScreen = "terms"; render(); });
  app.querySelectorAll('[data-action="show-deposit-instructions"]').forEach((button) => button.addEventListener("click", () => {
    const transaction = walletTransactions.find((item) => item.id === button.dataset.id);
    if (!transaction || transaction.status !== "awaiting_payment") return;
    currentDeposit = { id: transaction.id, amount: transaction.amount, instructions: transaction.instructions };
    walletScreen = "deposit-instructions";
    render();
  }));
  app.querySelectorAll(".wallet-form").forEach((form) => form.addEventListener("submit", handleWalletForm));
  app.querySelector('[data-form="wallet-settings"]')?.addEventListener("submit", saveWalletSettings);
  app.querySelectorAll('[data-action="wallet-admin-refresh"]').forEach((button) => button.addEventListener("click", () => {
    walletAdminLoaded = false;
    loadWalletAdminData();
  }));
  app.querySelectorAll('[data-action="review-wallet"]').forEach((button) => button.addEventListener("click", reviewWalletRequest));
  app.querySelectorAll('[data-form="admin-strategy-edit"], [data-form="admin-strategy-add"]').forEach((form) => form.addEventListener("submit", saveAdminStrategy));
  app.querySelectorAll('[data-action="toggle-strategy"]').forEach((button) => button.addEventListener("click", toggleAdminStrategy));
  app.querySelector('[data-form="admin-expense"]')?.addEventListener("submit", saveAdminExpense);
  app.querySelectorAll('[data-action="expense-status"]').forEach((button) => button.addEventListener("click", updateAdminExpense));
  app.querySelector('[data-form="admin-announcement"]')?.addEventListener("submit", publishAdminAnnouncement);
  app.querySelector('[data-form="admin-user-search"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    adminUserSearch = String(new FormData(event.currentTarget).get("search") || "").trim();
    adminUserOffset = 0;
    loadAdminUsers();
  });
  app.querySelector("[data-admin-transaction-status]")?.addEventListener("change", (event) => {
    adminTransactionStatus = event.currentTarget.value;
    adminTransactionOffset = 0;
    loadAdminTransactions();
  });
  app.querySelector("[data-admin-transaction-type]")?.addEventListener("change", (event) => {
    adminTransactionType = event.currentTarget.value;
    adminTransactionOffset = 0;
    loadAdminTransactions();
  });
  app.querySelector('[data-action="transactions-prev"]')?.addEventListener("click", () => {
    adminTransactionOffset = Math.max(0, adminTransactionOffset - 50);
    loadAdminTransactions();
  });
  app.querySelector('[data-action="transactions-next"]')?.addEventListener("click", () => {
    if (adminTransactionOffset + 50 < adminTransactionTotal) adminTransactionOffset += 50;
    loadAdminTransactions();
  });
  app.querySelector('[data-action="users-prev"]')?.addEventListener("click", () => {
    adminUserOffset = Math.max(0, adminUserOffset - 50);
    loadAdminUsers();
  });
  app.querySelector('[data-action="users-next"]')?.addEventListener("click", () => {
    if (adminUserOffset + 50 < adminUserTotal) adminUserOffset += 50;
    loadAdminUsers();
  });
  app.querySelector('[data-action="notifications"]')?.addEventListener("click", async () => {
    notificationPanelOpen = !notificationPanelOpen;
    if (notificationPanelOpen) await loadNotifications();
    render();
  });
  app.querySelector('[data-action="notifications-read-all"]')?.addEventListener("click", markAllNotificationsRead);
  app.querySelectorAll("[data-notification-id]").forEach((button) => button.addEventListener("click", markNotificationRead));
  app.querySelector('.wallet-form[data-form="wallet-withdrawal"] [name="amount_usd"]')?.addEventListener("input", updateWithdrawalPreview);
  app.querySelectorAll('[data-action="admin-gate"]').forEach((button) => button.addEventListener("click", () => {
    if (auth.profile?.role === "admin") {
      state.activeView = "admin";
      auth.screen = "workspace";
    } else {
      auth.screen = "admin-login";
      auth.message = "";
    }
    render();
  }));
  app.querySelectorAll('[data-action="sign-out"]').forEach((button) => button.addEventListener("click", signOut));
  app.querySelector('[data-action="profile-reset"]')?.addEventListener("click", async () => {
    if (!supabase || !auth.user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(auth.user.email, { redirectTo: getRedirectUrl() });
    auth.message = error ? `Could not send reset email: ${error.message}` : "If the address is confirmed, a password-reset link has been sent.";
    auth.messageType = error ? "error" : "success";
    render();
  });
  app.querySelector("#avatar-file")?.addEventListener("change", (event) => uploadAvatar(event.currentTarget.files?.[0]));
  app.querySelector('[data-form="profile"]')?.addEventListener("submit", handleAuthSubmit);
  app.querySelector('[data-form="profile-email"]')?.addEventListener("submit", handleAuthSubmit);
  app.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    render();
    if (state.mode === "live") {
      refreshWalletSnapshot(true).catch((error) => showToast(`Wallet balance refresh failed: ${error.message}`));
      refreshLiveMarketSnapshot().catch((error) => showToast(`Live market update failed: ${error.message}`));
    }
  }));
  app.querySelectorAll("[data-trade-type]").forEach((button) => button.addEventListener("click", () => {
    state.tradeType = button.dataset.tradeType;
    render();
  }));
  app.querySelectorAll("[data-duration]").forEach((button) => button.addEventListener("click", () => { state.duration = Number(button.dataset.duration); render(); }));
  app.querySelectorAll("[data-bot]").forEach((button) => button.addEventListener("click", () => {
    state.selectedBot = button.dataset.bot;
    app.querySelectorAll("[data-bot]").forEach((item) => item.classList.toggle("selected", item.dataset.bot === state.selectedBot));
    const selected = strategyBots.find((bot) => bot.id === state.selectedBot || bot.name === state.selectedBot);
    showToast(`${selected?.name || state.selectedBot} strategy selected`);
  }));
  app.querySelectorAll("[data-quick-stake]").forEach((button) => button.addEventListener("click", () => setStake(Number(button.dataset.quickStake))));
  app.querySelectorAll("[data-stake]").forEach((button) => button.addEventListener("click", () => setStake(state.stake + (button.dataset.stake === "+" ? 5 : -5))));
  app.querySelector("#stake")?.addEventListener("change", (event) => setStake(Number(event.target.value)));
  app.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", () => placeTrade(button.dataset.choice)));
  app.querySelectorAll("[data-setting]").forEach((input) => input.addEventListener("input", () => updateSetting(input.dataset.setting, Number(input.value))));
  app.querySelector("#payout-input")?.addEventListener("change", (event) => updateSetting("payout", Number(event.target.value)));
  app.querySelector('[data-action="reset-demo"]')?.addEventListener("click", resetDemo);
  app.querySelector('[data-action="clear-history"]')?.addEventListener("click", clearHistory);
  app.querySelector('[data-action="scan"]')?.addEventListener("click", runScanner);
  app.querySelector('[data-action="run-bot"]')?.addEventListener("click", runBot);
  app.querySelector('[data-action="use-signal"]')?.addEventListener("click", async () => {
    if (!botSignal) return;
    const balance = state.mode === "live" ? state.liveBalance : state.demoBalance;
    if (balance < 1) {
      state.activeView = "trade";
      render();
      showToast(state.mode === "live" ? "Insufficient wallet balance. Wallet deposits start at $2.00; deposit to reach the $1.00 trade minimum." : "Insufficient demo balance. Reset your demo balance to place the signal.");
      return;
    }
    const stake = Math.min(state.stake, balance);
    if (state.mode === "live" && !window.confirm(`Confirm ${botSignal.bot} ${botSignal.choice.toUpperCase()} position with a ${formatMoney(stake)} wallet stake? You can lose the full stake.`)) return;
    state.stake = stake;
    state.tradeType = "direction";
    state.activeView = "trade";
    render();
    await placeTrade(botSignal.choice);
  });
  app.querySelectorAll("[data-timeframe]").forEach((button) => button.addEventListener("click", () => {
    app.querySelectorAll("[data-timeframe]").forEach((item) => item.classList.toggle("active", item === button));
    chartTimeframe = button.dataset.timeframe;
    chartPointer = null;
    drawChart(app.querySelector("#price-chart"));
  }));
}

async function handleWalletForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const formType = form.dataset.form;
  const submitButton = form.querySelector('button[type="submit"]');
  walletBusy = true;
  if (submitButton) submitButton.disabled = true;

  try {
    if (formType === "wallet-deposit-request") {
      const { data, error } = await supabase.rpc("request_wallet_deposit", {
        p_amount_usd: Number(values.amount_usd),
      });
      if (error) throw error;
      currentDeposit = {
        id: data.transactionId,
        amount: Number(values.amount_usd),
        instructions: data.instructions,
      };
      walletScreen = "deposit-instructions";
      let refreshError = null;
      try {
        await refreshWalletSnapshot();
      } catch (error) {
        refreshError = error;
      }
      walletBusy = false;
      render();
      showToast(refreshError
        ? `Deposit request created, but wallet refresh failed: ${refreshError.message}`
        : "Deposit request created. Use either payment option, then submit its reference.");
    } else if (formType === "wallet-deposit-reference") {
      const { error } = await supabase.rpc("submit_wallet_deposit_reference", {
        p_transaction_id: String(values.transaction_id),
        p_reference_code: String(values.reference_code).trim(),
      });
      if (error) throw error;
      walletScreen = "overview";
      currentDeposit = null;
      let refreshError = null;
      try {
        await refreshWalletSnapshot();
      } catch (error) {
        refreshError = error;
      }
      walletBusy = false;
      render();
      showToast(refreshError
        ? `Payment reference submitted, but wallet refresh failed: ${refreshError.message}`
        : "Payment reference submitted for verification.");
    } else if (formType === "wallet-withdrawal") {
      const { error } = await supabase.rpc("request_wallet_withdrawal", {
        p_amount_usd: Number(values.amount_usd),
        p_bank_name: String(values.bank_name).trim(),
        p_account_name: String(values.account_name).trim(),
        p_account_number: String(values.account_number).trim(),
        p_branch_name: String(values.branch_name || "").trim(),
      });
      if (error) throw error;
      walletScreen = "overview";
      let refreshError = null;
      try {
        await refreshWalletSnapshot();
      } catch (error) {
        refreshError = error;
      }
      walletBusy = false;
      render();
      showToast(refreshError
        ? `Withdrawal request received, but wallet refresh failed: ${refreshError.message}`
        : "Withdrawal request received. Its amount is reserved while it is processed.");
    }
  } catch (error) {
    showToast(`Wallet request failed: ${error.message}`);
  } finally {
    walletBusy = false;
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
}

function updateWithdrawalPreview(event) {
  const amount = Number(event.currentTarget.value);
  const fee = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 0.0768 * 100) / 100 : 0;
  const payout = Number.isFinite(amount) && amount > 0 ? Math.max(0, amount - fee) : 0;
  const feeElement = app.querySelector("#withdraw-fee");
  const payoutElement = app.querySelector("#withdraw-payout");
  if (feeElement) feeElement.textContent = formatMoney(fee);
  if (payoutElement) payoutElement.textContent = formatMoney(payout);
}

async function saveWalletSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const submitButton = form.querySelector('button[type="submit"]');
  walletBusy = true;
  if (submitButton) submitButton.disabled = true;
  try {
    const { error } = await supabase.rpc("update_wallet_settings_with_paybill", {
      p_bank_name: String(values.bank_name).trim(),
      p_account_name: String(values.account_name).trim(),
      p_account_number: String(values.account_number).trim(),
      p_branch_name: String(values.branch_name || "").trim(),
      p_swift_code: String(values.swift_code || "").trim(),
      p_deposit_instructions: String(values.deposit_instructions).trim(),
      p_usd_to_kes: Number(values.usd_to_kes),
      p_paybill_number: String(values.paybill_number).trim(),
      p_paybill_account_number: String(values.paybill_account_number).trim(),
      p_paybill_account_name: String(values.paybill_account_name).trim(),
    });
    if (error) throw error;
    walletAdminLoaded = false;
    walletBusy = false;
    await loadWalletAdminData();
    showToast("Wallet payment settings saved.");
  } catch (error) {
    showToast(`Could not save wallet settings: ${error.message}`);
  } finally {
    walletBusy = false;
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
}

function botIdFromName(name) {
  const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug.length >= 2 ? slug : `${slug || "new"}-bot`;
}

async function saveAdminStrategy(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const isNew = form.dataset.form === "admin-strategy-add";
  const id = isNew ? botIdFromName(values.name) : form.dataset.id;
  if (isNew && (adminOverviewData?.strategies || []).some((bot) => bot.id === id || bot.name.toLowerCase() === String(values.name).trim().toLowerCase())) {
    showToast("A bot with that name already exists. Choose a different name.");
    return;
  }
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const { error } = await supabase.rpc("save_admin_strategy", {
      p_id: id,
      p_name: String(values.name).trim(),
      p_algorithm_key: values.algorithm_key,
      p_strategy_type: String(values.strategy_type).trim(),
      p_description: String(values.description).trim(),
      p_tier: String(values.tier).trim(),
      p_icon: String(values.icon).trim(),
      p_color: values.color,
      p_price_usd: Number(values.price_usd),
    });
    if (error) throw error;
    await loadStrategyCatalog();
    walletAdminLoaded = false;
    await loadWalletAdminData();
    showToast(isNew ? "Bot added to the catalog." : "Bot details and price saved.");
  } catch (error) {
    showToast(`Could not save bot: ${error.message}`);
  } finally {
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
}

async function toggleAdminStrategy(event) {
  const button = event.currentTarget;
  const active = button.dataset.active !== "true";
  if (!active && !window.confirm("Remove this bot from the user catalog? Existing purchases and records will be retained. You can restore it later.")) return;
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("set_admin_strategy_active", {
      p_id: button.dataset.id,
      p_active: active,
    });
    if (error) throw error;
    await loadStrategyCatalog();
    walletAdminLoaded = false;
    await loadWalletAdminData();
    showToast(active ? "Bot restored to the user catalog." : "Bot removed from the user catalog. Purchase records were retained.");
  } catch (error) {
    showToast(`Could not update bot availability: ${error.message}`);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function saveAdminExpense(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const { error } = await supabase.rpc("add_admin_expense", {
      p_category: String(values.category).trim(),
      p_description: String(values.description || "").trim(),
      p_amount_usd: Number(values.amount_usd),
      p_expense_date: values.expense_date,
      p_status: values.status,
    });
    if (error) throw error;
    walletAdminLoaded = false;
    await loadWalletAdminData();
    showToast("Expense recorded.");
  } catch (error) {
    showToast(`Could not record expense: ${error.message}`);
  } finally {
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
}

async function updateAdminExpense(event) {
  const button = event.currentTarget;
  const status = button.dataset.status;
  if (status === "void" && !window.confirm("Void this expense record? It will remain stored but will no longer affect the estimate.")) return;
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("set_admin_expense_status", {
      p_expense_id: button.dataset.id,
      p_status: status,
    });
    if (error) throw error;
    walletAdminLoaded = false;
    await loadWalletAdminData();
    showToast(status === "void" ? "Expense voided; the record remains in history." : `Expense marked ${status}.`);
  } catch (error) {
    showToast(`Could not update expense: ${error.message}`);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function publishAdminAnnouncement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  if (!window.confirm("Publish this announcement to every registered user?")) return;
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const { data, error } = await supabase.rpc("publish_admin_announcement", {
      p_title: String(values.title).trim(),
      p_message: String(values.message).trim(),
    });
    if (error) throw error;
    form.reset();
    showToast(`Announcement sent to ${Number(data || 0).toLocaleString()} accounts.`);
  } catch (error) {
    showToast(`Could not publish announcement: ${error.message}`);
  } finally {
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
}

function notificationPanel() {
  const items = notificationData.items || [];
  return `<section class="notification-popover" aria-label="Notifications">
    <div class="notification-panel-heading"><div><strong>Notifications</strong><small>${Number(notificationData.unreadCount || 0)} unread</small></div><button class="text-button" type="button" data-action="notifications-read-all" ${notificationData.unreadCount ? "" : "disabled"}>Mark all read</button></div>
    ${notificationError ? `<div class="notice notice-warn"><span>ⓘ</span><div><strong>Notifications unavailable</strong><p>${escapeHtml(notificationError)}</p></div></div>` : ""}
    ${items.length ? `<div class="notification-list">${items.map((item) => `<button type="button" class="notification-item ${item.readAt ? "" : "unread"}" data-notification-id="${escapeHtml(item.id)}" data-notification-type="${escapeHtml(item.type)}"><span class="notification-dot"></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.message)}</small><time>${new Date(Number(item.time)).toLocaleString()}</time></span></button>`).join("")}</div>` : `<div class="empty-state"><strong>You're all caught up</strong><p>Account, wallet, and trade updates will appear here.</p></div>`}
  </section>`;
}

async function loadNotifications() {
  if (!auth.user || notificationLoading) return;
  notificationLoading = true;
  notificationLastAttemptAt = Date.now();
  try {
    const { data, error } = await supabase.rpc("get_notifications_snapshot");
    if (error) throw error;
    const previous = JSON.stringify(notificationData);
    notificationData = {
      unreadCount: Number(data?.unreadCount || 0),
      items: Array.isArray(data?.items) ? data.items : [],
    };
    notificationError = "";
    syncNotificationBadge();
    if (notificationPanelOpen && previous !== JSON.stringify(notificationData) && document.querySelector(".notification-popover")) render();
  } catch (error) {
    notificationError = error.message || "Could not load notifications.";
    syncNotificationBadge();
  } finally {
    notificationLoading = false;
  }
}

function syncNotificationBadge() {
  const badge = app.querySelector(".notification-count");
  if (!badge) return;
  badge.textContent = notificationData.unreadCount > 99 ? "99+" : notificationData.unreadCount ? String(notificationData.unreadCount) : "";
  badge.classList.toggle("visible", notificationData.unreadCount > 0);
}

async function markNotificationRead(event) {
  const button = event.currentTarget;
  const type = button.dataset.notificationType;
  try {
    const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: button.dataset.notificationId });
    if (error) throw error;
    if (type === "admin-wallet" && auth.profile?.role === "admin") state.activeView = "admin";
    else if (type === "wallet") {
      state.activeView = "wallet";
      walletScreen = "overview";
    } else if (type === "wallet-trade" || type === "demo-trade") state.activeView = "history";
    await loadNotifications();
    render();
  } catch (error) {
    showToast(`Could not mark notification read: ${error.message}`);
  }
}

async function markAllNotificationsRead() {
  try {
    const { error } = await supabase.rpc("mark_all_notifications_read");
    if (error) throw error;
    await loadNotifications();
    render();
  } catch (error) {
    showToast(`Could not mark notifications read: ${error.message}`);
  }
}

async function reviewWalletRequest(event) {
  const button = event.currentTarget;
  const approve = button.dataset.approve === "true";
  const request = (walletAdminData?.requests || []).find((item) => item.id === button.dataset.id)
    || adminTransactionRows.find((item) => item.id === button.dataset.id);
  if (!request) {
    showToast("This wallet request is no longer available. Refresh the request list.");
    return;
  }
  if (request.status && request.status !== "pending") {
    showToast("This request is no longer pending. Refresh the dashboard.");
    return;
  }
  const action = approve
    ? request.type === "deposit" ? "confirm this deposit after verifying the bank or Paybill payment" : "confirm this withdrawal after sending the bank payout"
    : "reject this wallet request";
  if (!window.confirm(`Are you sure you want to ${action}?`)) return;
  button.disabled = true;

  const note = Array.from(app.querySelectorAll("[data-wallet-review-note]"))
    .find((field) => field.dataset.walletReviewNote === button.dataset.id)?.value || "";
  try {
    const { error } = await supabase.rpc("review_wallet_transaction", {
      p_transaction_id: button.dataset.id,
      p_approve: approve,
      p_review_note: note,
    });
    if (error) throw error;
  } catch (error) {
    if (button.isConnected) button.disabled = false;
    showToast(`Could not review wallet request: ${error.message}`);
    return;
  }
  let refreshError = null;
  if (request.userId === auth.user?.id) {
    try {
      await refreshWalletSnapshot();
    } catch (error) {
      refreshError = error;
    }
  }
  walletAdminLoaded = false;
  await loadWalletAdminData();
  if (request.type === "deposit" && approve) {
    showToast(refreshError
      ? `Deposit completed and the user's wallet was credited. Admin wallet refresh failed: ${refreshError.message}`
      : "Deposit completed successfully. The user's wallet was credited and they were notified.");
  } else {
    showToast(approve ? "Wallet request confirmed." : "Wallet request rejected.");
  }
}

function setStake(value) {
  const balance = state.mode === "demo" ? state.demoBalance : state.liveBalance;
  state.stake = Math.round(clamp(Number(value) || 1, 1, Math.max(1, balance)) * 100) / 100;
  const input = app.querySelector("#stake");
  if (input) input.value = state.stake;
  const returnEl = app.querySelector("#potential-return");
  if (returnEl) returnEl.textContent = formatMoney(state.stake * (1 + state.payout / 100));
}

function updateSetting(key, value) {
  if (!Number.isFinite(value)) return;
  if (auth.profile?.role !== "admin") {
    showToast("Administrator access is required to change shared market settings.");
    return;
  }
  const bounds = { volatility: [0.1, 1], drift: [-0.5, 0.5], chartSpeed: [0.5, 2], payout: [1, 95] }[key];
  if (!bounds) return;
  state[key] = clamp(value, bounds[0], bounds[1]);
  pendingLocalSettings = true;
  if (key === "volatility") app.querySelector("#volatility-value").textContent = `${Math.round(state.volatility * 100)}%`;
  if (key === "drift") app.querySelector("#drift-value").textContent = `${state.drift > 0 ? "+" : ""}${Math.round(state.drift * 100)}%`;
  if (key === "chartSpeed") {
    app.querySelector("#chartSpeed-value").textContent = `${state.chartSpeed.toFixed(1)}×`;
    startChart();
  }
  if (key === "payout") {
    const range = app.querySelector('[data-setting="payout"]');
    const numeric = app.querySelector("#payout-input");
    if (range) range.value = state.payout;
    if (numeric) numeric.value = state.payout;
    const potential = app.querySelector("#potential-return");
    if (potential) potential.textContent = formatMoney(state.stake * (1 + state.payout / 100));
  }
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = window.setTimeout(async () => {
    const { error } = await supabase.rpc("update_market_settings", {
      p_volatility: state.volatility,
      p_drift: state.drift,
      p_chart_speed: state.chartSpeed,
      p_payout: state.payout,
    });
    if (error) {
      pendingLocalSettings = false;
      showToast(`Could not update shared market settings: ${error.message}`);
      refreshTerminalSnapshot().catch((refreshError) => showToast(`Could not reload shared settings: ${refreshError.message}`));
      return;
    }
    pendingLocalSettings = false;
    showToast("Shared market settings updated for all users.");
  }, 300);
}

async function resetDemo() {
  const { error } = await supabase.rpc("reset_demo_account");
  if (error) {
    showToast(`Could not reset remote demo account: ${error.message}`);
    return;
  }
  state.stake = 25;
  try {
    await refreshTerminalSnapshot();
    render();
    showToast("Remote demo account reset to $10,000.");
  } catch (refreshError) {
    showToast(`Demo account reset, but refresh failed: ${refreshError.message}`);
  }
}

async function placeTrade(choice) {
  const isLive = state.mode === "live";
  const balance = isLive ? state.liveBalance : state.demoBalance;
  const stake = Number(app.querySelector("#stake")?.value);
  if (!Number.isFinite(stake) || stake < 1 || stake > balance) {
    showToast(`Enter a valid stake of at least $1.00 within your ${isLive ? "wallet" : "demo"} balance.`);
    return;
  }
  const { error } = await supabase.rpc(isLive ? "place_wallet_trade" : "place_demo_trade", {
    p_choice: choice,
    p_stake: stake,
    p_duration_seconds: state.duration,
  });
  if (error) {
    showToast(`Could not place ${isLive ? "wallet" : "demo"} position: ${error.message}`);
    return;
  }
  try {
    if (isLive) await refreshWalletSnapshot();
    else await refreshTerminalSnapshot();
    render();
    showToast(`${isLive ? "Wallet-funded" : "Demo"} ${choice.toUpperCase()} position opened · ${state.duration}s`);
  } catch (refreshError) {
    render();
    showToast(`Position opened, but refresh failed: ${refreshError.message}`);
  }
}

async function clearHistory() {
  const { error } = await supabase.rpc("clear_demo_history");
  if (error) {
    showToast(`Could not clear remote trade history: ${error.message}`);
    return;
  }
  try {
    await refreshTerminalSnapshot();
    render();
  } catch (refreshError) {
    showToast(`History cleared, but refresh failed: ${refreshError.message}`);
  }
}

async function runScanner() {
  const { data, error } = await supabase.rpc("analyze_scanner_market");
  if (error) {
    showToast(`Could not run AI Market Scanner: ${error.message}`);
    return;
  }
  const result = app.querySelector("#scanner-result");
  if (result) result.innerHTML = `<div class="scan-meter"><div class="meter-ring">${Number(data.strength)}<small>%</small></div></div><div><span class="eyebrow">INDICATOR SIGNAL · NOT WIN ODDS</span><strong>${escapeHtml(data.direction)}</strong></div>`;
}

async function runBot() {
  const bot = strategyBots.find((item) => item.id === state.selectedBot || item.name === state.selectedBot);
  if (!bot) {
    showToast("Select an available bot first.");
    return;
  }
  if (!bot.owned) {
    if (!window.confirm(`Unlock ${bot.name} for ${formatMoney(bot.price)} from your wallet? This is a one-time purchase.`)) return;
    const { error: purchaseError } = await supabase.rpc("purchase_strategy", { p_strategy_id: bot.id });
    if (purchaseError) {
      showToast(`Could not unlock ${bot.name}: ${purchaseError.message}`);
      return;
    }
    try {
      await Promise.all([loadStrategyCatalog(), refreshWalletSnapshot()]);
      render();
      showToast(`${bot.name} unlocked for ${formatMoney(bot.price)}.`);
    } catch (error) {
      showToast(`${bot.name} was unlocked, but account refresh failed: ${error.message}`);
      return;
    }
  }
  const { data, error } = await supabase.rpc("analyze_bot_market", { p_strategy_id: bot.id });
  if (error) {
    showToast(`Could not generate remote strategy signal: ${error.message}`);
    return;
  }
  if (!data.signal) {
    botSignal = null;
    render();
    showToast(`${state.selectedBot}: no clear indicator signal right now.`);
    return;
  }
  botSignal = {
    bot: bot.name,
    choice: data.signal,
    strength: `${Number(data.strength)}%`,
  };
  render();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function startChart() {
  clearTimeout(chartTimer);
  const pollVersion = ++chartPollVersion;
  const poll = async () => {
    try {
      await refreshTerminalSnapshot(true);
    } catch (error) {
      showToast(`Remote market update failed: ${error.message}`);
    }
    if (state.mode === "live") {
      try {
        await refreshLiveMarketSnapshot();
      } catch (error) {
        showToast(`Live market update failed: ${error.message}`);
      }
    }
    const walletRefreshInterval = state.mode === "live"
      && walletTrades.some((trade) => trade.status === "open")
      ? 1000
      : 10000;
    if (Date.now() - walletLastAttemptAt >= walletRefreshInterval) {
      walletLastAttemptAt = Date.now();
      try {
        await refreshWalletSnapshot(true);
      } catch (error) {
        showToast(`Wallet balance refresh failed: ${error.message}`);
      }
    }
    if (state.activeView === "admin"
      && auth.profile?.role === "admin"
      && !walletAdminLoading
      && Date.now() - walletAdminLastAttemptAt >= 10000) {
      walletAdminLoaded = false;
      await loadWalletAdminData();
    }
    if (Date.now() - notificationLastAttemptAt >= 15000) await loadNotifications();
    if (pollVersion === chartPollVersion) {
      chartTimer = window.setTimeout(poll, Math.max(250, Math.min(2000, 900 / state.chartSpeed)));
    }
  };
  chartTimer = window.setTimeout(poll, Math.max(250, Math.min(2000, 900 / state.chartSpeed)));
}

function tickTimestamp(tick) {
  const value = tick.time ?? tick.timestamp ?? tick.created_at ?? tick.createdAt;
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bindChartInteractions(canvas) {
  if (!canvas) return;
  chartPointer = null;
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    chartPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    drawChart(canvas);
  });
  canvas.addEventListener("pointerleave", () => {
    chartPointer = null;
    drawChart(canvas);
  });
}

function chartCandles(points) {
  const intervals = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000 };
  const fallbackGroupSizes = { "1m": 5, "5m": 10, "15m": 15, "1h": 30 };
  const interval = intervals[chartTimeframe] || intervals["1m"];
  const candleFromPoints = (items, time) => ({
    time,
    open: items[0].y,
    high: Math.max(...items.map((point) => point.y)),
    low: Math.min(...items.map((point) => point.y)),
    close: items[items.length - 1].y,
  });
  const hasTimestamps = points.some((point) => Number.isFinite(point.time));

  if (!hasTimestamps) {
    const groupSize = fallbackGroupSizes[chartTimeframe] || fallbackGroupSizes["1m"];
    const groups = [];
    for (let index = 0; index < points.length; index += groupSize) {
      groups.push(points.slice(index, index + groupSize));
    }
    const now = Date.now();
    return groups.map((group, index) => candleFromPoints(
      group,
      now - (groups.length - index - 1) * interval,
    ));
  }

  const groups = new Map();
  points.forEach((point, index) => {
    const time = Number.isFinite(point.time)
      ? point.time
      : Date.now() - (points.length - index - 1) * 1000;
    const bucket = Math.floor(time / interval) * interval;
    const group = groups.get(bucket) || [];
    group.push(point);
    groups.set(bucket, group);
  });
  return [...groups.entries()]
    .sort(([first], [second]) => first - second)
    .map(([time, group]) => candleFromPoints(group, time));
}

function drawChart(canvas) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  const isLive = state.mode === "live";
  const points = isLive ? liveChartPoints : chartPoints;
  const currentPrice = isLive ? livePrice : price;
  const candles = chartCandles(points);
  if (!candles.length) {
    candles.push({ time: Date.now(), open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice });
  }
  const visibleCandles = candles.slice(-100);
  const left = 12;
  const right = width - 68;
  const top = 14;
  const bottom = height - 28;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const values = visibleCandles.flatMap((candle) => [candle.high, candle.low]);
  values.push(currentPrice);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.12, Math.abs(currentPrice) * 0.00015, 0.01);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const range = max - min;
  const yForPrice = (value) => bottom - ((value - min) / range) * plotHeight;
  const step = plotWidth / visibleCandles.length;
  const candleWidth = Math.min(13, Math.max(3, step * 0.64));

  ctx.fillStyle = "#0e151f";
  ctx.fillRect(0, 0, width, height);
  ctx.font = "10px DM Sans, sans-serif";
  ctx.textBaseline = "middle";
  for (let index = 0; index <= 5; index++) {
    const y = top + (plotHeight * index) / 5;
    const value = max - (range * index) / 5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.strokeStyle = "rgba(151,168,190,.13)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#8b98a9";
    ctx.textAlign = "right";
    ctx.fillText(value.toFixed(2), width - 8, y);
  }

  for (let index = 0; index <= 6; index++) {
    const x = left + (plotWidth * index) / 6;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle = "rgba(151,168,190,.09)";
    ctx.stroke();
    if (index <= 6) {
      const candleIndex = Math.min(visibleCandles.length - 1, Math.round((visibleCandles.length - 1) * index / 6));
      const date = new Date(visibleCandles[candleIndex].time);
      ctx.fillStyle = "#8b98a9";
      ctx.textAlign = index === 0 ? "left" : index === 6 ? "right" : "center";
      ctx.fillText(date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), x, height - 13);
    }
  }

  visibleCandles.forEach((candle, index) => {
    const x = left + step * index + step / 2;
    const color = candle.close >= candle.open ? "#26a69a" : "#ef5350";
    const openY = yForPrice(candle.open);
    const closeY = yForPrice(candle.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
    ctx.beginPath();
    ctx.moveTo(x, yForPrice(candle.high));
    ctx.lineTo(x, yForPrice(candle.low));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  });

  const latest = visibleCandles[visibleCandles.length - 1];
  const currentY = yForPrice(currentPrice);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(left, currentY);
  ctx.lineTo(right, currentY);
  ctx.strokeStyle = isLive ? "rgba(82,161,255,.75)" : "rgba(65,213,164,.75)";
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = isLive ? "#3886d8" : "#239b78";
  ctx.fillRect(right + 1, currentY - 9, width - right - 1, 18);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(currentPrice.toFixed(2), right + (width - right) / 2, currentY);

  ctx.strokeStyle = "rgba(151,168,190,.2)";
  ctx.beginPath();
  ctx.moveTo(right, top);
  ctx.lineTo(right, height);
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  let hovered = null;
  if (chartPointer
    && chartPointer.x >= left && chartPointer.x <= right
    && chartPointer.y >= top && chartPointer.y <= bottom) {
    const index = Math.min(visibleCandles.length - 1, Math.floor((chartPointer.x - left) / step));
    hovered = visibleCandles[index];
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(210,220,232,.55)";
    ctx.beginPath();
    ctx.moveTo(chartPointer.x, top);
    ctx.lineTo(chartPointer.x, bottom);
    ctx.moveTo(left, chartPointer.y);
    ctx.lineTo(right, chartPointer.y);
    ctx.stroke();
    ctx.restore();

    const pointerPrice = max - ((chartPointer.y - top) / plotHeight) * range;
    ctx.fillStyle = "#384454";
    ctx.fillRect(right + 1, chartPointer.y - 9, width - right - 1, 18);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(pointerPrice.toFixed(2), right + (width - right) / 2, chartPointer.y);
    const timeLabel = new Date(hovered.time).toLocaleString([], {
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const labelWidth = Math.min(142, ctx.measureText(timeLabel).width + 16);
    const labelX = Math.max(left, Math.min(chartPointer.x - labelWidth / 2, right - labelWidth));
    ctx.fillStyle = "#263241";
    ctx.fillRect(labelX, bottom + 1, labelWidth, height - bottom - 1);
    ctx.fillStyle = "#dce4ee";
    ctx.textAlign = "center";
    ctx.fillText(timeLabel, labelX + labelWidth / 2, bottom + (height - bottom) / 2);
  }

  ctx.fillStyle = "#aab6c5";
  ctx.textAlign = "left";
  ctx.font = "10px DM Sans, sans-serif";
  ctx.fillText(
    `O ${latest.open.toFixed(2)}   H ${latest.high.toFixed(2)}   L ${latest.low.toFixed(2)}   C ${latest.close.toFixed(2)}`,
    left,
    7,
  );
  const readout = hovered || latest;
  const readoutValues = {
    "#chart-open": readout.open,
    "#chart-high": readout.high,
    "#chart-low": readout.low,
    "#chart-close": readout.close,
  };
  Object.entries(readoutValues).forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value.toFixed(2);
  });
  const clock = document.querySelector("#chart-clock");
  if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

window.addEventListener("resize", () => {
  const canvas = document.querySelector("#price-chart");
  if (canvas) drawChart(canvas);
});

beginAuth();
