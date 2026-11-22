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
let chartTimer;
let toastTimer;
let botSignal = null;
let settingsSaveTimer;
let workspaceUserId = null;
let workspaceLoadPromise = null;
let chartPollVersion = 0;
let pendingLocalSettings = false;
let walletTransactions = [];
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
            <div class="account-chip"><span class="status-dot"></span> ${state.mode === "demo" ? "Demo account" : "Live market view"}</div>
            <button class="icon-button" title="Notifications" aria-label="Notifications">♧<i></i></button>
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
        <footer class="disclaimer"><span>ⓘ</span> Live view shows the shared admin-managed PIPMASTER market. Wallet funds are separate from demo positions; KSh values are estimates.</footer>
      </main>
    </div>`;
  bindEvents();
  if (state.activeView === "admin" && auth.profile?.role === "admin" && !walletAdminLoading && !walletAdminLoaded) {
    loadWalletAdminData();
  }
  if (state.activeView === "trade") {
    const canvas = document.querySelector("#price-chart");
    drawChart(canvas);
  }
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
    form = `<div class="auth-alert error"><strong>Supabase setup is required</strong><p>Authentication and remote app data are intentionally fail-closed. Configure the GitHub Actions variables <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then apply all four Supabase migrations before sign-up can work.</p></div>`;
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
    .map((tick, index) => ({ x: index, y: Number(tick.price) }));

  const settingsChanged = !pendingLocalSettings
    && previousSettings !== JSON.stringify([state.volatility, state.drift, state.chartSpeed, state.payout]);
  const tradesChanged = previousTrades !== JSON.stringify(state.trades);
  const priceEl = document.querySelector("#current-price");
  const changeEl = document.querySelector("#price-change");
  const clock = document.querySelector("#chart-clock");
  const canvas = document.querySelector("#price-chart");
  if (priceEl) priceEl.textContent = price.toFixed(2);
  if (changeEl) {
    const change = data.previousPrice ? ((price - Number(data.previousPrice)) / Number(data.previousPrice)) * 100 : 0;
    changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
    changeEl.className = change >= 0 ? "positive" : "negative";
  }
  if (clock) clock.textContent = new Date().toLocaleTimeString();
  if (canvas) drawChart(canvas);
  if (renderOnChange && (settingsChanged || tradesChanged)) render();
}

async function refreshWalletSnapshot(renderOnChange = false) {
  const { data, error } = await supabase.rpc("get_wallet_snapshot");
  if (error) throw error;

  const previousBalance = state.liveBalance;
  const previousRate = walletRate;
  const previousTransactions = JSON.stringify(walletTransactions);
  state.liveBalance = Number(data.balance);
  walletRate = Number(data.usdToKes);
  walletTransactions = Array.isArray(data.transactions) ? data.transactions : [];
  walletLastAttemptAt = Date.now();
  const changed = previousBalance !== state.liveBalance
    || previousRate !== walletRate
    || previousTransactions !== JSON.stringify(walletTransactions);

  const balance = document.querySelector("#wallet-available");
  const kes = document.querySelector("#wallet-kes");
  if (balance) balance.textContent = formatMoney(state.liveBalance);
  if (kes) kes.textContent = formatKes(state.liveBalance, walletRate);
  if (renderOnChange && changed && state.activeView === "wallet" && walletScreen === "overview") render();
}

async function initializeWorkspace(user) {
  if (workspaceUserId === user.id) {
    if (workspaceLoadPromise) await workspaceLoadPromise;
    return;
  }

  workspaceUserId = user.id;
  workspaceLoadPromise = (async () => {
    try {
      await loadProfile(user);
      await refreshTerminalSnapshot();
      await refreshWalletSnapshot();
      auth.screen = window.location.hash.includes("type=recovery") ? "reset-password" : "workspace";
      startChart();
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

async function beginAuth() {
  const recoveringPassword = window.location.hash.includes("type=recovery");
  auth.screen = recoveringPassword ? "reset-password" : window.location.hash === "#/signup" ? "signup" : "login";
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
  state.activeView = "trade";
  render();
}

function navItem(view, icon, label, badge = "") {
  return `<button class="nav-item ${state.activeView === view ? "active" : ""}" data-view="${view}"><span class="nav-icon">${icon}</span>${label}${badge}</button>`;
}

function tradingView() {
  const active = state.mode === "demo" ? state.demoBalance : state.liveBalance;
  return `
    <section class="page-heading">
      <div><div class="eyebrow"><span class="status-dot"></span> SHARED PIPMASTER MARKET · ADMIN-MANAGED</div><h1>Trading terminal</h1><p>${state.mode === "live" ? "Live view of the shared market managed from Admin controls." : "Explore the shared PIPMASTER market using demo funds."}</p></div>
      <div class="mode-switch" role="group" aria-label="Account mode">
        <button class="${state.mode === "demo" ? "selected" : ""}" data-mode="demo">Demo</button>
        <button class="${state.mode === "live" ? "selected" : ""}" data-mode="live">Live</button>
      </div>
    </section>
    <section class="balance-row">
      <div class="balance-card ${state.mode === "demo" ? "primary-balance" : ""}"><div class="balance-top"><span>DEMO BALANCE</span><span class="balance-icon">◈</span></div><strong>${formatMoney(state.demoBalance)}</strong><small><span class="positive">↗ Demo funds</span> · Stored remotely</small></div>
      <div class="balance-card ${state.mode === "live" ? "primary-balance" : ""}"><div class="balance-top"><span>LIVE WALLET</span><span class="balance-icon muted">▤</span></div><strong>${formatMoney(state.liveBalance)}</strong><small>${formatKes(state.liveBalance, walletRate)} · Available balance</small></div>
      <button class="balance-card add-funds" data-view="wallet"><span class="plus">+</span><span><strong>Open wallet</strong><small>Deposit or withdraw funds</small></span><span class="arrow">↗</span></button>
    </section>
    <div class="terminal-grid">
      <section class="panel chart-panel">
        <div class="panel-heading chart-heading">
          <div class="asset-title"><div class="asset-icon">P</div><div><strong>PIPMASTER Market</strong><small>Shared · 1 tick</small></div><span class="live-pill"><i></i> ADMIN-MANAGED</span></div>
          <div class="price-summary"><strong id="current-price">${price.toFixed(2)}</strong><span class="positive" id="price-change">+0.38%</span></div>
        </div>
        <div class="chart-toolbar">
          <div class="chart-tabs"><button class="active">Chart</button><button data-view="history">${state.mode === "live" ? "Demo positions" : "Positions"} <span class="count">${state.trades.filter((trade) => trade.status === "open").length}</span></button></div>
          <div class="timeframes">${["1m", "5m", "15m", "1h"].map((item, index) => `<button class="${index === 0 ? "active" : ""}" data-timeframe="${item}">${item}</button>`).join("")}<button class="chart-tool" title="Chart settings">⚑</button></div>
        </div>
        <div class="chart-wrap"><canvas id="price-chart" aria-label="Shared admin-managed PIPMASTER market chart"></canvas><div class="chart-overlay"><span>PIPMASTER INTERNAL MARKET</span><span id="chart-clock">00:00:00</span></div><div class="chart-watermark">PIP<span>MASTER</span></div></div>
        <div class="chart-legend"><span><i class="legend-line"></i> Price</span><span><i class="legend-dot"></i> Shared market tick</span><span class="chart-source">Server-generated · Supabase</span></div>
      </section>

      <section class="panel trade-panel">
        ${state.mode === "demo" ? `<div class="panel-heading"><div><h2>Place a trade</h2><p>Test your strategy with demo funds.</p></div><span class="demo-label">DEMO</span></div>
        <div class="trade-field"><label>TRADE TYPE</label><div class="segmented" role="tablist"><button class="${state.tradeType === "digits" ? "selected" : ""}" data-trade-type="digits">Even / Odd</button><button class="${state.tradeType === "direction" ? "selected" : ""}" data-trade-type="direction">Over / Under</button></div></div>
        <div class="trade-field"><label>TRADE DURATION <span>Admin demo setting</span></label><div class="duration-select">${[10, 30, 60, 300].map((seconds) => `<button class="${state.duration === seconds ? "selected" : ""}" data-duration="${seconds}">${seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</button>`).join("")}</div></div>
        <div class="trade-field"><label>STAKE <span>Available ${formatMoney(active)}</span></label><div class="stake-control"><button data-stake="-">−</button><div><span>$</span><input id="stake" inputmode="decimal" type="number" min="1" max="${active}" value="${state.stake}" aria-label="Trade stake"></div><button data-stake="+">+</button></div><div class="quick-stakes">${[10, 25, 50, 100].map((amount) => `<button data-quick-stake="${amount}">$${amount}</button>`).join("")}</div></div>
        <div class="payout-preview"><span>Potential return <small>incl. stake</small></span><strong id="potential-return">${formatMoney(state.stake * (1 + state.payout / 100))}</strong><span class="payout-rate">${state.payout}% payout</span></div>
        <div class="trade-actions"><button class="trade-button even" data-choice="${state.tradeType === "digits" ? "even" : "over"}"><span>${state.tradeType === "digits" ? "EVEN" : "OVER"}</span><small>${state.tradeType === "digits" ? "Last digit 0, 2, 4, 6, 8" : "Price finishes above entry"}</small><b>↗</b></button><button class="trade-button odd" data-choice="${state.tradeType === "digits" ? "odd" : "under"}"><span>${state.tradeType === "digits" ? "ODD" : "UNDER"}</span><small>${state.tradeType === "digits" ? "Last digit 1, 3, 5, 7, 9" : "Price finishes below entry"}</small><b>↘</b></button></div>
        <div class="trade-footnote">Demo outcomes use the shared market price when the timer expires.</div>` : `<div class="wallet-live-message"><span class="balance-icon">◈</span><h2>Live market view</h2><p>This shared PIPMASTER market is managed in Admin controls. Demo positions use demo funds; wallet funds remain separate and can be managed in Wallet.</p><button class="auth-primary compact" type="button" data-view="wallet">Open wallet</button></div>`}
      </section>
    </div>

    <section class="lower-grid">
      <section class="panel scanner-panel">
        <div class="panel-heading"><div class="scanner-title"><div class="scanner-icon">✳</div><div><h2>Market Scanner · remote</h2><p>Server-calculated indicators from shared price history</p></div></div><button class="subtle-button" data-action="scan">Run scan <span>↗</span></button></div>
        <div class="scanner-result" id="scanner-result"><div class="scan-meter"><div class="meter-ring">—</div></div><div><span class="eyebrow">MARKET SETUP</span><strong>Scanner ready</strong><p>Analyze recent shared price movement to see an indicator summary.</p></div><span class="scan-badge">REMOTE</span></div>
      </section>
      <section class="panel bots-panel">
        <div class="panel-heading"><div><h2>Strategy bots</h2><p>Rule-based demo helpers</p></div><button class="text-button" data-view="bots">Browse all <span>→</span></button></div>
        <div class="bot-cards">
          ${botCard("Pulse", "Short momentum signals", "Balanced", "↗", "#9d8aff")}
          ${botCard("Sentry", "Trend confirmation", "Conservative", "◉", "#54d5b6")}
          ${botCard("Orbit", "Range movement signals", "Experimental", "◎", "#f6b95d")}
        </div>
        <div class="bot-run-row"><span class="bots-note">Rule-based demo signals only · no guaranteed results.</span><button class="subtle-button" data-action="run-bot">Generate signal</button></div>
        ${botSignal ? `<div class="bot-signal"><div><span class="eyebrow">${escapeHtml(botSignal.bot)} · DEMO SIGNAL</span><strong>${botSignal.choice === "over" ? "OVER" : "UNDER"} · ${botSignal.strength} signal strength</strong><small>Based on chart indicators, not a win probability.</small></div><button class="subtle-button" data-action="use-signal">Use signal</button></div>` : ""}
      </section>
    </section>

    <section class="panel activity-panel">
      <div class="panel-heading"><div><h2>Recent activity</h2><p>Your latest demo positions</p></div><button class="text-button" data-view="history">View activity <span>→</span></button></div>
      ${tradeTable(state.trades.slice(0, 4))}
    </section>`;
}

function botCard(name, description, tier, icon, color) {
  return `<button class="bot-card ${state.selectedBot === name ? "selected" : ""}" data-bot="${escapeHtml(name)}"><span class="bot-symbol" style="--bot-color:${color}">${icon}</span><span class="bot-info"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(description)}</small></span><span class="bot-tier">${escapeHtml(tier)}</span></button>`;
}

function tradeTable(trades) {
  if (!trades.length) return `<div class="empty-state"><span>⌁</span><strong>No trades yet</strong><p>Place a demo trade to see activity here.</p></div>`;
  return `<div class="table-scroll"><table><thead><tr><th>TRADE</th><th>TYPE</th><th>STAKE</th><th>RESULT</th><th>STATUS</th><th>TIME</th></tr></thead><tbody>${trades.map((trade) => `<tr><td><span class="trade-asset-icon">P</span>PIPMASTER Market</td><td><span class="outcome-type ${trade.choice}">${escapeHtml(trade.choice.toUpperCase())}</span></td><td>${formatMoney(trade.stake)}</td><td class="${trade.result > 0 ? "positive" : trade.status === "open" ? "" : "negative"}">${trade.status === "open" ? "—" : `${trade.result > 0 ? "+" : "−"}${formatMoney(Math.abs(trade.result))}`}</td><td><span class="status-badge ${trade.status}">${escapeHtml(trade.status)}</span></td><td>${new Date(trade.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td></tr>`).join("")}</tbody></table></div>`;
}

function historyView() {
  return `<section class="page-heading"><div><div class="eyebrow">ACCOUNT</div><h1>Activity</h1><p>Review wallet transactions and demo positions recorded for your account.</p></div></section><section class="panel activity-panel full-panel"><div class="panel-heading"><div><h2>Wallet transactions</h2><p>${walletTransactions.length} transactions · all amounts in USD</p></div><button class="subtle-button" data-view="wallet">Open wallet</button></div>${walletTransactionsTable(walletTransactions)}</section><section class="panel activity-panel full-panel"><div class="panel-heading"><div><h2>Demo trade history</h2><p>${state.trades.length} positions</p></div><button class="subtle-button" data-action="clear-history">Clear demo history</button></div>${tradeTable(state.trades)}</section>`;
}

function adminView() {
  return `<section class="page-heading"><div><div class="eyebrow">SHARED PIPMASTER MARKET · ADMIN-CONTROLLED</div><h1>Admin controls</h1><p>These settings control the shared market shown in Live and Demo views.</p></div><span class="preview-tag">MARKET SETTINGS</span></section>
    <div class="admin-grid">
      <section class="panel settings-panel"><div class="panel-heading"><div><h2>Shared market</h2><p>Manage the internal PIPMASTER chart.</p></div><span class="setting-icon">⌁</span></div>
        ${rangeSetting("volatility", "Volatility", state.volatility, 0.1, 1, 0.01, `${Math.round(state.volatility * 100)}%`, "Changes the size of market price movements.")}
        ${rangeSetting("drift", "Price drift", state.drift, -0.5, 0.5, 0.01, `${state.drift > 0 ? "+" : ""}${Math.round(state.drift * 100)}%`, "Adds a small upward or downward bias to market prices.")}
        ${rangeSetting("chartSpeed", "Chart speed", state.chartSpeed, 0.5, 2, 0.1, `${state.chartSpeed.toFixed(1)}×`, "Changes how quickly market ticks are drawn.")}
        <div class="setting-block"><div class="setting-label"><div><strong>Demo payout</strong><small>Displayed payout for demo trade calculations.</small></div><div class="range-value"><input type="number" id="payout-input" min="1" max="95" value="${state.payout}">%</div></div><input class="range-input" data-setting="payout" type="range" min="1" max="95" step="1" value="${state.payout}"><div class="setting-hint">Only a demo calculation; not a live contract or guaranteed return.</div></div>
        <div class="setting-block"><div class="setting-label"><div><strong>Trade durations</strong><small>Available demo expiry options.</small></div></div><div class="setting-options">${[10, 30, 60, 300].map((seconds) => `<button class="option-chip ${state.duration === seconds ? "selected" : ""}" data-duration="${seconds}">${seconds < 60 ? `${seconds}s` : `${seconds / 60} min`}</button>`).join("")}</div></div>
      </section>
      <section class="panel admin-side-panel"><div class="panel-heading"><div><h2>My account</h2><p>Supabase account data</p></div><span class="status-badge open">ACTIVE</span></div><div class="admin-stat"><span>Demo balance</span><strong>${formatMoney(state.demoBalance)}</strong></div><div class="admin-stat"><span>My wallet balance</span><strong>${formatMoney(state.liveBalance)}</strong></div><div class="admin-stat"><span>Settled demo trades</span><strong>${state.trades.filter((trade) => trade.status === "closed").length}</strong></div><button class="secondary-button wide" data-action="reset-demo">Reset demo balance</button>
        <div class="admin-separator"></div><div class="admin-helper"><span>ⓘ</span><p>Customer wallet deposits and withdrawals are managed separately from demo positions and market settings.</p></div>
      </section>
    </div>
    <section class="panel bots-admin-panel"><div class="panel-heading"><div><h2>Demo strategies</h2><p>Signals use shared market history and have no fixed win-rate setting.</p></div><span class="eyebrow">RULE-BASED · REMOTE RPC</span></div><div class="strategy-table">${["Pulse|Momentum crossover|Trend-following demo signals","Sentry|Trend confirmation|Requires multiple aligned indicators","Orbit|Range movement|Looks for price movement near recent range"].map((item) => { const [name, type, desc] = item.split("|"); return `<div class="strategy-row"><span class="bot-symbol">${name === "Pulse" ? "↗" : name === "Sentry" ? "◉" : "◎"}</span><div><strong>${name}</strong><small>${type} · ${desc}</small></div><span class="status-badge open">DEMO</span></div>`; }).join("")}</div></section>
    ${walletAdminPanel()}`;
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
        <label>Bank name<input name="bank_name" value="${escapeHtml(settings.bankName || "")}" maxlength="120" required></label>
        <label>Account name<input name="account_name" value="${escapeHtml(settings.accountName || "")}" maxlength="120" required></label>
        <label>Account number<input name="account_number" value="${escapeHtml(settings.accountNumber || "")}" maxlength="120" required></label>
        <label>Branch (optional)<input name="branch_name" value="${escapeHtml(settings.branchName || "")}" maxlength="120"></label>
        <label>SWIFT/BIC (optional)<input name="swift_code" value="${escapeHtml(settings.swiftCode || "")}" maxlength="32"></label>
        <label>USD to KSh rate<input name="usd_to_kes" type="number" min="1" max="100000" step="0.0001" value="${escapeHtml(settings.usdToKes ?? 128)}" required></label>
        <label class="wallet-instructions-field">Deposit instructions<textarea name="deposit_instructions" rows="4" maxlength="2000" required>${escapeHtml(settings.depositInstructions || "")}</textarea></label>
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
    const { data, error } = await supabase.rpc("get_wallet_admin_snapshot");
    if (error) throw error;
    walletAdminData = data;
    walletAdminLoaded = true;
  } catch (error) {
    walletAdminError = error.message || "Could not load wallet administration data.";
    walletAdminLoaded = true;
  } finally {
    walletAdminLoading = false;
    if (state.activeView === "admin") render();
  }
}

function rangeSetting(key, label, value, min, max, step, display, description) {
  return `<div class="setting-block"><div class="setting-label"><div><strong>${label}</strong><small>${description}</small></div><span class="range-value" id="${key}-value">${display}</span></div><input class="range-input" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}

