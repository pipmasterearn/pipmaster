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
let chartTimeframe = "5s";
let chartDisplay = "candles";
let chartPointer = null;
let chartTool = "crosshair";
let chartZoom = 1;
let chartOffset = 0;
let chartDrag = null;
let chartDrawingDraft = null;
let chartDrawings = [];
let chartRenderState = null;
let chartSettings = { showGrid: true, showCurrentPrice: true };
let chartIndicators = { sma: false, ema: false, rsi: false, divergence: false };
let chartIndicatorAlertEnabled = false;
let chartIndicatorAlertKey = "";
let chartPriceAlert = null;
let marketFavorited = false;
let marketStatus = { isOpen: false, notice: "Checking market status" };
let marketStatusLoaded = false;
let marketStatusLastAttemptAt = 0;
let pendingTradeReview = null;
let chartTimer;
let toastTimer;
let botSignal = null;
let botSession = { status: "stopped", startedAt: null, signals: [] };
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
          ${navItem("bots", "◈", "Strategies", '<span class="nav-tag">SIGNALS</span>')}
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
          <div class="breadcrumb"><span>Workspace</span><b>/</b><strong>${isAdmin ? "Admin controls" : isHistory ? "Activity" : state.activeView === "bots" ? "Strategies & signals" : "Trading terminal"}</strong></div>
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
          ${navItem("bots", "◈", "Strategies")}
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

  const previousPriceValue = price;
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
  if (state.mode === "demo") checkChartPriceAlert(previousPriceValue, price);

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

  const previousPriceValue = livePrice;
  livePrice = Number(data.price);
  liveChartPoints = (Array.isArray(data.ticks) ? data.ticks : [])
    .map((tick, index) => ({ x: index, y: Number(tick.price), time: tickTimestamp(tick) }))
    .filter((point) => Number.isFinite(point.y));
  if (state.mode === "live") checkChartPriceAlert(previousPriceValue, livePrice);

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

async function loadMarketFavorite() {
  const { data, error } = await supabase
    .from("market_watchlist")
    .select("market_symbol")
    .eq("market_symbol", "PIPMASTER")
    .maybeSingle();
  if (error) throw error;
  marketFavorited = Boolean(data);
  syncMarketFavoriteButton();
}