function simpleView(view) {
  if (view === "wallet") return walletView();
  const titles = { bots: ["Strategy bot market", "Explore server-calculated demo helpers. No real bot purchases are available."], profile: ["Profile", "Manage account information stored securely in Supabase."] };
  const [title, subtitle] = titles[view] || ["Page not found", "Choose a page from the navigation."];
  return `<section class="page-heading"><div><div class="eyebrow">PIPMASTER</div><h1>${title}</h1><p>${subtitle}</p></div></section><div class="notice notice-warn"><span>ⓘ</span><div><strong>Demo strategies</strong><p>Bot signals are educational indicators based on shared PIPMASTER market history. They do not execute trades automatically.</p></div></div><section class="bot-list">${["Pulse|Short momentum signals|Balanced","Sentry|Trend confirmation|Conservative","Orbit|Range movement signals|Experimental"].map((bot) => { const [name, description, tier] = bot.split("|"); return `<button class="bot-market-card ${state.selectedBot === name ? "selected" : ""}" data-bot="${name}"><span class="bot-symbol">${name === "Pulse" ? "↗" : name === "Sentry" ? "◉" : "◎"}</span><span><strong>${name}</strong><small>${description}</small></span><span class="bot-tier">${tier}</span><span class="bot-arrow">→</span></button>`; }).join("")}</section>`;
}

function walletView() {
  const pageHeading = `<section class="page-heading"><div><div class="eyebrow">ACCOUNT WALLET</div><h1>Wallet</h1><p>Manage deposits, withdrawals, and your account activity.</p></div>${walletScreen !== "overview" ? `<button class="secondary-button" data-action="wallet-back">Back to wallet</button>` : ""}</section>`;
  if (walletScreen === "terms") {
    return `${pageHeading}<section class="panel funds-terms-panel">${fundsTermsContent()}<button class="auth-link" data-action="wallet-back">Back to wallet</button></section>`;
  }
  if (walletScreen === "deposit" || walletScreen === "withdraw") {
    const isDeposit = walletScreen === "deposit";
    return `${pageHeading}<section class="panel wallet-form-panel">
      <div class="panel-heading"><div><h2>${isDeposit ? "Start a deposit" : "Request a withdrawal"}</h2><p>${isDeposit ? "Enter the amount to view secure bank transfer instructions." : "Choose the amount and bank account for your payout."}</p></div></div>
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
    return `${pageHeading}<section class="panel wallet-form-panel">
      <div class="wallet-success-banner"><strong>Deposit request created</strong><span>Choose either bank transfer or M-PESA Paybill below, then submit the payment reference for confirmation.</span></div>
      <div class="deposit-bank-details">
        <div class="wallet-payment-heading">Bank transfer</div>
        <div><span>Bank</span><strong>${escapeHtml(details.bankName || "")}</strong></div>
        <div><span>Account name</span><strong>${escapeHtml(details.accountName || "")}</strong></div>
        <div><span>Account number</span><strong>${escapeHtml(details.accountNumber || "")}</strong></div>
        ${details.branchName ? `<div><span>Branch</span><strong>${escapeHtml(details.branchName)}</strong></div>` : ""}
        ${details.swiftCode ? `<div><span>SWIFT/BIC</span><strong>${escapeHtml(details.swiftCode)}</strong></div>` : ""}
        <div class="deposit-instructions-copy"><span>Payment instructions</span><p>${escapeHtml(details.instructions || "")}</p></div>
        <div class="paybill-payment-method">
          <div class="paybill-method-heading"><strong>M-PESA Paybill</strong><span class="wallet-free-badge">FREE</span></div>
          <div class="paybill-method-details">
            <div><span>Paybill number</span><strong>${escapeHtml(details.paybillNumber || "522533")}</strong></div>
            <div><span>Account number</span><strong>${escapeHtml(details.paybillAccountNumber || "8126239")}</strong></div>
            <div><span>Account name</span><strong>${escapeHtml(details.paybillAccountName || "PIPMASTER")}</strong></div>
          </div>
          <p>On your phone, open M-PESA and choose <strong>Lipa na M-PESA → Pay Bill</strong>. Enter the Paybill and account numbers above, enter the requested deposit amount, and complete payment. Copy the transaction code from the M-PESA confirmation message.</p>
          <small>PIPMASTER does not charge a fee for Paybill deposits. Your provider may have separate charges.</small>
        </div>
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
  app.querySelector('[data-action="wallet-admin-refresh"]')?.addEventListener("click", () => {
    walletAdminLoaded = false;
    loadWalletAdminData();
  });
  app.querySelectorAll('[data-action="review-wallet"]').forEach((button) => button.addEventListener("click", reviewWalletRequest));
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
  app.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.mode; render(); }));
  app.querySelectorAll("[data-trade-type]").forEach((button) => button.addEventListener("click", () => {
    state.tradeType = button.dataset.tradeType;
    render();
  }));
  app.querySelectorAll("[data-duration]").forEach((button) => button.addEventListener("click", () => { state.duration = Number(button.dataset.duration); render(); }));
  app.querySelectorAll("[data-bot]").forEach((button) => button.addEventListener("click", () => {
    state.selectedBot = button.dataset.bot;
    app.querySelectorAll("[data-bot]").forEach((item) => item.classList.toggle("selected", item.dataset.bot === state.selectedBot));
    showToast(`${state.selectedBot} demo strategy selected`);
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
    if (state.mode !== "demo") {
      showToast("Switch to Demo to use a strategy signal. Live view shows the shared admin-managed market.");
      return;
    }
    state.tradeType = "direction";
    state.activeView = "trade";
    render();
    await placeTrade(botSignal.choice);
  });
  app.querySelectorAll("[data-timeframe]").forEach((button) => button.addEventListener("click", () => {
    app.querySelectorAll("[data-timeframe]").forEach((item) => item.classList.toggle("active", item === button));
    showToast(`${button.dataset.timeframe} chart interval selected`);
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

async function reviewWalletRequest(event) {
  const button = event.currentTarget;
  const approve = button.dataset.approve === "true";
  const request = (walletAdminData?.requests || []).find((item) => item.id === button.dataset.id);
  if (!request) {
    showToast("This wallet request is no longer available. Refresh the request list.");
    return;
  }
  const action = approve
    ? request.type === "deposit" ? "confirm this deposit after verifying the bank or Paybill payment" : "confirm this withdrawal after sending the bank payout"
    : "reject this wallet request";
  if (!window.confirm(`Are you sure you want to ${action}?`)) return;

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
    showToast(`Could not review wallet request: ${error.message}`);
    return;
  }
  try {
    await refreshWalletSnapshot();
  } catch (refreshError) {
    showToast(`Request updated, but wallet refresh failed: ${refreshError.message}`);
  }
  walletAdminLoaded = false;
  await loadWalletAdminData();
  showToast(approve ? "Wallet request confirmed." : "Wallet request rejected.");
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
  if (state.mode !== "demo") {
    showToast("Switch to Demo to place a demo position. Live view shows the shared admin-managed market.");
    return;
  }
  const stake = Number(app.querySelector("#stake")?.value);
  if (!Number.isFinite(stake) || stake <= 0 || stake > state.demoBalance) {
    showToast("Enter a valid stake within your demo balance.");
    return;
  }
  const { error } = await supabase.rpc("place_demo_trade", {
    p_choice: choice,
    p_stake: stake,
    p_duration_seconds: state.duration,
  });
  if (error) {
    showToast(`Could not place remote demo trade: ${error.message}`);
    return;
  }
  try {
    await refreshTerminalSnapshot();
    render();
    showToast(`Demo ${choice.toUpperCase()} position opened · ${state.duration}s`);
  } catch (refreshError) {
    showToast(`Trade opened, but refresh failed: ${refreshError.message}`);
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
  const { data, error } = await supabase.rpc("analyze_market", { p_strategy: "scanner" });
  if (error) {
    showToast(`Could not run remote market scanner: ${error.message}`);
    return;
  }
  const result = app.querySelector("#scanner-result");
  if (result) result.innerHTML = `<div class="scan-meter"><div class="meter-ring">${Number(data.strength)}<small>%</small></div></div><div><span class="eyebrow">SIGNAL STRENGTH · NOT WIN ODDS</span><strong>${escapeHtml(data.direction)}</strong><p>${escapeHtml(data.advice)}. Server-calculated from the shared market history; not financial advice or a win probability.</p></div><span class="scan-badge">REMOTE</span>`;
}

async function runBot() {
  const { data, error } = await supabase.rpc("analyze_market", { p_strategy: state.selectedBot });
  if (error) {
    showToast(`Could not generate remote strategy signal: ${error.message}`);
    return;
  }
  if (!data.signal) {
    botSignal = null;
    render();
    showToast(`${state.selectedBot}: no clear demo setup right now.`);
    return;
  }
  botSignal = {
    bot: state.selectedBot,
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
    if (Date.now() - walletLastAttemptAt >= 10000) {
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
    if (pollVersion === chartPollVersion) {
      chartTimer = window.setTimeout(poll, Math.max(250, Math.min(2000, 900 / state.chartSpeed)));
    }
  };
  poll();
}

function drawChart(canvas) {
  if (!canvas || chartPoints.length === 0) return;
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
  ctx.strokeStyle = "rgba(151,168,190,.09)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 16 + (height - 32) * i / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const x = width * i / 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  const points = chartPoints;
  const ys = points.map((point) => point.y);
  const min = Math.min(...ys) - 0.07;
  const max = Math.max(...ys) + 0.07;
  const range = Math.max(max - min, 1);
  const mapped = points.map((point, index) => ({
    x: points.length === 1 ? width / 2 : index / (points.length - 1) * width,
    y: height - 14 - ((point.y - min) / range) * (height - 28),
  }));
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(55, 207, 165, .20)");
  gradient.addColorStop(1, "rgba(55, 207, 165, 0)");
  ctx.beginPath();
  mapped.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  mapped.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = "#40d8a6";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
  const current = mapped[mapped.length - 1];
  ctx.beginPath();
  ctx.arc(current.x, current.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#42d8a6";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(current.x, current.y, 8, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(66,216,166,.28)";
  ctx.stroke();
}

window.addEventListener("resize", () => {
  const canvas = document.querySelector("#price-chart");
  if (canvas) drawChart(canvas);
});

beginAuth();