async function toggleMarketFavorite(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (marketFavorited) {
      const { error } = await supabase
        .from("market_watchlist")
        .delete()
        .eq("market_symbol", "PIPMASTER");
      if (error) throw error;
      marketFavorited = false;
      showToast("PIPMASTER market removed from your watchlist.");
    } else {
      const { error } = await supabase
        .from("market_watchlist")
        .insert({ user_id: auth.user.id, market_symbol: "PIPMASTER" });
      if (error) throw error;
      marketFavorited = true;
      showToast("PIPMASTER market saved to your watchlist.");
    }
    syncMarketFavoriteButton();
  } catch (error) {
    showToast(`Could not update your watchlist: ${error.message}`);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function syncMarketFavoriteButton() {
  const button = app.querySelector('[data-action="toggle-market-favorite"]');
  if (!button) return;
  button.classList.toggle("saved", marketFavorited);
  button.setAttribute("aria-pressed", String(marketFavorited));
  const label = marketFavorited
    ? "Remove PIPMASTER market from watchlist"
    : "Add PIPMASTER market to watchlist";
  button.setAttribute("aria-label", label);
  button.title = marketFavorited ? "Remove from watchlist" : "Add to watchlist";
}

async function loadMarketStatus() {
  const { data, error } = await supabase.rpc("get_market_status");
  if (error) throw error;
  if (typeof data?.isOpen !== "boolean") {
    throw new Error("The market status response was invalid.");
  }
  const nextStatus = {
    isOpen: data.isOpen,
    notice: String(data.notice || "").trim(),
  };
  const changed = !marketStatusLoaded
    || nextStatus.isOpen !== marketStatus.isOpen
    || nextStatus.notice !== marketStatus.notice;
  marketStatus = nextStatus;
  marketStatusLoaded = true;
  marketStatusLastAttemptAt = Date.now();
  return changed;
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
        loadMarketStatus(),
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
      loadMarketFavorite().catch((error) => showToast(`Could not load market watchlist: ${error.message}`));
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
        marketFavorited = false;
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
  marketStatusLoaded = false;
  marketStatusLastAttemptAt = 0;
  pendingTradeReview = null;
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
          <div class="asset-title"><div class="asset-icon">P</div><div><strong>${isLive ? "PIPMASTER Live Market" : "PIPMASTER Demo Market"}</strong><small>${isLive ? "Live wallet market" : "Demo funds market"}</small></div><span class="live-pill"><i></i> ${isLive ? "LIVE MARKET" : "DEMO MARKET"}</span><span class="market-status-chip ${marketStatusLoaded && marketStatus.isOpen ? "open" : "suspended"}">${marketStatusLoaded ? (marketStatus.isOpen ? "OPEN" : "SUSPENDED") : "STATUS UNAVAILABLE"}</span><button class="market-favorite ${marketFavorited ? "saved" : ""}" type="button" data-action="toggle-market-favorite" aria-label="${marketFavorited ? "Remove PIPMASTER market from watchlist" : "Add PIPMASTER market to watchlist"}" aria-pressed="${marketFavorited}" title="${marketFavorited ? "Remove from watchlist" : "Add to watchlist"}">★</button></div>
          <div class="price-summary"><div class="price-value"><strong id="current-price">${activePrice.toFixed(2)}</strong><small>USD</small></div><span class="${priceChange >= 0 ? "positive" : "negative"}" id="price-change">${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%</span></div>
        </div>
        <div class="chart-toolbar">
          <div class="chart-tabs"><button class="active">Chart</button><button data-view="history">${isLive ? "Live positions" : "Positions"} <span class="count">${activeTrades.filter((trade) => trade.status === "open").length}</span></button></div>
          <div class="timeframes" role="group" aria-label="Chart timeframe"><span class="chart-type-label">Interval</span>${["tick", "5s", "15s", "30s", "1m", "5m", "15m", "1h"].map((item) => `<button class="${item === chartTimeframe ? "active" : ""}" data-timeframe="${item}">${item}</button>`).join("")}</div>
        </div>
        <div class="chart-actions">
          <div class="chart-control-group" role="group" aria-label="Chart display">
            <button type="button" class="${chartDisplay === "candles" ? "active" : ""}" data-chart-display="candles">Candles</button>
            <button type="button" class="${chartDisplay === "line" ? "active" : ""}" data-chart-display="line">Line</button>
          </div>
          <div class="chart-control-group" role="group" aria-label="Chart tools">
            <button type="button" class="${chartTool === "crosshair" ? "active" : ""}" data-chart-tool="crosshair" title="Crosshair">Crosshair</button>
            <button type="button" class="${chartTool === "measure" ? "active" : ""}" data-chart-tool="measure" title="Measure price and time">Measure</button>
            <button type="button" class="${chartTool === "pan" ? "active" : ""}" data-chart-tool="pan" title="Drag to pan">Pan</button>
            <button type="button" class="${chartTool === "trendline" ? "active" : ""}" data-chart-tool="trendline" title="Draw a trendline">Trendline</button>
            <button type="button" class="${chartTool === "fibonacci" ? "active" : ""}" data-chart-tool="fibonacci" title="Draw Fibonacci retracement levels">Fib</button>
            <button type="button" class="${chartTool === "annotation" ? "active" : ""}" data-chart-tool="annotation" title="Add a chart annotation">Note</button>
            <button type="button" data-chart-action="clear-drawings" title="Clear drawings and annotations">Clear drawings</button>
          </div>
          <div class="chart-control-group chart-shortcuts" role="group" aria-label="Chart actions">
            <button type="button" data-chart-action="zoom-out" title="Zoom out">−</button>
            <button type="button" data-chart-action="zoom-in" title="Zoom in">+</button>
            <button type="button" data-chart-action="reset" title="Reset zoom and pan">Reset</button>
            <button type="button" data-chart-action="fullscreen" title="Fullscreen">Fullscreen</button>
            <button type="button" data-chart-action="snapshot" title="Save chart snapshot">Export</button>
          </div>
          <div class="chart-control-group" role="group" aria-label="Indicators and chart settings">
            <button type="button" class="${chartIndicators.sma ? "active" : ""}" data-chart-indicator="sma">SMA 10</button>
            <button type="button" class="${chartIndicators.ema ? "active" : ""}" data-chart-indicator="ema">EMA 20</button>
            <button type="button" class="${chartIndicators.rsi ? "active" : ""}" data-chart-indicator="rsi">RSI 14</button>
            <button type="button" class="${chartIndicators.divergence ? "active" : ""}" data-chart-indicator="divergence">Divergence</button>
            <button type="button" class="${chartIndicatorAlertEnabled ? "active" : ""}" data-chart-action="toggle-indicator-alert">SMA/EMA alert</button>
            <button type="button" class="${chartSettings.showGrid ? "active" : ""}" data-chart-action="toggle-grid">Grid</button>
            <button type="button" class="${chartSettings.showCurrentPrice ? "active" : ""}" data-chart-action="toggle-price-line">Price line</button>
            <button type="button" data-chart-action="price-alert">Price alert</button>
            <button type="button" disabled title="Volume data is not provided by the current price feed">Volume unavailable</button>
            <button type="button" disabled title="Market depth data is not provided">Depth unavailable</button>
          </div>
        </div>
        <div class="chart-wrap"><canvas id="price-chart" role="img" aria-label="${isLive ? "Live" : "Demo"} PIPMASTER ${chartDisplay === "line" ? "line" : "candlestick"} chart with price and time scales"></canvas></div>
        <div class="chart-legend"><span><b>O</b><strong id="chart-open">—</strong><b>H</b><strong id="chart-high">—</strong><b>L</b><strong id="chart-low">—</strong><b>C</b><strong id="chart-close">—</strong></span><span class="chart-source">PIPMASTER market · <span id="chart-clock">--:--:--</span></span></div>
      </section>

      <section class="panel trade-panel">${tradePanelView(active)}</section>
    </div>
    <dialog class="trade-review-dialog" id="trade-review"></dialog>

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
  const canPlaceTrade = marketStatusLoaded && marketStatus.isOpen;
  const marketNotice = !marketStatusLoaded
    ? "Market status could not be verified. New positions are unavailable until status loads."
    : marketStatus.isOpen
      ? ""
      : marketStatus.notice || "New positions are suspended by the administrator.";
  const marketNoticeView = `<div class="market-notice ${canPlaceTrade ? "market-open" : "market-suspended"}" role="status"><strong>${canPlaceTrade ? "Market open" : marketStatusLoaded ? "Market suspended" : "Market status unavailable"}</strong>${marketNotice ? `<span>${escapeHtml(marketNotice)}</span>` : ""}</div>`;
  if (availableBalance < 1) {
    const minimumTopUp = Math.max(2, Math.ceil((1 - availableBalance) * 100) / 100);
    return `${marketNoticeView}<div class="wallet-live-message">
      <span class="balance-icon">◈</span>
      <h2>Insufficient ${isLive ? "wallet" : "demo"} balance</h2>
      <p>The minimum trade is $1.00. Your available ${isLive ? "wallet" : "demo"} balance is ${formatMoney(availableBalance)}.${isLive ? ` Deposit at least ${formatMoney(minimumTopUp)} (wallet deposits start at $2.00) to unlock live trading controls.` : " Reset your demo balance to continue."}</p>
      ${isLive
        ? `<button class="auth-primary compact" type="button" data-view="wallet">Deposit funds</button>`
        : `<button class="auth-primary compact" type="button" data-action="reset-demo">Reset demo balance</button>`}
    </div>`;
  }

  const stake = Math.min(state.stake, availableBalance);
  return `${marketNoticeView}<div class="panel-heading"><div><h2>Place a ${isLive ? "live" : "demo"} position</h2><p>${isLive ? "Uses available wallet funds on the live market." : "Test your strategy with demo funds on the Demo market."}</p></div><span class="${isLive ? "live-pill" : "demo-label"}">${isLive ? "LIVE" : "DEMO"}</span></div>
    <div class="trade-field"><label>TRADE TYPE</label><div class="segmented" role="tablist"><button class="${state.tradeType === "digits" ? "selected" : ""}" data-trade-type="digits">Even / Odd</button><button class="${state.tradeType === "direction" ? "selected" : ""}" data-trade-type="direction">Over / Under</button></div></div>
    <div class="trade-field"><label>TRADE DURATION</label><div class="duration-select">${[10, 30, 60, 300].map((seconds) => `<button class="${state.duration === seconds ? "selected" : ""}" data-duration="${seconds}">${seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</button>`).join("")}</div></div>
    <div class="trade-field"><label>STAKE <span>Available ${formatMoney(availableBalance)}</span></label><div class="stake-control"><button data-stake="-">−</button><div><span>$</span><input id="stake" inputmode="decimal" type="number" min="1" max="${availableBalance}" step="0.01" value="${stake}" aria-label="Trade stake"></div><button data-stake="+">+</button></div><div class="quick-stakes">${[1, 5, 10, 25].map((amount) => `<button data-quick-stake="${amount}">$${amount}</button>`).join("")}</div></div>
    <div class="payout-preview"><span>Potential return <small>incl. stake</small></span><strong id="potential-return">${formatMoney(stake * (1 + state.payout / 100))}</strong><span class="payout-rate">${state.payout}% payout</span></div>
    <div class="trade-actions"><button class="trade-button even" data-choice="${state.tradeType === "digits" ? "even" : "over"}" ${canPlaceTrade ? "" : "disabled"}><span>${state.tradeType === "digits" ? "EVEN" : "OVER"}</span><small>${state.tradeType === "digits" ? "Last digit 0, 2, 4, 6, 8" : "Price finishes above entry"}</small><b>↗</b></button><button class="trade-button odd" data-choice="${state.tradeType === "digits" ? "odd" : "under"}" ${canPlaceTrade ? "" : "disabled"}><span>${state.tradeType === "digits" ? "ODD" : "UNDER"}</span><small>${state.tradeType === "digits" ? "Last digit 1, 3, 5, 7, 9" : "Price finishes below entry"}</small><b>↘</b></button></div>
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
        <div class="market-control-block"><div><strong>Market availability</strong><small>Suspending blocks new demo and wallet positions; open positions still settle normally.</small></div><label class="market-toggle"><input id="market-status-toggle" type="checkbox" ${marketStatus.isOpen ? "checked" : ""} ${marketStatusLoaded ? "" : "disabled"}><span>Accept new positions</span></label><label class="market-notice-field">Maintenance notice<input id="market-status-notice" type="text" maxlength="240" value="${escapeHtml(marketStatus.notice)}" placeholder="Optional notice shown to users"></label><button class="auth-primary compact" type="button" data-action="save-market-status" ${marketStatusLoaded ? "" : "disabled"}>Save market status</button></div>
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
  if (view === "bots") return botDashboardView();
  const titles = { bots: ["Trading bot signals", "Explore indicator-based strategies for the shared PIPMASTER market."], profile: ["Profile", "Manage account information stored securely in Supabase."] };
  const [title, subtitle] = titles[view] || ["Page not found", "Choose a page from the navigation."];
  return `<section class="page-heading"><div><div class="eyebrow">PIPMASTER</div><h1>${title}</h1><p>${subtitle}</p></div></section>
    ${strategyCatalogError ? `<div class="notice notice-warn"><span>ⓘ</span><div><strong>Bot catalog could not be refreshed</strong><p>${escapeHtml(strategyCatalogError)} Existing built-in strategies are shown; purchases require the database migration.</p></div></div>` : ""}
    <section class="bot-list">${strategyBots.map((bot) => `<button class="bot-market-card ${state.selectedBot === bot.id || state.selectedBot === bot.name ? "selected" : ""}" data-bot="${escapeHtml(bot.id)}"><span class="bot-symbol" style="--bot-color:${bot.color}">${escapeHtml(bot.icon)}</span><span><strong>${escapeHtml(bot.name)}</strong><small>${escapeHtml(bot.type)} · ${escapeHtml(bot.description)}</small></span><span class="bot-tier">${bot.price > 0 && !bot.owned ? `Unlock ${formatMoney(bot.price)}` : escapeHtml(bot.tier)}</span><span class="bot-arrow">${bot.owned || !bot.price ? "→" : "BUY"}</span></button>`).join("")}</section>
    ${botSignal ? `<div class="bot-signal"><div><span class="eyebrow">${escapeHtml(botSignal.bot)} · ${state.mode === "live" ? "LIVE WALLET" : "DEMO"} SIGNAL</span><strong>${botSignal.choice.toUpperCase()} · ${botSignal.strength} signal strength</strong><small>Indicator signal only; not a win probability. Review before placing.</small></div><button class="subtle-button" data-action="use-signal">Use signal</button></div>` : ""}
    <button class="auth-primary compact bot-signal-action" type="button" data-action="run-bot" ${strategyBots.length ? "" : "disabled"}>Generate ${escapeHtml(strategyBots.find((bot) => bot.id === state.selectedBot || bot.name === state.selectedBot)?.name || "bot")} signal</button>`;
}

function botDashboardView() {
  const selectedBot = strategyBots.find((bot) => bot.id === state.selectedBot || bot.name === state.selectedBot);
  const trades = state.mode === "live" ? walletTrades : state.trades;
  const settledTrades = trades.filter((trade) => trade.status !== "open");
  const wins = settledTrades.filter((trade) => Number(trade.result) > 0).length;
  const losses = settledTrades.filter((trade) => Number(trade.result) < 0).length;
  const openTrades = trades.filter((trade) => trade.status === "open").length;
  const realizedPnl = settledTrades.reduce((total, trade) => total + Number(trade.result || 0), 0);
  const sessionTrades = botSession.startedAt
    ? trades.filter((trade) => Number(trade.time) >= botSession.startedAt)
    : [];
  const sessionPnl = sessionTrades
    .filter((trade) => trade.status !== "open")
    .reduce((total, trade) => total + Number(trade.result || 0), 0);
  const isSessionRunning = botSession.status === "running";
  const isSessionPaused = botSession.status === "paused";
  const botExplanation = selectedBot?.strategyKey
    ? ({
      Pulse: "Uses recent price momentum to suggest a direction.",
      Sentry: "Compares short and medium moving averages for directional alignment.",
      Orbit: "Compares current price with the recent average to suggest mean reversion.",
      LAMIA: "Uses a short, three-tick momentum change.",
      INSTA: "Uses the latest tick-to-tick movement.",
      SKPOT: "Compares short and slower price averages.",
      VULJA: "Signals only when short-term trend and momentum agree.",
    })[selectedBot.strategyKey] || "Uses the selected indicator algorithm to generate an Over/Under signal."
    : "Select an available strategy to review its signal.";
  return `<section class="page-heading"><div><div class="eyebrow">STRATEGY WORKSPACE</div><h1>Strategies &amp; signals</h1><p>Indicator signals require your review; this page never opens trades automatically.</p></div><div class="mode-switch" role="group" aria-label="Account mode"><button class="${state.mode === "demo" ? "selected" : ""}" data-mode="demo">Demo</button><button class="${state.mode === "live" ? "selected" : ""}" data-mode="live">Live</button></div></section>
    ${strategyCatalogError ? `<div class="notice notice-warn"><span>ⓘ</span><div><strong>Strategy catalog unavailable</strong><p>${escapeHtml(strategyCatalogError)} Existing built-in strategies are shown; purchases require the database migration.</p></div></div>` : ""}
    <div class="bot-workspace-grid">
      <section class="panel bot-workspace-panel">
        <div class="panel-heading"><div><h2>Choose a strategy</h2><p>Signals use the internal PIPMASTER price history.</p></div><span class="status-badge ${isSessionRunning ? "open" : "closed"}">${isSessionRunning ? "SESSION RUNNING" : isSessionPaused ? "SESSION PAUSED" : "SESSION STOPPED"}</span></div>
        <div class="bot-list">${strategyBots.map((bot) => `<button class="bot-market-card ${state.selectedBot === bot.id || state.selectedBot === bot.name ? "selected" : ""}" data-bot="${escapeHtml(bot.id)}"><span class="bot-symbol" style="--bot-color:${bot.color}">${escapeHtml(bot.icon)}</span><span><strong>${escapeHtml(bot.name)}</strong><small>${escapeHtml(bot.type)} · ${escapeHtml(bot.description)}</small></span><span class="bot-tier">${bot.price > 0 && !bot.owned ? `Unlock ${formatMoney(bot.price)}` : bot.price > 0 ? "Unlocked · one-time" : "Included"}</span></button>`).join("")}</div>
        ${selectedBot ? `<div class="bot-configuration">
          <div class="bot-config-heading"><div><strong>${escapeHtml(selectedBot.name)} configuration</strong><small>${escapeHtml(botExplanation)}</small></div><span class="status-badge ${selectedBot.owned ? "closed" : "open"}">${selectedBot.owned ? "AVAILABLE" : "LOCKED"}</span></div>
          <div class="bot-config-grid">
            <label>Contract type<select disabled aria-label="Bot contract type"><option>Over / Under (directional)</option></select><small>These strategy signals return direction only.</small></label>
            <label>Stake (USD)<input id="bot-config-stake" type="number" min="1" max="${state.mode === "live" ? state.liveBalance : state.demoBalance}" step="0.01" value="${Math.min(state.stake, state.mode === "live" ? state.liveBalance : state.demoBalance)}"><small>Applied to the next manually reviewed signal.</small></label>
            <label>Duration<select id="bot-config-duration">${[10, 30, 60, 300].map((seconds) => `<option value="${seconds}" ${seconds === state.duration ? "selected" : ""}>${seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</option>`).join("")}</select><small>Fixed expiry; existing positions cannot be closed early.</small></label>
            <label>Entitlement<div class="bot-entitlement">${selectedBot.owned ? (selectedBot.price > 0 ? `Unlocked once for ${formatMoney(selectedBot.price)}` : "Included with your account") : `One-time unlock · ${formatMoney(selectedBot.price)}`}</div><small>No recurring subscription or auto-renewal is configured.</small></label>
          </div>
          <div class="bot-risk-disclosure"><strong>Risk controls</strong><span>Each confirmed trade can lose its full stake. Stop-loss, take-profit, and trade limits do not control fixed-expiry positions in this signal-only mode. Manage stake and expiry before confirming every trade.</span></div>
          <div class="bot-session-controls"><button class="auth-primary compact" type="button" data-action="bot-session-start" ${!selectedBot.owned || isSessionRunning ? "disabled" : ""}>${botSession.startedAt && botSession.status === "stopped" ? "Start new session" : "Start session"}</button><button class="secondary-button" type="button" data-action="bot-session-pause" ${!isSessionRunning ? "disabled" : ""}>Pause</button><button class="secondary-button" type="button" data-action="bot-session-resume" ${!isSessionPaused ? "disabled" : ""}>Resume</button><button class="secondary-button" type="button" data-action="bot-session-stop" ${botSession.status === "stopped" ? "disabled" : ""}>Stop</button><button class="${selectedBot.owned ? "subtle-button" : "auth-primary compact"}" type="button" data-action="run-bot" ${selectedBot.owned && !isSessionRunning ? "disabled" : ""}>${selectedBot.owned ? "Generate signal" : `Unlock once · ${formatMoney(selectedBot.price)}`}</button></div>
          <p class="bot-session-note">Session controls start/pause/stop manual signal generation only. No trades are automated. Session history is kept for this page session.</p>
        </div>` : `<div class="empty-state">No strategies are available right now.</div>`}
      </section>
      <aside class="bot-dashboard-side">
        <section class="panel bot-metrics-panel"><div class="panel-heading"><div><h2>${state.mode === "live" ? "Live account activity" : "Demo account activity"}</h2><p>Latest ${trades.length} account positions; not bot-attributed.</p></div></div><div class="bot-metric-grid"><div><small>Open positions</small><strong>${openTrades}</strong></div><div><small>Wins</small><strong>${wins}</strong></div><div><small>Losses</small><strong>${losses}</strong></div><div><small>Realized P&amp;L</small><strong class="${realizedPnl >= 0 ? "positive" : "negative"}">${formatMoney(realizedPnl)}</strong></div></div></section>
        <section class="panel bot-metrics-panel"><div class="panel-heading"><div><h2>Current signal session</h2><p>${botSession.startedAt ? `Started ${new Date(botSession.startedAt).toLocaleString()}` : "No session started."}</p></div></div><div class="bot-session-summary"><span>Signals logged (up to 100)</span><strong>${botSession.signals.length}</strong><span>Account P&amp;L since start</span><strong class="${sessionPnl >= 0 ? "positive" : "negative"}">${formatMoney(sessionPnl)}</strong><small>This is account-wide P&amp;L for the selected mode from the latest returned positions created since the session started; it is not strategy-attributed and may be incomplete if older than returned history.</small></div></section>
        <section class="panel bot-metrics-panel"><div class="panel-heading"><div><h2>Signal log</h2><p>Signal strength is an indicator score, not a probability.</p></div></div>${botSession.signals.length ? `<div class="bot-signal-log">${botSession.signals.slice(0, 20).map((signal) => `<div><span><strong>${escapeHtml(signal.bot)}</strong><small>${new Date(signal.time).toLocaleTimeString()}</small></span><b>${escapeHtml(signal.choice.toUpperCase())}</b><span>${Number(signal.strength)} score</span></div>`).join("")}</div>` : `<div class="empty-state"><strong>No signals in this session</strong><p>Start a session and generate a signal for the selected strategy.</p></div>`}</section>
      </aside>
    </div>
    <section class="panel bot-data-limits"><div><strong>Backtesting, optimization &amp; historical accuracy</strong><p>Not available as reliable metrics yet. The strategy RPC reads at most 30 recent ticks, and no durable signal/strategy attribution history is stored. The chart’s recent tick window is not a representative backtest sample; no win rate or confidence interval is claimed.</p></div><button class="secondary-button" type="button" disabled title="Requires retained historical ticks and stored strategy signals">Backtest unavailable</button></section>
    ${botSignal ? `<div class="bot-signal"><div><span class="eyebrow">${escapeHtml(botSignal.bot)} · ${state.mode === "live" ? "LIVE WALLET" : "DEMO"} SIGNAL</span><strong>${botSignal.choice.toUpperCase()} · ${escapeHtml(botSignal.strength)} indicator score</strong><small>Not a win probability. Review the position and confirm manually to trade.</small></div><button class="subtle-button" data-action="use-signal">Review signal</button></div>` : ""}`;
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
  app.querySelector('[data-action="toggle-market-favorite"]')?.addEventListener("click", toggleMarketFavorite);
  app.querySelectorAll("[data-trade-type]").forEach((button) => button.addEventListener("click", () => {
    state.tradeType = button.dataset.tradeType;
    render();
  }));
  app.querySelectorAll("[data-duration]").forEach((button) => button.addEventListener("click", () => { state.duration = Number(button.dataset.duration); render(); }));
  app.querySelectorAll("[data-bot]").forEach((button) => button.addEventListener("click", () => {
    state.selectedBot = button.dataset.bot;
    if (state.activeView === "bots") {
      render();
      return;
    }
    app.querySelectorAll("[data-bot]").forEach((item) => item.classList.toggle("selected", item.dataset.bot === state.selectedBot));
    const selected = strategyBots.find((bot) => bot.id === state.selectedBot || bot.name === state.selectedBot);
    showToast(`${selected?.name || state.selectedBot} strategy selected`);
  }));
  app.querySelectorAll("[data-quick-stake]").forEach((button) => button.addEventListener("click", () => setStake(Number(button.dataset.quickStake))));
  app.querySelectorAll("[data-stake]").forEach((button) => button.addEventListener("click", () => setStake(state.stake + (button.dataset.stake === "+" ? 5 : -5))));
  app.querySelector("#stake")?.addEventListener("change", (event) => setStake(Number(event.target.value)));
  app.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", () => showTradeReview(button.dataset.choice)));
  app.querySelector('[data-action="save-market-status"]')?.addEventListener("click", saveMarketStatus);
  app.querySelectorAll("[data-setting]").forEach((input) => input.addEventListener("input", () => updateSetting(input.dataset.setting, Number(input.value))));
  app.querySelector("#payout-input")?.addEventListener("change", (event) => updateSetting("payout", Number(event.target.value)));
  app.querySelector('[data-action="reset-demo"]')?.addEventListener("click", resetDemo);
  app.querySelector('[data-action="clear-history"]')?.addEventListener("click", clearHistory);
  app.querySelector('[data-action="scan"]')?.addEventListener("click", runScanner);
  app.querySelector('[data-action="run-bot"]')?.addEventListener("click", runBot);
  app.querySelector('[data-action="bot-session-start"]')?.addEventListener("click", () => {
    const stake = Number(app.querySelector("#bot-config-stake")?.value);
    const balance = state.mode === "live" ? state.liveBalance : state.demoBalance;
    if (!Number.isFinite(stake) || stake < 1 || stake > balance) {
      showToast(`Set a valid signal stake between $1.00 and your ${state.mode} balance.`);
      return;
    }
    state.stake = stake;
    state.duration = Number(app.querySelector("#bot-config-duration")?.value);
    botSession = { status: "running", startedAt: Date.now(), signals: [] };
    botSignal = null;
    render();
    showToast("Signal session started. No trades will open without your review and confirmation.");
  });
  app.querySelector('[data-action="bot-session-pause"]')?.addEventListener("click", () => {
    botSession.status = "paused";
    render();
    showToast("Signal session paused.");
  });
  app.querySelector('[data-action="bot-session-resume"]')?.addEventListener("click", () => {
    botSession.status = "running";
    render();
    showToast("Signal session resumed.");
  });
  app.querySelector('[data-action="bot-session-stop"]')?.addEventListener("click", () => {
    botSession.status = "stopped";
    render();
    showToast("Signal session stopped.");
  });
  app.querySelector('[data-action="use-signal"]')?.addEventListener("click", async () => {
    if (!botSignal) return;
    const balance = state.mode === "live" ? state.liveBalance : state.demoBalance;
    if (balance < 1) {
      state.activeView = "trade";
      render();
      showToast(state.mode === "live" ? "Insufficient wallet balance. Wallet deposits start at $2.00; deposit to reach the $1.00 trade minimum." : "Insufficient demo balance. Reset your demo balance to place the signal.");
      return;
    }
    state.stake = Math.min(state.stake, balance);
    state.tradeType = "direction";
    state.activeView = "trade";
    render();
    showTradeReview(botSignal.choice, botSignal.bot);
  });
  app.querySelectorAll("[data-timeframe]").forEach((button) => button.addEventListener("click", () => {
    app.querySelectorAll("[data-timeframe]").forEach((item) => item.classList.toggle("active", item === button));
    chartTimeframe = button.dataset.timeframe;
    chartOffset = 0;
    chartPointer = null;
    drawChart(app.querySelector("#price-chart"));
  }));
  app.querySelectorAll("[data-chart-display]").forEach((button) => button.addEventListener("click", () => {
    chartDisplay = button.dataset.chartDisplay;
    render();
  }));
  app.querySelectorAll("[data-chart-tool]").forEach((button) => button.addEventListener("click", () => {
    chartTool = button.dataset.chartTool;
    chartDrawingDraft = null;
    app.querySelectorAll("[data-chart-tool]").forEach((item) => item.classList.toggle("active", item === button));
    const canvas = app.querySelector("#price-chart");
    if (canvas) canvas.style.cursor = chartTool === "pan" ? "grab" : chartTool === "crosshair" ? "crosshair" : "copy";
    drawChart(canvas);
  }));
  app.querySelectorAll("[data-chart-indicator]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.chartIndicator;
    chartIndicators[key] = !chartIndicators[key];
    button.classList.toggle("active", chartIndicators[key]);
    drawChart(app.querySelector("#price-chart"));
  }));
  app.querySelectorAll("[data-chart-action]").forEach((button) => button.addEventListener("click", () => handleChartAction(button.dataset.chartAction)));
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
  const isLive = choice.mode === "live";
  const duration = choice.duration;
  const balance = isLive ? state.liveBalance : state.demoBalance;
  const stake = Number(choice.stake);
  if (!Number.isFinite(stake) || stake < 1 || stake > balance) {
    showToast(`Enter a valid stake of at least $1.00 within your ${isLive ? "wallet" : "demo"} balance.`);
    return;
  }
  const { error } = await supabase.rpc(isLive ? "place_wallet_trade" : "place_demo_trade", {
    p_choice: choice.choice,
    p_stake: stake,
    p_duration_seconds: duration,
  });
  if (error) {
    showToast(`Could not place ${isLive ? "wallet" : "demo"} position: ${error.message}`);
    return;
  }
  try {
    if (isLive) await refreshWalletSnapshot();
    else await refreshTerminalSnapshot();
    render();
    showToast(`${isLive ? "Wallet-funded" : "Demo"} ${choice.choice.toUpperCase()} position opened · ${duration}s`);
  } catch (refreshError) {
    render();
    showToast(`Position opened, but refresh failed: ${refreshError.message}`);
  }
}

function showTradeReview(choice, botName = "") {
  if (!marketStatusLoaded || !marketStatus.isOpen) {
    showToast(marketStatus.notice || "New positions are currently unavailable.");
    return;
  }
  const validChoices = ["even", "odd", "over", "under"];
  if (!validChoices.includes(choice)) {
    showToast("That position type is unavailable.");
    return;
  }
  const isLive = state.mode === "live";
  const balance = isLive ? state.liveBalance : state.demoBalance;
  const stake = Number(app.querySelector("#stake")?.value);
  if (!Number.isFinite(stake) || stake < 1 || stake > balance) {
    showToast(`Enter a valid stake of at least $1.00 within your ${isLive ? "wallet" : "demo"} balance.`);
    return;
  }
  const payout = Number(state.payout);
  const returnAmount = stake * (1 + payout / 100);
  const priceNow = isLive ? livePrice : price;
  const duration = state.duration;
  const expiryTime = new Date(Date.now() + duration * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const labels = { even: "Even", odd: "Odd", over: "Over", under: "Under" };
  const dialog = app.querySelector("#trade-review");
  if (!dialog) {
    showToast("Trade review is unavailable. Reopen the trading terminal and try again.");
    return;
  }
  pendingTradeReview = { choice, stake, duration, mode: state.mode };
  dialog.innerHTML = `<div class="trade-review-content">
    <div class="eyebrow">POSITION REVIEW</div>
    <h2>Confirm ${labels[choice]} position</h2>
    <p>${botName ? `${escapeHtml(botName)} signal · ` : ""}${isLive ? "Wallet-funded" : "Demo funds"} · ${duration}s expiry</p>
    <dl><div><dt>Stake</dt><dd>${formatMoney(stake)}</dd></div><div><dt>Potential return <small>including stake</small></dt><dd>${formatMoney(returnAmount)}</dd></div><div><dt>Market price now</dt><dd>${priceNow.toFixed(2)} USD</dd></div><div><dt>Expected expiry</dt><dd>${expiryTime}</dd></div></dl>
    <p class="trade-cost-disclosure">No separate spread, slippage, or trading fee is configured. The final entry price is the PIPMASTER internal market price when your position is accepted; settlement is fixed to expiry.</p>
    <p class="trade-risk-disclosure">You may lose the full stake. The expiry cannot be changed after opening.</p>
    <div class="trade-review-actions"><button class="secondary-button" type="button" data-action="cancel-trade">Cancel</button><button class="auth-primary compact" type="button" data-action="confirm-trade">Confirm position</button></div>
  </div>`;
  dialog.showModal();
  dialog.querySelector('[data-action="cancel-trade"]')?.addEventListener("click", () => dialog.close());
  dialog.querySelector('[data-action="confirm-trade"]')?.addEventListener("click", async () => {
    if (!pendingTradeReview) return;
    const confirmedTrade = pendingTradeReview;
    pendingTradeReview = null;
    dialog.close();
    await placeTrade(confirmedTrade);
  });
  dialog.addEventListener("close", () => { pendingTradeReview = null; }, { once: true });
}

async function saveMarketStatus(event) {
  const button = event.currentTarget;
  const isOpen = Boolean(app.querySelector("#market-status-toggle")?.checked);
  const notice = String(app.querySelector("#market-status-notice")?.value || "").trim();
  if (notice.length > 240) {
    showToast("The maintenance notice must be 240 characters or fewer.");
    return;
  }
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("set_market_status", {
      p_is_open: isOpen,
      p_notice: notice,
    });
    if (error) throw error;
    await loadMarketStatus();
    render();
    showToast(isOpen ? "Market opened for new positions." : "Market suspended for new positions.");
  } catch (error) {
    showToast(`Could not update market status: ${error.message}`);
    if (button.isConnected) button.disabled = false;
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
  if (state.activeView === "bots" && bot.owned && botSession.status !== "running") {
    showToast("Start or resume the signal session before generating a signal.");
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
      if (state.activeView === "bots" && botSession.status !== "running") return;
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
    strength: Number(data.strength),
  };
  if (botSession.status === "running") {
    botSession.signals.unshift({
      bot: bot.name,
      choice: data.signal,
      strength: Number(data.strength),
      time: Date.now(),
    });
    botSession.signals = botSession.signals.slice(0, 100);
  }
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
    if (Date.now() - marketStatusLastAttemptAt >= 5000) {
      const wasLoaded = marketStatusLoaded;
      try {
        const changed = await loadMarketStatus();
        if (changed) render();
      } catch (error) {
        marketStatusLoaded = false;
        marketStatusLastAttemptAt = Date.now();
        if (wasLoaded) {
          render();
          showToast(`Market status unavailable; new positions are disabled: ${error.message}`);
        }
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
  canvas.style.cursor = chartTool === "pan" ? "grab" : chartTool === "crosshair" ? "crosshair" : "copy";
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    chartPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (chartDrag && chartTool === "pan" && chartRenderState) {
      const { plotWidth, visibleCandles, allCandles } = chartRenderState;
      const dx = event.clientX - chartDrag.startX;
      const shift = Math.round((dx / Math.max(1, plotWidth)) * visibleCandles.length);
      chartOffset = clamp(chartDrag.startOffset + shift, 0, Math.max(0, allCandles.length - visibleCandles.length));
    }
    if (chartDrawingDraft) {
      chartDrawingDraft.end = chartPointAt(chartPointer.x, chartPointer.y);
    }
    drawChart(canvas);
  });
  canvas.addEventListener("pointerleave", () => {
    if (!chartDrag && !chartDrawingDraft) chartPointer = null;
    drawChart(canvas);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!chartRenderState) return;
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (chartTool === "pan") {
      chartDrag = { startX: event.clientX, startOffset: chartOffset };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    } else if (["measure", "trendline", "fibonacci"].includes(chartTool)) {
      const start = chartPointAt(point.x, point.y);
      if (start) {
        chartDrawingDraft = { type: chartTool, start, end: start };
        canvas.setPointerCapture(event.pointerId);
      }
    } else if (chartTool === "annotation") {
      const anchor = chartPointAt(point.x, point.y);
      if (!anchor) return;
      const text = window.prompt("Annotation text (up to 60 characters):", "");
      if (text?.trim()) {
        chartDrawings.push({ type: "annotation", start: anchor, text: text.trim().slice(0, 60) });
        drawChart(canvas);
      }
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (chartDrag) {
      chartDrag = null;
      canvas.style.cursor = chartTool === "pan" ? "grab" : "crosshair";
    }
    if (chartDrawingDraft) {
      chartDrawingDraft.end = chartPointAt(
        event.clientX - canvas.getBoundingClientRect().left,
        event.clientY - canvas.getBoundingClientRect().top,
      ) || chartDrawingDraft.end;
      chartDrawings.push(chartDrawingDraft);
      chartDrawingDraft = null;
    }
    drawChart(canvas);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    chartZoom = clamp(chartZoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), 0.6, 8);
    chartOffset = Math.min(chartOffset, Math.max(0, (chartRenderState?.allCandles.length || 0) - Math.floor(100 / chartZoom)));
    drawChart(canvas);
  }, { passive: false });
}

function chartPointAt(x, y) {
  const view = chartRenderState;
  if (!view || x < view.left || x > view.right || y < view.top || y > view.bottom) return null;
  const index = clamp(Math.floor((x - view.left) / view.step), 0, view.visibleCandles.length - 1);
  return {
    time: view.visibleCandles[index].time,
    price: view.max - ((y - view.top) / view.plotHeight) * view.range,
  };
}

function handleChartAction(action) {
  const canvas = app.querySelector("#price-chart");
  if (!canvas) return;
  if (action === "zoom-in" || action === "zoom-out") {
    chartZoom = clamp(chartZoom * (action === "zoom-in" ? 1.25 : 0.8), 0.6, 8);
  } else if (action === "reset") {
    chartZoom = 1;
    chartOffset = 0;
  } else if (action === "clear-drawings") {
    chartDrawings = [];
    chartDrawingDraft = null;
  } else if (action === "toggle-grid") {
    chartSettings.showGrid = !chartSettings.showGrid;
    app.querySelector('[data-chart-action="toggle-grid"]')?.classList.toggle("active", chartSettings.showGrid);
  } else if (action === "toggle-price-line") {
    chartSettings.showCurrentPrice = !chartSettings.showCurrentPrice;
    app.querySelector('[data-chart-action="toggle-price-line"]')?.classList.toggle("active", chartSettings.showCurrentPrice);
  } else if (action === "toggle-indicator-alert") {
    chartIndicatorAlertEnabled = !chartIndicatorAlertEnabled;
    chartIndicatorAlertKey = "";
    app.querySelector('[data-chart-action="toggle-indicator-alert"]')?.classList.toggle("active", chartIndicatorAlertEnabled);
    showToast(chartIndicatorAlertEnabled
      ? "SMA 10 / EMA 20 crossover alerts are active while this page is open."
      : "Indicator crossover alerts are off.");
  } else if (action === "fullscreen") {
    const chart = app.querySelector(".chart-panel");
    if (document.fullscreenElement) {
      document.exitFullscreen().catch((error) => showToast(`Could not exit fullscreen: ${error.message}`));
    } else if (chart?.requestFullscreen) {
      chart.requestFullscreen().catch((error) => showToast(`Could not enter fullscreen: ${error.message}`));
    } else {
      showToast("Fullscreen is not supported by this browser.");
    }
  } else if (action === "snapshot") {
    try {
      const link = document.createElement("a");
      link.download = `pipmaster-${chartTimeframe}-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (error) {
      showToast(`Could not export chart snapshot: ${error.message}`);
    }
  } else if (action === "price-alert") {
    const currentPrice = state.mode === "live" ? livePrice : price;
    const rawTarget = window.prompt(`Alert when price reaches (current: ${currentPrice.toFixed(2)}):`, currentPrice.toFixed(2));
    if (rawTarget === null) return;
    const target = Number(rawTarget);
    if (!Number.isFinite(target) || target <= 0) {
      showToast("Enter a valid price above zero.");
      return;
    }
    chartPriceAlert = { target, mode: state.mode };
    showToast(`Price alert set at ${target.toFixed(2)} for ${state.mode} mode. Keep this page open.`);
  }
  drawChart(canvas);
}

function checkChartPriceAlert(previousPrice, currentPrice) {
  checkChartIndicatorAlert();
  if (!chartPriceAlert || chartPriceAlert.mode !== state.mode) return;
  const reached = (previousPrice <= chartPriceAlert.target && currentPrice >= chartPriceAlert.target)
    || (previousPrice >= chartPriceAlert.target && currentPrice <= chartPriceAlert.target);
  if (reached) {
    chartPriceAlert = null;
    showToast("Your PIPMASTER price alert was reached.");
  }
}

function checkChartIndicatorAlert() {
  if (!chartIndicatorAlertEnabled) return;
  const points = state.mode === "live" ? liveChartPoints : chartPoints;
  const candles = chartCandles(points);
  if (candles.length < 21) return;
  const closes = candles.map((candle) => candle.close);
  const ema = [closes[0]];
  const multiplier = 2 / 21;
  for (let index = 1; index < closes.length; index++) {
    ema[index] = closes[index] * multiplier + ema[index - 1] * (1 - multiplier);
  }
  const last = closes.length - 1;
  const previousSma = closes.slice(last - 10, last).reduce((sum, value) => sum + value, 0) / 10;
  const currentSma = closes.slice(last - 9).reduce((sum, value) => sum + value, 0) / 10;
  const previousRelation = previousSma - ema[last - 1];
  const currentRelation = currentSma - ema[last];
  const crossedUp = previousRelation <= 0 && currentRelation > 0;
  const crossedDown = previousRelation >= 0 && currentRelation < 0;
  const key = `${state.mode}:${candles[last].time}:${crossedUp ? "up" : "down"}`;
  if ((crossedUp || crossedDown) && key !== chartIndicatorAlertKey) {
    chartIndicatorAlertKey = key;
    showToast(`SMA 10 crossed ${crossedUp ? "above" : "below"} EMA 20 on ${state.mode} chart.`);
  }
}

function chartCandles(points) {
  const intervals = { "5s": 5_000, "15s": 15_000, "30s": 30_000, "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000 };
  const fallbackGroupSizes = { "5s": 5, "15s": 15, "30s": 30, "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };
  const tickPoints = points.map((point, index) => ({
    ...point,
    time: Number.isFinite(point.time) ? point.time : Date.now() - (points.length - index - 1) * 1000,
  }));
  const candleFromPoints = (items, time) => ({
    time,
    open: items[0].y,
    high: Math.max(...items.map((point) => point.y)),
    low: Math.min(...items.map((point) => point.y)),
    close: items[items.length - 1].y,
  });
  if (chartTimeframe === "tick") {
    return tickPoints.map((point) => candleFromPoints([point], point.time));
  }
  const interval = intervals[chartTimeframe] || intervals["1m"];
  const hasTimestamps = points.every((point) => Number.isFinite(point.time));
  if (!hasTimestamps) {
    const groupSize = fallbackGroupSizes[chartTimeframe] || fallbackGroupSizes["1m"];
    const groups = [];
    for (let index = 0; index < tickPoints.length; index += groupSize) {
      groups.push(tickPoints.slice(index, index + groupSize));
    }
    return groups.map((group, index) => candleFromPoints(
      group,
      group[0].time,
    ));
  }

  const groups = new Map();
  tickPoints.forEach((point) => {
    const time = point.time;
    const bucket = Math.floor(time / interval) * interval;
    const group = groups.get(bucket) || [];
    group.push(point);
    groups.set(bucket, group);
  });
  return [...groups.entries()]
    .sort(([first], [second]) => first - second)
    .map(([time, group]) => candleFromPoints(group, time));
}

function relativeStrengthIndex(closes, period = 14) {
  const values = Array(closes.length).fill(null);
  if (closes.length <= period) return values;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index++) {
    const change = closes[index] - closes[index - 1];
    averageGain += Math.max(change, 0) / period;
    averageLoss += Math.max(-change, 0) / period;
  }
  const rsiAt = (gain, loss) => loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  values[period] = rsiAt(averageGain, averageLoss);
  for (let index = period + 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    values[index] = rsiAt(averageGain, averageLoss);
  }
  return values;
}

function findRsiDivergences(candles, rsiValues) {
  const lowPivots = [];
  const highPivots = [];
  for (let index = 15; index < candles.length - 1; index++) {
    const previous = candles[index - 1];
    const current = candles[index];
    const next = candles[index + 1];
    if (Number.isFinite(rsiValues[index])
      && current.low < previous.low && current.low <= next.low) lowPivots.push(index);
    if (Number.isFinite(rsiValues[index])
      && current.high > previous.high && current.high >= next.high) highPivots.push(index);
  }
  const signals = [];
  if (lowPivots.length >= 2) {
    const [previous, current] = lowPivots.slice(-2);
    if (candles[current].low < candles[previous].low && rsiValues[current] > rsiValues[previous]) {
      signals.push({ index: current, price: candles[current].low, label: "Bullish divergence" });
    }
  }
  if (highPivots.length >= 2) {
    const [previous, current] = highPivots.slice(-2);
    if (candles[current].high > candles[previous].high && rsiValues[current] < rsiValues[previous]) {
      signals.push({ index: current, price: candles[current].high, label: "Bearish divergence" });
    }
  }
  return signals;
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
  const visibleCount = clamp(Math.floor(100 / chartZoom), 10, 160);
  const maxOffset = Math.max(0, candles.length - visibleCount);
  chartOffset = clamp(chartOffset, 0, maxOffset);
  const end = candles.length - chartOffset;
  const visibleCandles = candles.slice(Math.max(0, end - visibleCount), end);
  const left = 12;
  const right = width - 68;
  const top = 14;
  const rsiHeight = chartIndicators.rsi ? Math.min(64, height * 0.24) : 0;
  const bottom = height - 28 - rsiHeight;
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
  const candleWidth = Math.min(12, Math.max(3, step * 0.82));
  chartRenderState = { left, right, top, bottom, plotWidth, plotHeight, visibleCandles, allCandles: candles, step, range, min, max };

  ctx.fillStyle = "#0e151f";
  ctx.fillRect(0, 0, width, height);
  ctx.font = "10px DM Sans, sans-serif";
  ctx.textBaseline = "middle";
  for (let index = 0; index <= 5; index++) {
    const y = top + (plotHeight * index) / 5;
    const value = max - (range * index) / 5;
    if (chartSettings.showGrid) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.strokeStyle = "rgba(151,168,190,.13)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = "#8b98a9";
    ctx.textAlign = "right";
    ctx.fillText(value.toFixed(2), width - 8, y);
  }

  for (let index = 0; index <= 6; index++) {
    const x = left + (plotWidth * index) / 6;
    if (chartSettings.showGrid) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.strokeStyle = "rgba(151,168,190,.09)";
      ctx.stroke();
    }
    if (index <= 6) {
      const candleIndex = Math.min(visibleCandles.length - 1, Math.round((visibleCandles.length - 1) * index / 6));
      const date = new Date(visibleCandles[candleIndex].time);
      ctx.fillStyle = "#8b98a9";
      ctx.textAlign = index === 0 ? "left" : index === 6 ? "right" : "center";
      ctx.fillText(date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: chartTimeframe === "tick" || chartTimeframe.endsWith("s") }), x, height - 13);
    }
  }

  if (chartDisplay === "line") {
    ctx.beginPath();
    visibleCandles.forEach((candle, index) => {
      const x = left + step * index + step / 2;
      if (index === 0) ctx.moveTo(x, yForPrice(candle.close));
      else ctx.lineTo(x, yForPrice(candle.close));
    });
    ctx.strokeStyle = isLive ? "#52a1ff" : "#41d5a4";
    ctx.lineWidth = 2;
    ctx.stroke();
    const lastX = left + step * (visibleCandles.length - 0.5);
    ctx.lineTo(lastX, bottom);
    ctx.lineTo(left + step / 2, bottom);
    ctx.closePath();
    ctx.fillStyle = isLive ? "rgba(82,161,255,.09)" : "rgba(65,213,164,.09)";
    ctx.fill();
  } else {
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
  }

  const fullCloses = candles.map((candle) => candle.close);
  const startIndex = Math.max(0, end - visibleCount);
  const drawIndicator = (type, enabled, period, color) => {
    if (!enabled || fullCloses.length < period) return;
    const indicator = [];
    if (type === "sma") {
      for (let index = 0; index < fullCloses.length; index++) {
        indicator[index] = index + 1 < period
          ? null
          : fullCloses.slice(index + 1 - period, index + 1).reduce((sum, value) => sum + value, 0) / period;
      }
    } else {
      const multiplier = 2 / (period + 1);
      let previous = fullCloses[0];
      indicator[0] = previous;
      for (let index = 1; index < fullCloses.length; index++) {
        previous = fullCloses[index] * multiplier + previous * (1 - multiplier);
        indicator[index] = previous;
      }
    }
    ctx.beginPath();
    let started = false;
    visibleCandles.forEach((candle, index) => {
      const value = indicator[startIndex + index];
      if (!Number.isFinite(value)) return;
      const x = left + step * index + step / 2;
      if (!started) {
        ctx.moveTo(x, yForPrice(value));
        started = true;
      } else {
        ctx.lineTo(x, yForPrice(value));
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  drawIndicator("sma", chartIndicators.sma, 10, "#e8b44a");
  drawIndicator("ema", chartIndicators.ema, 20, "#b395ff");

  const rsiValues = relativeStrengthIndex(fullCloses);
  if (chartIndicators.rsi && rsiHeight > 30) {
    const rsiTop = bottom + 7;
    const rsiBottom = height - 29;
    [30, 50, 70].forEach((value) => {
      const y = rsiBottom - (value / 100) * (rsiBottom - rsiTop);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.strokeStyle = value === 50 ? "rgba(151,168,190,.1)" : "rgba(151,168,190,.18)";
      ctx.setLineDash(value === 50 ? [] : [3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.beginPath();
    let started = false;
    visibleCandles.forEach((candle, index) => {
      const value = rsiValues[startIndex + index];
      if (!Number.isFinite(value)) return;
      const x = left + step * index + step / 2;
      const y = rsiBottom - (value / 100) * (rsiBottom - rsiTop);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = "#b395ff";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = "#a9b5c5";
    ctx.font = "8px DM Sans, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("RSI 14", left + 2, rsiTop + 4);
    ctx.textAlign = "right";
    ctx.fillText("70", right - 2, rsiBottom - .7 * (rsiBottom - rsiTop));
    ctx.fillText("30", right - 2, rsiBottom - .3 * (rsiBottom - rsiTop));
  }

  const xForTime = (time) => {
    if (!visibleCandles.length
      || time < visibleCandles[0].time
      || time > visibleCandles[visibleCandles.length - 1].time) return null;
    let closestIndex = 0;
    let closestDistance = Infinity;
    visibleCandles.forEach((candle, index) => {
      const distance = Math.abs(candle.time - time);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    });
    return left + step * closestIndex + step / 2;
  };
  if (chartIndicators.divergence) {
    findRsiDivergences(candles, rsiValues).forEach((signal) => {
      const candle = candles[signal.index];
      const x = xForTime(candle.time);
      if (x === null) return;
      const y = yForPrice(signal.price);
      const bullish = signal.label.startsWith("Bullish");
      ctx.fillStyle = bullish ? "#41d5a4" : "#ff657c";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "9px DM Sans, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(signal.label, x + 7, y + (bullish ? 11 : -9));
    });
  }
  const drawDrawing = (drawing) => {
    const startX = xForTime(drawing.start.time);
    if (startX === null) return;
    const startY = yForPrice(drawing.start.price);
    if (drawing.type === "annotation") {
      ctx.fillStyle = "#f3c65e";
      ctx.beginPath();
      ctx.arc(startX, startY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px DM Sans, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(drawing.text, startX + 6, startY - 8);
      return;
    }
    if (!drawing.end) return;
    const endX = xForTime(drawing.end.time);
    if (endX === null) return;
    const endY = yForPrice(drawing.end.price);
    ctx.strokeStyle = drawing.type === "measure" ? "#f3c65e" : "#82aaff";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1.5;
    if (drawing.type === "fibonacci") {
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      levels.forEach((level) => {
        const y = startY + (endY - startY) * level;
        ctx.beginPath();
        ctx.moveTo(Math.min(startX, endX), y);
        ctx.lineTo(Math.max(startX, endX), y);
        ctx.stroke();
        ctx.font = "8px DM Sans, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${(level * 100).toFixed(1)}%`, Math.min(startX, endX) + 2, y - 4);
      });
    } else {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      if (drawing.type === "measure") {
        const difference = drawing.end.price - drawing.start.price;
        const percent = drawing.start.price ? difference / drawing.start.price * 100 : 0;
        ctx.font = "9px DM Sans, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${difference >= 0 ? "+" : ""}${difference.toFixed(2)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`, endX + 5, endY - 7);
      }
    }
  };
  chartDrawings.forEach(drawDrawing);
  if (chartDrawingDraft) drawDrawing(chartDrawingDraft);

  const latest = visibleCandles[visibleCandles.length - 1];
  const currentY = yForPrice(currentPrice);
  if (chartSettings.showCurrentPrice) {
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
  }

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
document.addEventListener("fullscreenchange", () => {
  window.setTimeout(() => drawChart(document.querySelector("#price-chart")), 50);
});

beginAuth();
