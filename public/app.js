/**
 * A&B Tools Business Manager — Client Application Logic
 * Mobile-First Ledger & Admin Panel (English UI)
 */

// Application State
const STATE = {
  pinSet: false,
  unlocked: false,
  currentPeriod: 'today', // today, yesterday, week, month, all
  currentView: 'salesView',
  data: {
    sales: [],
    expenses: [],
    products: [],
    settings: {
      businessName: 'A&B Tools Business Manager',
      currency: 'Rs.'
    }
  },
  enteredPin: ''
};

// Default WhatsApp Message Templates (Individually customizable)
const DEFAULT_TEMPLATES = {
  expiry: 'Hello {customer}! Notice from {business}: Your {product} ({account}) expires on {expiry}. Kindly renew to keep uninterrupted access. Thank you!',
  pending: 'Hello {customer}! Friendly reminder from {business}: The payment of {currency} {amount} for your {product} ({plan}) is currently pending. Kindly clear the dues at your earliest convenience. Thank you!',
  welcome: 'Assalam-o-Alaikum {customer}! Thank you for choosing {business}. Here are your {product} ({plan}) details:\nLogin: {account}\nExpiry: {expiry}\nAmount: {currency} {amount}\nHave a great experience!',
  paid: 'Dear {customer}, we have received your payment of {currency} {amount} for {product} ({plan}). Thank you for trusting {business}!'
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  setupViewportKeyboardHandling();
  setupEventListeners();
  setupTouchNumpad();
  await checkPinStatus();
  setDefaultDates();
  startDailyDateWatcher();
  startRealtimeSync();
});

// Auto-adjust focused fields when mobile virtual keyboard opens without sluggish scroll locks
function setupViewportKeyboardHandling() {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT' || activeElement.tagName === 'TEXTAREA')) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    });
  }
}

// Check PIN setup status (Instant 0ms UI with background server sync)
async function checkPinStatus() {
  const localPin = localStorage.getItem('ab_tools_pin');
  const savedSession = sessionStorage.getItem('ab_tools_unlocked');

  // Instant response: if already unlocked in this browser session, open dashboard immediately (0ms)
  if (savedSession === 'true') {
    STATE.unlocked = true;
    STATE.pinSet = true;
    document.getElementById('pinGateModal').classList.remove('active');
    loadAppData();
  } else {
    // Show PIN Gate immediately based on local storage cache (0ms)
    STATE.pinSet = !!localPin;
    showPinGate();
  }

  // Background sync with server
  try {
    let res = await fetch('/api/status');
    let data = await res.json();
    STATE.pinSet = data.pinSet;
    if (!STATE.unlocked) {
      showPinGate();
    }
  } catch (err) {
    console.warn('Background sync status check:', err);
  }
}

function showPinGate() {
  const pinGate = document.getElementById('pinGateModal');
  const setupBox = document.getElementById('pinSetupContainer');
  const unlockBox = document.getElementById('pinUnlockContainer');

  pinGate.classList.add('active');
  STATE.enteredPin = '';
  updatePinDots();

  if (!STATE.pinSet) {
    setupBox.style.display = 'block';
    unlockBox.style.display = 'none';
  } else {
    setupBox.style.display = 'none';
    unlockBox.style.display = 'block';
  }
}

// ==================== TOUCH NUMPAD & PIN SYSTEM ====================
function setupTouchNumpad() {
  const numpadBtns = document.querySelectorAll('.numpad-btn[data-key]');
  numpadBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const key = btn.getAttribute('data-key');
      if (STATE.enteredPin.length < 6) {
        STATE.enteredPin += key;
        updatePinDots();
        if (STATE.enteredPin.length === 4) {
          setTimeout(handleUnlockSubmit, 180);
        }
      }
    });
  });

  const clearBtn = document.getElementById('btnClearPin');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      STATE.enteredPin = '';
      updatePinDots();
      document.getElementById('pinUnlockError').textContent = '';
    });
  }

  const backspaceBtn = document.getElementById('btnBackspacePin');
  if (backspaceBtn) {
    backspaceBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (STATE.enteredPin.length > 0) {
        STATE.enteredPin = STATE.enteredPin.slice(0, -1);
        updatePinDots();
      }
    });
  }

  // Keyboard navigation support
  window.addEventListener('keydown', (e) => {
    if (!STATE.unlocked && STATE.pinSet) {
      if (e.key >= '0' && e.key <= '9') {
        if (STATE.enteredPin.length < 6) {
          STATE.enteredPin += e.key;
          updatePinDots();
          if (STATE.enteredPin.length === 4) {
            setTimeout(handleUnlockSubmit, 180);
          }
        }
      } else if (e.key === 'Backspace') {
        STATE.enteredPin = STATE.enteredPin.slice(0, -1);
        updatePinDots();
      } else if (e.key === 'Enter') {
        handleUnlockSubmit();
      }
    }
  });
}

function updatePinDots() {
  const dots = document.querySelectorAll('#pinDotsDisplay .pin-dot');
  dots.forEach((dot, index) => {
    if (index < STATE.enteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

async function handleUnlockSubmit() {
  const errEl = document.getElementById('pinUnlockError');
  errEl.textContent = '';

  if (STATE.enteredPin.length < 4) {
    errEl.textContent = 'Please enter at least 4 digits';
    shakePinCard();
    return;
  }

  // Always verify PIN directly with server so PIN changes on other devices sync immediately
  try {
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: STATE.enteredPin })
    });
    const result = await res.json();

    if (res.ok) {
      STATE.unlocked = true;
      localStorage.setItem('ab_tools_pin', STATE.enteredPin);
      sessionStorage.setItem('ab_tools_unlocked', 'true');
      document.getElementById('pinGateModal').classList.remove('active');
      showToast('Welcome back! Dashboard unlocked 🔓');
      loadAppData();
    } else {
      errEl.textContent = result.error || 'Incorrect PIN! Please try again';
      STATE.enteredPin = '';
      updatePinDots();
      shakePinCard();
    }
  } catch (err) {
    // Offline fallback: if network is down and entered PIN matches cached PIN, allow offline access
    const localPin = localStorage.getItem('ab_tools_pin');
    if (localPin && STATE.enteredPin === localPin) {
      STATE.unlocked = true;
      sessionStorage.setItem('ab_tools_unlocked', 'true');
      document.getElementById('pinGateModal').classList.remove('active');
      showToast('Welcome back! (Offline Mode) 🔓');
      loadAppData();
      return;
    }
    errEl.textContent = 'Network error or incorrect PIN!';
    STATE.enteredPin = '';
    updatePinDots();
    shakePinCard();
  }
}

// First time PIN setup
async function handlePinSetup() {
  const newPin = document.getElementById('newPinInput').value.trim();
  const confirmPin = document.getElementById('confirmPinInput').value.trim();
  const errEl = document.getElementById('pinSetupError');
  errEl.textContent = '';

  if (newPin.length < 4) {
    errEl.textContent = 'PIN must be at least 4 digits long';
    return;
  }
  if (newPin !== confirmPin) {
    errEl.textContent = 'PINs do not match. Please re-enter';
    return;
  }

  try {
    const res = await fetch('/api/auth/setup-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: newPin })
    });
    const result = await res.json();

    if (res.ok) {
      localStorage.setItem('ab_tools_pin', newPin);
      STATE.pinSet = true;
      STATE.unlocked = true;
      sessionStorage.setItem('ab_tools_unlocked', 'true');
      document.getElementById('pinGateModal').classList.remove('active');
      showToast('Your secret PIN has been configured & auto-saved! 🎉');
      triggerAutoSaveSync();
      await loadAppData();
    } else {
      errEl.textContent = result.error || 'Failed to save PIN';
    }
  } catch (err) {
    localStorage.setItem('ab_tools_pin', newPin);
    STATE.pinSet = true;
    STATE.unlocked = true;
    sessionStorage.setItem('ab_tools_unlocked', 'true');
    document.getElementById('pinGateModal').classList.remove('active');
    showToast('PIN configured successfully (Offline Mode) 🎉');
    triggerAutoSaveSync();
    loadAppData();
  }
}

function shakePinCard() {
  const card = document.querySelector('.pin-gate-card');
  card.style.animation = 'none';
  card.offsetHeight;
  card.style.animation = 'shake 0.4s ease';
}

function saveLocalState() {
  STATE.data.settings = STATE.data.settings || {};
  const ts = Date.now();
  STATE.data.settings.lastModified = ts;
  try {
    localStorage.setItem('ab_tools_cache', JSON.stringify(STATE.data));
    localStorage.setItem('ab_tools_last_modified', String(ts));
  } catch (e) {
    console.warn('localStorage save warning:', e);
  }
}

// Visual Auto-Save & Sync Badge Indicator
function updateSyncBadge(status) {
  const badge = document.getElementById('liveSyncBadge');
  if (!badge) return;
  if (status === 'syncing') {
    badge.innerHTML = '<span class="sync-dot pulse"></span> Auto-Saving...';
    badge.className = 'sync-status-badge syncing';
  } else if (status === 'synced') {
    badge.innerHTML = '<span class="sync-dot success"></span> Saved &amp; Synced';
    badge.className = 'sync-status-badge synced';
  } else if (status === 'offline') {
    badge.innerHTML = '<span class="sync-dot warning"></span> Saved Locally';
    badge.className = 'sync-status-badge offline';
  }
}

let autoSyncTimer = null;
let isSyncInProgress = false;

// Trigger instant cloud auto-save on any edit without needing page refresh
function triggerAutoSaveSync() {
  saveLocalState();
  updateSyncBadge('syncing');
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    performServerSync();
  }, 100);
}

// Real-time synchronization with server
async function performServerSync() {
  if (isSyncInProgress) return;
  isSyncInProgress = true;
  updateSyncBadge('syncing');

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sales: STATE.data.sales || [],
        expenses: STATE.data.expenses || [],
        products: STATE.data.products || [],
        settings: STATE.data.settings || {},
        pin: localStorage.getItem('ab_tools_pin')
      })
    });

    if (res.ok) {
      const serverResult = await res.json();
      if (serverResult && serverResult.success) {
        const ignoredSaleIds = ['sale_1790808573942_ktuq', 'sale_1790891345201_z6tu'];
        const combinedDeletedSales = Array.from(new Set([
          ...(STATE.data.settings?.deletedSaleIds || []),
          ...(serverResult.settings?.deletedSaleIds || []),
          ...ignoredSaleIds
        ]));
        const combinedDeletedExpenses = Array.from(new Set([
          ...(STATE.data.settings?.deletedExpenseIds || []),
          ...(serverResult.settings?.deletedExpenseIds || [])
        ]));

        const mergedSales = mergeClientRecords(STATE.data.sales, serverResult.sales, combinedDeletedSales);
        const mergedExpenses = mergeClientRecords(STATE.data.expenses, serverResult.expenses, combinedDeletedExpenses);

        const salesChanged = mergedSales.length !== (STATE.data.sales || []).length;
        const expChanged = mergedExpenses.length !== (STATE.data.expenses || []).length;
        const prodsChanged = JSON.stringify(serverResult.products || []) !== JSON.stringify(STATE.data.products || []);
        const settingsChanged = JSON.stringify(serverResult.settings || {}) !== JSON.stringify(STATE.data.settings || {});

        STATE.data.sales = mergedSales;
        STATE.data.expenses = mergedExpenses;
        if (serverResult.products && serverResult.products.length) {
          STATE.data.products = serverResult.products;
        }
        STATE.data.settings = {
          ...STATE.data.settings,
          ...(serverResult.settings || {}),
          deletedSaleIds: combinedDeletedSales,
          deletedExpenseIds: combinedDeletedExpenses
        };

        if (serverResult.pin && String(serverResult.pin).length >= 4) {
          const currentLocalPin = localStorage.getItem('ab_tools_pin');
          if (currentLocalPin !== serverResult.pin) {
            localStorage.setItem('ab_tools_pin', serverResult.pin);
          }
        }

        saveLocalState();
        syncSettingsFormUI();

        if (salesChanged || expChanged || prodsChanged || settingsChanged) {
          populateProductDropdowns();
          renderAdminCatalog();
          renderApp();
        }
        updateSyncBadge('synced');
      }
    } else {
      updateSyncBadge('offline');
    }
  } catch (err) {
    console.warn('Real-time sync error:', err);
    updateSyncBadge('offline');
  } finally {
    isSyncInProgress = false;
  }
}

function syncSettingsFormUI() {
  const settings = STATE.data.settings || {};
  const nameInput = document.getElementById('settingBusinessNameInput');
  const currInput = document.getElementById('settingCurrencyInput');
  const tplExpiry = document.getElementById('settingTplExpiry');
  const tplPending = document.getElementById('settingTplPending');
  const tplWelcome = document.getElementById('settingTplWelcome');
  const tplPaid = document.getElementById('settingTplPaid');

  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = settings.businessName || 'A&B Tools Business Manager';
  }
  if (currInput && document.activeElement !== currInput) {
    currInput.value = settings.currency || 'Rs.';
  }
  if (tplExpiry && document.activeElement !== tplExpiry) {
    tplExpiry.value = (settings.templateExpiry !== undefined && settings.templateExpiry !== '') ? settings.templateExpiry : DEFAULT_TEMPLATES.expiry;
  }
  if (tplPending && document.activeElement !== tplPending) {
    tplPending.value = (settings.templatePending !== undefined && settings.templatePending !== '') ? settings.templatePending : DEFAULT_TEMPLATES.pending;
  }
  if (tplWelcome && document.activeElement !== tplWelcome) {
    tplWelcome.value = (settings.templateWelcome !== undefined && settings.templateWelcome !== '') ? settings.templateWelcome : DEFAULT_TEMPLATES.welcome;
  }
  if (tplPaid && document.activeElement !== tplPaid) {
    tplPaid.value = (settings.templatePaid !== undefined && settings.templatePaid !== '') ? settings.templatePaid : DEFAULT_TEMPLATES.paid;
  }

  const currencyStr = settings.currency || 'Rs.';
  document.querySelectorAll('.currency').forEach(el => {
    el.textContent = currencyStr;
  });

  const brandTitle = document.querySelector('.header-title');
  if (brandTitle && settings.businessName) {
    brandTitle.textContent = settings.businessName;
  }
  if (settings.businessName) {
    document.title = settings.businessName;
  }
}

// Background cross-device sync loop (Phone <-> Laptop)
function startRealtimeSync() {
  // Sync every 6 seconds in background
  setInterval(() => {
    if (STATE.unlocked) {
      performServerSync();
    }
  }, 6000);

  // Sync immediately when phone tab/screen is brought to foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && STATE.unlocked) {
      performServerSync();
    }
  });

  // Sync immediately on window focus
  window.addEventListener('focus', () => {
    if (STATE.unlocked) {
      performServerSync();
    }
  });
}

// Smart non-destructive record merge helper
function mergeClientRecords(localList = [], serverList = [], deletedIds = []) {
  const deletedSet = new Set(deletedIds || []);
  const map = new Map();

  // First seed with server records that are not deleted
  for (const item of (serverList || [])) {
    if (item && item.id && !deletedSet.has(item.id)) {
      map.set(item.id, item);
    }
  }

  // Then merge local records: keep local or newer record
  for (const item of (localList || [])) {
    if (item && item.id && !deletedSet.has(item.id)) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      } else {
        const serverItem = map.get(item.id);
        const localTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
        const serverTime = new Date(serverItem.updatedAt || serverItem.createdAt || 0).getTime();
        if (localTime >= serverTime) {
          map.set(item.id, item);
        }
      }
    }
  }

  // Sort descending by date, then createdAt
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const dDiff = (b.date || '').localeCompare(a.date || '');
    if (dDiff !== 0) return dDiff;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
  return list;
}

// ==================== LOAD & SYNC DATA (Instant Stale-While-Revalidate + Non-Destructive Merge) ====================
async function loadAppData() {
  const ignoredSaleIds = new Set(['sale_1790808573942_ktuq', 'sale_1790891345201_z6tu']);

  // 1. Instant Cache Render (0ms latency)
  const cached = localStorage.getItem('ab_tools_cache');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        parsed.settings = parsed.settings || {};
        parsed.settings.deletedSaleIds = parsed.settings.deletedSaleIds || [];
        ignoredSaleIds.forEach(id => {
          if (!parsed.settings.deletedSaleIds.includes(id)) parsed.settings.deletedSaleIds.push(id);
        });
        const delSet = new Set(parsed.settings.deletedSaleIds);
        if (parsed.sales) {
          parsed.sales = parsed.sales.filter(s => s && s.id && !delSet.has(s.id) && !ignoredSaleIds.has(s.id));
        }
        STATE.data = parsed;
        syncSettingsFormUI();
        populateProductDropdowns();
        renderAdminCatalog();
        renderApp();
      }
    } catch (e) {
      console.warn('Error reading cache:', e);
    }
  }

  // 2. Instant Sync with Server (fetches fresh changes + auto-pushes local changes)
  await performServerSync();
}

function populateProductDropdowns() {
  const productSelect = document.getElementById('saleProductSelect');
  const filterSelect = document.getElementById('salesFilterProduct');
  if (!productSelect) return;

  const products = STATE.data.products || [];
  const uniqueNames = [...new Set(products.map(p => p.name))];

  productSelect.innerHTML = uniqueNames.map(name => `<option value="${name}">${name}</option>`).join('');

  if (filterSelect) {
    filterSelect.innerHTML = '<option value="ALL">All Products</option>' + 
      uniqueNames.map(name => `<option value="${name}">${name}</option>`).join('');
  }

  onProductChange();
}

function onProductChange() {
  const productSelect = document.getElementById('saleProductSelect');
  const typeSelect = document.getElementById('saleTypeSelect');
  if (!productSelect || !typeSelect) return;

  const selProdName = productSelect.value;
  const matchingProducts = (STATE.data.products || []).filter(p => p.name === selProdName);
  const availableTypes = matchingProducts.map(p => p.type || 'Shared');

  if (availableTypes.length > 0) {
    const currentType = typeSelect.value;
    typeSelect.innerHTML = availableTypes.map(t => `<option value="${t}">${t}</option>`).join('');
    if (availableTypes.includes(currentType)) {
      typeSelect.value = currentType;
    } else {
      typeSelect.value = availableTypes[0];
    }
  }

  updatePlansForProductAndType();
}

function onProductOrTypeChange() {
  updatePlansForProductAndType();
}

function updatePlansForProductAndType() {
  const productSelect = document.getElementById('saleProductSelect');
  const typeSelect = document.getElementById('saleTypeSelect');
  const planSelect = document.getElementById('salePlanSelect');
  const amountInput = document.getElementById('saleAmountInput');

  if (!productSelect || !typeSelect || !planSelect) return;

  const selProdName = productSelect.value;
  const selType = typeSelect.value;

  const product = (STATE.data.products || []).find(p => p.name === selProdName && p.type === selType) 
               || (STATE.data.products || []).find(p => p.name === selProdName);

  if (product && product.plans && product.plans.length > 0) {
    planSelect.innerHTML = product.plans.map(pl => `
      <option value="${pl.months}" data-price="${pl.price}" data-label="${pl.label}">
        ${pl.label} — Rs. ${pl.price}
      </option>
    `).join('');

    const firstPlan = product.plans[0];
    amountInput.value = firstPlan.price;
  } else {
    planSelect.innerHTML = `
      <option value="1" data-price="0" data-label="1 Month (30 Days)">1 Month (30 Days)</option>
      <option value="2" data-price="0" data-label="2 Months (60 Days)">2 Months (60 Days)</option>
      <option value="3" data-price="0" data-label="3 Months (90 Days)">3 Months (90 Days)</option>
      <option value="6" data-price="0" data-label="6 Months (180 Days)">6 Months (180 Days)</option>
      <option value="12" data-price="0" data-label="12 Months (360 Days)">12 Months (360 Days)</option>
      <option value="18" data-price="0" data-label="18 Months (540 Days)">18 Months (540 Days)</option>
    `;
  }

  updateLiveExpiryPreview();
}

function onPlanChange() {
  const planSelect = document.getElementById('salePlanSelect');
  const amountInput = document.getElementById('saleAmountInput');
  const selectedOption = planSelect.options[planSelect.selectedIndex];
  if (selectedOption) {
    const price = selectedOption.getAttribute('data-price');
    if (price && Number(price) > 0) {
      amountInput.value = price;
    }
  }
  updateLiveExpiryPreview();
}

// ==================== DATE SYSTEM & TIMEZONE HELPERS ====================
// Always returns exact local device date in YYYY-MM-DD format (avoids UTC timezone shift bug)
function getLocalTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalYesterdayDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFormattedLiveDate() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = days[d.getDay()];
  const dayNum = String(d.getDate()).padStart(2, '0');
  const monthName = months[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName}, ${dayNum} ${monthName} ${year}`;
}

let lastCheckedLocalDate = getLocalTodayDateString();

function startDailyDateWatcher() {
  updateLiveDateBadge();
  // Check every 30 seconds for midnight date change
  setInterval(() => {
    updateLiveDateBadge();
    const currentLocalDate = getLocalTodayDateString();
    if (currentLocalDate !== lastCheckedLocalDate) {
      lastCheckedLocalDate = currentLocalDate;
      setDefaultDates();
      renderApp();
      console.log('📅 Date rolled over to new day:', currentLocalDate);
    }
  }, 30000);
}

function updateLiveDateBadge() {
  const badge = document.getElementById('liveDateDisplay');
  if (badge) {
    badge.textContent = getFormattedLiveDate();
  }
}

// ==================== INCLUSIVE EXPIRY DATE CALCULATION ====================
// Formula: expiry = purchase date + (plan months * 30 - 1 day)
function calculateExpiry(purchaseDateStr, months) {
  if (!purchaseDateStr) return '';
  const [y, m, d] = purchaseDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const daysToAdd = (Number(months) * 30) - 1;
  date.setDate(date.getDate() + daysToAdd);

  const resY = date.getFullYear();
  const resM = String(date.getMonth() + 1).padStart(2, '0');
  const resD = String(date.getDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

function updateLiveExpiryPreview() {
  const dateInput = document.getElementById('saleDateInput');
  const planSelect = document.getElementById('salePlanSelect');
  const previewEl = document.getElementById('saleExpiryPreview');
  if (!dateInput || !planSelect || !previewEl) return;

  const dateVal = dateInput.value || getLocalTodayDateString();
  const months = Number(planSelect.value) || 1;
  const expiry = calculateExpiry(dateVal, months);
  previewEl.textContent = formatDateDisplay(expiry) + ` (${expiry})`;
}

// ==================== PERIOD FILTERING & STATS ====================
function isDateInPeriod(dateStr, period) {
  if (!dateStr || period === 'all') return true;

  const todayStr = getLocalTodayDateString();
  if (period === 'today') {
    return dateStr === todayStr;
  }

  if (period === 'yesterday') {
    const yesterdayStr = getLocalYesterdayDateString();
    return dateStr === yesterdayStr;
  }

  const itemDate = new Date(dateStr + 'T00:00:00');
  const today = new Date(todayStr + 'T00:00:00');

  if (period === 'week') {
    const diffTime = today - itemDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  }

  if (period === 'month') {
    return itemDate.getFullYear() === today.getFullYear() && itemDate.getMonth() === today.getMonth();
  }

  return true;
}

function renderApp() {
  renderKPIs();

  // Instant render for the currently visible view (0ms latency)
  if (STATE.currentView === 'salesView') {
    renderSales();
  } else if (STATE.currentView === 'expensesView') {
    renderExpenses();
  } else if (STATE.currentView === 'pendingView') {
    renderPendingPayments();
  } else if (STATE.currentView === 'remindersView') {
    renderReminders();
  } else if (STATE.currentView === 'adminView') {
    renderAdminCatalog();
  }

  // Defer rendering inactive background tabs to avoid blocking user interactions
  const defer = window.requestIdleCallback || ((cb) => setTimeout(cb, 30));
  defer(() => {
    if (STATE.currentView !== 'salesView') renderSales();
    if (STATE.currentView !== 'expensesView') renderExpenses();
    if (STATE.currentView !== 'pendingView') renderPendingPayments();
    if (STATE.currentView !== 'remindersView') renderReminders();
    if (STATE.currentView !== 'adminView') renderAdminCatalog();
  });
}

function renderKPIs() {
  const period = STATE.currentPeriod;
  const sales = STATE.data.sales || [];
  const expenses = STATE.data.expenses || [];

  const filteredSales = sales.filter(s => isDateInPeriod(s.date, period));
  const filteredExpenses = expenses.filter(e => isDateInPeriod(e.date, period));

  const totalRevenue = filteredSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const totalExpense = filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const netProfit = totalRevenue - totalExpense;

  const filteredPendingSales = filteredSales.filter(s => s.paymentStatus === 'Pending' || s.paymentStatus === 'Unpaid');
  const filteredPendingTotal = filteredPendingSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  document.getElementById('kpiRevenue').textContent = totalRevenue.toLocaleString('en-US');
  document.getElementById('kpiExpense').textContent = totalExpense.toLocaleString('en-US');

  const profitCard = document.getElementById('kpiProfitCard');
  const profitValEl = document.getElementById('kpiProfit');
  profitValEl.textContent = netProfit.toLocaleString('en-US');

  if (netProfit >= 0) {
    profitCard.classList.remove('profit-negative');
    profitCard.classList.add('profit-positive');
  } else {
    profitCard.classList.remove('profit-positive');
    profitCard.classList.add('profit-negative');
  }

  document.getElementById('kpiSalesCount').textContent = filteredSales.length;
  document.getElementById('kpiExpenseCount').textContent = filteredExpenses.length;
  document.getElementById('kpiPendingAmount').textContent = filteredPendingTotal.toLocaleString('en-US');
  document.getElementById('kpiPendingCount').textContent = filteredPendingSales.length;

  document.getElementById('navSalesCount').textContent = filteredSales.length;
  document.getElementById('navExpenseCount').textContent = filteredExpenses.length;
  document.getElementById('navPendingCount').textContent = filteredPendingSales.length;
  document.getElementById('pendingTabTotal').textContent = filteredPendingTotal.toLocaleString('en-US');
}

// ==================== RENDER SALES LIST ====================
function renderSales() {
  const container = document.getElementById('salesListContainer');
  if (!container) return;

  const productFilter = document.getElementById('salesFilterProduct')?.value || 'ALL';
  const statusFilter = document.getElementById('salesFilterStatus')?.value || 'ALL';
  const period = STATE.currentPeriod;

  let list = (STATE.data.sales || []).filter(s => isDateInPeriod(s.date, period));

  if (productFilter !== 'ALL') {
    list = list.filter(s => s.product === productFilter);
  }
  if (statusFilter !== 'ALL') {
    list = list.filter(s => s.paymentStatus === statusFilter);
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">No sales found for this period</div>
        <p class="text-muted mt-2">Click '+ New Sale' to record a transaction</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(s => renderSaleCardHtml(s)).join('');
}

function renderSaleCardHtml(s) {
  const statusClass = s.paymentStatus === 'Paid' ? 'status-paid' : (s.paymentStatus === 'Pending' ? 'status-pending' : 'status-unpaid');
  const daysLeft = calculateDaysRemaining(s.expiryDate);
  const isExpiringSoon = daysLeft !== null && daysLeft <= 1;

  return `
    <div class="item-card" data-sale-id="${s.id}">
      <div class="item-card-header">
        <div class="item-user-info">
          <span class="user-phone-badge">${formatPhone(s.customerPhone)}</span>
          ${s.customerName ? `<span class="user-name-tag">${escapeHtml(s.customerName)}</span>` : ''}
        </div>
        <div class="item-price-tag">
          <span class="currency-sm">Rs.</span>
          <span class="amount-text">${(s.amount || 0).toLocaleString('en-US')}</span>
        </div>
      </div>

      <div class="item-details-grid">
        <div class="detail-item">
          <span class="detail-label">Product &amp; Type</span>
          <span class="detail-value text-gold"><strong>${escapeHtml(s.product)}</strong> (${escapeHtml(s.accountType || 'Shared')})</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Assigned Account</span>
          <span class="detail-value account-email">
            ${escapeHtml(s.accountLogin)}
            <button class="btn-xs btn-outline ml-1" title="Copy Login" onclick="copyText('${escapeHtml(s.accountLogin)}')">📋 Copy</button>
          </span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Plan &amp; Purchase Date</span>
          <span class="detail-value">${escapeHtml(s.planLabel || s.planMonths + ' Month(s)')} · ${formatDateDisplay(s.date)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Expiry Date</span>
          <span class="detail-value font-mono ${isExpiringSoon ? 'text-rose font-bold' : ''}">
            ${formatDateDisplay(s.expiryDate)} ${formatDaysBadge(daysLeft)}
          </span>
        </div>
      </div>

      ${s.notes ? `<div class="detail-item mb-3"><span class="detail-label">Notes:</span> <span class="detail-value text-muted">${escapeHtml(s.notes)}</span></div>` : ''}

      <div class="item-actions-bar">
        <div class="badges-group">
          <span class="status-badge ${statusClass}">${s.paymentStatus}</span>
          ${s.paymentStatus !== 'Paid' ? `
            <button class="btn btn-xs btn-gold" onclick="markSalePaid('${s.id}')">✓ Mark Paid</button>
          ` : ''}
        </div>

        <div class="item-btn-group">
          <button class="btn-whatsapp" onclick="sendWhatsAppReminder('${s.id}')">
            <span>💬 WhatsApp</span>
          </button>
          <button class="btn-action-icon" title="Edit Sale" onclick="openEditSale('${s.id}')">✏️</button>
          <button class="btn-action-icon btn-action-delete" title="Delete Sale" onclick="deleteSale('${s.id}')">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

// ==================== RENDER EXPENSES LIST ====================
function renderExpenses() {
  const container = document.getElementById('expensesListContainer');
  if (!container) return;

  const period = STATE.currentPeriod;
  const list = (STATE.data.expenses || []).filter(e => isDateInPeriod(e.date, period));

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💸</div>
        <div class="empty-state-title">No expenses recorded for this period</div>
        <p class="text-muted mt-2">Click '+ New Expense' to log an expense</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(e => `
    <div class="item-card">
      <div class="expense-card-main">
        <div>
          <span class="expense-category-pill">${escapeHtml(e.category)}</span>
          <div class="expense-desc-text">${escapeHtml(e.description || e.category)}</div>
          <div class="expense-meta-text mt-1">Date: ${formatDateDisplay(e.date)}</div>
        </div>
        <div class="text-right">
          <div class="amount-text text-rose">- Rs. ${(e.amount || 0).toLocaleString('en-US')}</div>
          <div class="item-btn-group mt-2 justify-end">
            <button class="btn-action-icon" title="Edit Expense" onclick="openEditExpense('${e.id}')">✏️</button>
            <button class="btn-action-icon btn-action-delete" title="Delete Expense" onclick="deleteExpense('${e.id}')">🗑️</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// ==================== RENDER PENDING PAYMENTS ====================
function renderPendingPayments() {
  const container = document.getElementById('pendingListContainer');
  if (!container) return;

  const period = STATE.currentPeriod;
  const pendingSales = (STATE.data.sales || [])
    .filter(s => isDateInPeriod(s.date, period))
    .filter(s => s.paymentStatus === 'Pending' || s.paymentStatus === 'Unpaid');

  if (pendingSales.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎉</div>
        <div class="empty-state-title">No pending payments for this period!</div>
        <p class="text-muted mt-2">All customer payments are cleared.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = pendingSales.map(s => renderSaleCardHtml(s)).join('');
}

// ==================== DAILY REMINDERS ====================
function renderReminders() {
  const pendingContainer = document.getElementById('pendingRemindersList');
  const expiryContainer = document.getElementById('expiryRemindersList');
  const badgeTotal = document.getElementById('remindersCountBadge');
  if (!pendingContainer || !expiryContainer) return;

  const todayStr = getLocalTodayDateString();
  const sales = STATE.data.sales || [];

  // 1. Pending reminders: sale.date < todayStr AND status != Paid
  const pendingReminders = sales.filter(s => {
    return (s.paymentStatus === 'Pending' || s.paymentStatus === 'Unpaid') && s.date < todayStr;
  });

  // 2. Expiry reminders: expires tomorrow or today or already expired
  const expiryReminders = sales.filter(s => {
    const days = calculateDaysRemaining(s.expiryDate);
    return days !== null && days <= 1;
  });

  const totalRemindersCount = pendingReminders.length + expiryReminders.length;
  badgeTotal.textContent = totalRemindersCount;
  document.getElementById('pendingRemindersCount').textContent = pendingReminders.length;
  document.getElementById('expiryRemindersCount').textContent = expiryReminders.length;

  // Render Pending Reminders
  if (pendingReminders.length === 0) {
    pendingContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No pending payment reminders for today ✨</div>
      </div>
    `;
  } else {
    pendingContainer.innerHTML = pendingReminders.map(s => {
      const msg = composePendingWhatsAppMessage(s);
      return `
        <div class="reminder-card">
          <div class="reminder-details">
            <div class="reminder-phone">${formatPhone(s.customerPhone)} ${s.customerName ? `(${escapeHtml(s.customerName)})` : ''}</div>
            <div class="reminder-info">
              Product: <strong class="text-gold">${escapeHtml(s.product)}</strong> · Amount: <strong class="text-amber">Rs. ${(s.amount || 0).toLocaleString('en-US')}</strong> · Date: ${formatDateDisplay(s.date)}
            </div>
            <div class="reminder-msg-preview">"${escapeHtml(msg)}"</div>
          </div>
          <div class="item-btn-group">
            <button class="btn btn-xs btn-gold" onclick="markSalePaid('${s.id}')">Mark Paid</button>
            <button class="btn-whatsapp" onclick="openWhatsAppPickerModal('${s.id}', 'pending')">
              <span>💬 Send WhatsApp</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render Expiry Reminders
  if (expiryReminders.length === 0) {
    expiryContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No subscriptions expiring tomorrow ✨</div>
      </div>
    `;
  } else {
    expiryContainer.innerHTML = expiryReminders.map(s => {
      const days = calculateDaysRemaining(s.expiryDate);
      const isTomorrow = days === 1;
      const isToday = days === 0;
      const isPast = days < 0;
      const msg = composeExpiryWhatsAppMessage(s, isTomorrow, isToday, isPast);

      let tagLabel = 'Expires Tomorrow';
      let tagClass = 'text-amber';
      if (isToday) { tagLabel = 'Expires TODAY!'; tagClass = 'text-rose font-bold'; }
      else if (isPast) { tagLabel = 'Already Expired!'; tagClass = 'text-rose font-bold'; }

      return `
        <div class="reminder-card">
          <div class="reminder-details">
            <div class="reminder-phone">${formatPhone(s.customerPhone)} ${s.customerName ? `(${escapeHtml(s.customerName)})` : ''}</div>
            <div class="reminder-info">
              Account: <span class="font-mono text-gold">${escapeHtml(s.accountLogin)}</span> (${escapeHtml(s.product)} · ${escapeHtml(s.accountType)})
            </div>
            <div class="reminder-info">
              Expiry: <span class="${tagClass}">${formatDateDisplay(s.expiryDate)} — ${tagLabel}</span>
            </div>
            <div class="reminder-msg-preview">"${escapeHtml(msg)}"</div>
          </div>
          <div class="item-btn-group">
            <button class="btn-whatsapp" onclick="openWhatsAppPickerModal('${s.id}', 'expiry')">
              <span>💬 Send Renewal WhatsApp</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ==================== DYNAMIC WHATSAPP TEMPLATES & MODAL ====================
function formatCustomTemplate(template, sale) {
  if (!template) return '';
  const settings = STATE.data.settings || {};
  const business = settings.businessName || 'A&B Tools Business Manager';
  const currency = settings.currency || 'Rs.';
  const customer = (sale.customerName && sale.customerName.trim()) ? sale.customerName.trim() : 'Customer';
  const product = sale.product || '';
  const account = sale.accountLogin || '';
  const plan = sale.planLabel || (sale.planMonths ? `${sale.planMonths} Month` : '');
  const expiry = sale.expiryDate ? formatDateDisplay(sale.expiryDate) : '';
  const amount = (sale.amount || 0).toLocaleString('en-US');
  const date = sale.date ? formatDateDisplay(sale.date) : '';

  return template
    .replace(/\{customer\}/gi, customer)
    .replace(/\{business\}/gi, business)
    .replace(/\{currency\}/gi, currency)
    .replace(/\{amount\}/gi, amount)
    .replace(/\{product\}/gi, product)
    .replace(/\{account\}/gi, account)
    .replace(/\{plan\}/gi, plan)
    .replace(/\{expiry\}/gi, expiry)
    .replace(/\{date\}/gi, date);
}

function composePendingWhatsAppMessage(sale) {
  const settings = STATE.data.settings || {};
  const tpl = (settings.templatePending && settings.templatePending.trim())
    ? settings.templatePending
    : DEFAULT_TEMPLATES.pending;
  return formatCustomTemplate(tpl, sale);
}

function composeExpiryWhatsAppMessage(sale, isTomorrow, isToday, isPast) {
  const settings = STATE.data.settings || {};
  const tpl = (settings.templateExpiry && settings.templateExpiry.trim())
    ? settings.templateExpiry
    : DEFAULT_TEMPLATES.expiry;
  let text = formatCustomTemplate(tpl, sale);
  if (isToday && !text.includes('TODAY')) {
    text = `🚨 [URGENT: EXPIRES TODAY]\n` + text;
  } else if (isPast && !text.includes('expired')) {
    text = `⚠️ [EXPIRED]\n` + text;
  }
  return text;
}

function composeWelcomeWhatsAppMessage(sale) {
  const settings = STATE.data.settings || {};
  const tpl = (settings.templateWelcome && settings.templateWelcome.trim())
    ? settings.templateWelcome
    : DEFAULT_TEMPLATES.welcome;
  return formatCustomTemplate(tpl, sale);
}

function composePaidWhatsAppMessage(sale) {
  const settings = STATE.data.settings || {};
  const tpl = (settings.templatePaid && settings.templatePaid.trim())
    ? settings.templatePaid
    : DEFAULT_TEMPLATES.paid;
  return formatCustomTemplate(tpl, sale);
}

let currentWaSale = null;
let currentWaType = 'expiry';

function openWhatsAppPickerModal(saleId, preferredType = null) {
  const sale = (STATE.data.sales || []).find(s => s.id === saleId);
  if (!sale) return;
  currentWaSale = sale;

  if (preferredType) {
    currentWaType = preferredType;
  } else if (sale.paymentStatus !== 'Paid') {
    currentWaType = 'pending';
  } else {
    const days = calculateDaysRemaining(sale.expiryDate);
    if (days !== null && days <= 2) {
      currentWaType = 'expiry';
    } else {
      currentWaType = 'welcome';
    }
  }

  const nameEl = document.getElementById('waModalCustomer');
  const detEl = document.getElementById('waModalDetails');
  const phoneEl = document.getElementById('waModalPhone');

  if (nameEl) nameEl.textContent = sale.customerName || 'Customer';
  if (detEl) detEl.textContent = `${sale.product} (${sale.planLabel || sale.planMonths + 'M'}) · Rs. ${(sale.amount || 0).toLocaleString('en-US')}`;
  if (phoneEl) phoneEl.textContent = sale.customerPhone || 'No Phone';

  updateWaTabsUI();
  updateWaPreviewText();

  openModal('whatsappModal');
}

function updateWaTabsUI() {
  document.querySelectorAll('.wa-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-watype') === currentWaType) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function updateWaPreviewText() {
  if (!currentWaSale) return;
  let text = '';
  if (currentWaType === 'expiry') {
    const days = calculateDaysRemaining(currentWaSale.expiryDate);
    text = composeExpiryWhatsAppMessage(currentWaSale, days === 1, days === 0, days < 0);
  } else if (currentWaType === 'pending') {
    text = composePendingWhatsAppMessage(currentWaSale);
  } else if (currentWaType === 'welcome') {
    text = composeWelcomeWhatsAppMessage(currentWaSale);
  } else if (currentWaType === 'paid') {
    text = composePaidWhatsAppMessage(currentWaSale);
  }
  const previewEl = document.getElementById('waModalPreview');
  if (previewEl) previewEl.value = text;
}

function sendWhatsAppReminder(saleId) {
  openWhatsAppPickerModal(saleId);
}

// Global Tag Insertion & Template Reset for UI
window.insertTag = function(textareaId, tag) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  const start = el.selectionStart !== undefined ? el.selectionStart : el.value.length;
  const end = el.selectionEnd !== undefined ? el.selectionEnd : el.value.length;
  const current = el.value;
  el.value = current.substring(0, start) + tag + current.substring(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + tag.length;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

window.resetTemplate = function(type) {
  const mapping = {
    expiry: { id: 'settingTplExpiry', key: 'templateExpiry' },
    pending: { id: 'settingTplPending', key: 'templatePending' },
    welcome: { id: 'settingTplWelcome', key: 'templateWelcome' },
    paid: { id: 'settingTplPaid', key: 'templatePaid' }
  };
  const item = mapping[type];
  if (!item || !DEFAULT_TEMPLATES[type]) return;
  const el = document.getElementById(item.id);
  if (el) {
    el.value = DEFAULT_TEMPLATES[type];
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
};

function openWhatsAppDirect(phone, encodedText) {
  let cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('03')) {
    cleanPhone = '92' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('3') && cleanPhone.length === 10) {
    cleanPhone = '92' + cleanPhone;
  }
  const url = `https://wa.me/${cleanPhone}?text=${encodedText}`;
  window.open(url, '_blank');
}

// ==================== SALES SEARCH (TOP BAR 🔍) ====================
function setupSearchModal() {
  const searchInput = document.getElementById('globalSearchInput');
  const clearBtn = document.getElementById('btnClearSearch');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      renderSearchResults(q);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      renderSearchResults('');
      searchInput.focus();
    });
  }
}

function renderSearchResults(query) {
  const container = document.getElementById('searchResultsList');
  if (!container) return;

  const sales = STATE.data.sales || [];
  if (!query) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-title">Search phone or account email</div>
        <p class="text-muted mt-2">Example: Type <strong>2966</strong> or <strong>Abd114</strong></p>
      </div>
    `;
    return;
  }

  const filtered = sales.filter(s => {
    const phone = (s.customerPhone || '').toLowerCase();
    const name = (s.customerName || '').toLowerCase();
    const login = (s.accountLogin || '').toLowerCase();
    const prod = (s.product || '').toLowerCase();
    const plan = (s.planLabel || '').toLowerCase();
    const notes = (s.notes || '').toLowerCase();

    return phone.includes(query) || 
           name.includes(query) || 
           login.includes(query) || 
           prod.includes(query) || 
           plan.includes(query) ||
           notes.includes(query);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <div class="empty-state-title">No records matching "${escapeHtml(query)}"</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="text-muted mb-2 font-mono" style="font-size: 12px;">Found ${filtered.length} match(es):</div>
  ` + filtered.map(s => renderSaleCardHtml(s)).join('');
}

// ==================== ADMIN PRODUCTS MANAGEMENT ====================
function renderAdminCatalog() {
  const container = document.getElementById('adminProductsCatalog');
  if (!container) return;

  const products = STATE.data.products || [];

  if (products.length === 0) {
    container.innerHTML = `<div class="empty-state">No products found</div>`;
    return;
  }

  container.innerHTML = products.map(p => `
    <div class="catalog-item-box">
      <div class="catalog-item-head">
        <div class="flex items-center gap-2">
          <span class="catalog-prod-name">${escapeHtml(p.name)}</span>
          <span class="catalog-type-pill">${escapeHtml(p.type || 'Shared')}</span>
        </div>
        <div class="item-btn-group">
          <button class="btn btn-xs btn-outline" onclick="openEditProduct('${p.id}')">✏️ Edit</button>
          <button class="btn btn-xs btn-outline btn-action-delete" onclick="deleteProduct('${p.id}')">🗑️</button>
        </div>
      </div>
      <div class="catalog-plans-tags">
        ${(p.plans || []).map(pl => `
          <span class="plan-tag">${escapeHtml(pl.label || pl.months + 'm')}: <strong>Rs. ${pl.price}</strong></span>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ==================== EVENT LISTENERS & MODALS ====================
function setupEventListeners() {
  // Navigation Tabs (Desktop & Mobile)
  document.querySelectorAll('.nav-tab, .mobile-nav-btn[data-view]').forEach(tab => {
    tab.addEventListener('click', () => {
      const viewId = tab.getAttribute('data-view');
      switchView(viewId);
    });
  });

  // Mobile + Sale Center FAB button
  const mobileFab = document.getElementById('mobileBtnNewSale');
  if (mobileFab) {
    mobileFab.addEventListener('click', () => {
      openSaleModal();
    });
  }

  // Period Tabs
  document.querySelectorAll('.period-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      STATE.currentPeriod = tab.getAttribute('data-period');
      renderApp();
    });
  });

  // Quick Action Buttons
  document.getElementById('btnOpenNewSaleModal')?.addEventListener('click', () => openSaleModal());
  document.getElementById('btnOpenNewExpenseModal')?.addEventListener('click', () => openExpenseModal());
  document.getElementById('btnHeaderNewExpense')?.addEventListener('click', () => openExpenseModal());
  document.getElementById('btnOpenRemindersView')?.addEventListener('click', () => switchView('remindersView'));
  document.getElementById('kpiPendingCard')?.addEventListener('click', () => switchView('pendingView'));
  document.getElementById('btnRefreshReminders')?.addEventListener('click', () => {
    renderReminders();
    showToast('Reminders refreshed!');
  });

  // Top Bar Search Button
  document.getElementById('btnQuickSearch')?.addEventListener('click', () => {
    openModal('searchModal');
    setupSearchModal();
    setTimeout(() => {
      document.getElementById('globalSearchInput')?.focus();
    }, 200);
  });

  // Excel Download Buttons
  document.getElementById('btnDownloadExcel')?.addEventListener('click', triggerExcelDownload);
  document.getElementById('btnAdminDownloadExcel')?.addEventListener('click', triggerExcelDownload);

  // JSON Backup and Restore
  document.getElementById('btnDownloadJsonBackup')?.addEventListener('click', downloadJsonBackup);
  document.getElementById('restoreFileInput')?.addEventListener('change', handleJsonRestore);

  // App Lock Button
  document.getElementById('btnLockApp')?.addEventListener('click', () => {
    STATE.unlocked = false;
    sessionStorage.removeItem('ab_tools_unlocked');
    showPinGate();
  });

  // PIN Setup Form
  document.getElementById('btnSavePin')?.addEventListener('click', handlePinSetup);
  document.getElementById('btnUnlockSubmit')?.addEventListener('click', handleUnlockSubmit);

  // Change PIN Form
  document.getElementById('changePinForm')?.addEventListener('submit', handleChangePin);

  // Modal Close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      closeModal(modalId);
    });
  });

  // Sale Modal Events
  const prodSelect = document.getElementById('saleProductSelect');
  const typeSelect = document.getElementById('saleTypeSelect');
  const planSelect = document.getElementById('salePlanSelect');
  const dateInput = document.getElementById('saleDateInput');

  prodSelect?.addEventListener('change', onProductChange);
  typeSelect?.addEventListener('change', onProductOrTypeChange);
  planSelect?.addEventListener('change', onPlanChange);
  dateInput?.addEventListener('input', updateLiveExpiryPreview);

  // Sales filter changes
  document.getElementById('salesFilterProduct')?.addEventListener('change', renderSales);
  document.getElementById('salesFilterStatus')?.addEventListener('change', renderSales);

  // Sale Form Submit
  document.getElementById('saleForm')?.addEventListener('submit', handleSaleSubmit);

  // Expense Form Submit
  document.getElementById('expenseForm')?.addEventListener('submit', handleExpenseSubmit);

  // Admin New Product Modal
  document.getElementById('btnOpenNewProductModal')?.addEventListener('click', openNewProductModal);
  document.getElementById('btnAddPlanRow')?.addEventListener('click', () => addPlanRow());
  document.getElementById('productForm')?.addEventListener('submit', handleProductSubmit);

  // Business Settings & WhatsApp Templates Live Auto-Save Listeners
  const nameInput = document.getElementById('settingBusinessNameInput');
  const currInput = document.getElementById('settingCurrencyInput');
  const tplExpiry = document.getElementById('settingTplExpiry');
  const tplPending = document.getElementById('settingTplPending');
  const tplWelcome = document.getElementById('settingTplWelcome');
  const tplPaid = document.getElementById('settingTplPaid');
  const feedbackMsg = document.getElementById('settingsFeedbackMsg');
  const tplFeedbackMsg = document.getElementById('tplFeedbackMsg');

  let settingsDebounceTimer = null;
  function onSettingChange(isTplChange = false) {
    STATE.data.settings = STATE.data.settings || {};
    if (nameInput) STATE.data.settings.businessName = nameInput.value.trim() || 'A&B Tools Business Manager';
    if (currInput) STATE.data.settings.currency = currInput.value.trim() || 'Rs.';
    if (tplExpiry) STATE.data.settings.templateExpiry = tplExpiry.value;
    if (tplPending) STATE.data.settings.templatePending = tplPending.value;
    if (tplWelcome) STATE.data.settings.templateWelcome = tplWelcome.value;
    if (tplPaid) STATE.data.settings.templatePaid = tplPaid.value;

    syncSettingsFormUI();
    renderApp();

    if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer);
    settingsDebounceTimer = setTimeout(() => {
      triggerAutoSaveSync();
      const targetFeedback = isTplChange ? tplFeedbackMsg : feedbackMsg;
      if (targetFeedback) {
        targetFeedback.className = 'pin-feedback-msg text-green';
        targetFeedback.textContent = isTplChange 
          ? 'WhatsApp templates auto-saved & synced! ⚡' 
          : 'Settings auto-saved & synced across devices! ⚡';
        setTimeout(() => { if (targetFeedback) targetFeedback.textContent = ''; }, 3000);
      }
    }, 250);
  }

  nameInput?.addEventListener('input', () => onSettingChange(false));
  currInput?.addEventListener('input', () => onSettingChange(false));
  tplExpiry?.addEventListener('input', () => onSettingChange(true));
  tplPending?.addEventListener('input', () => onSettingChange(true));
  tplWelcome?.addEventListener('input', () => onSettingChange(true));
  tplPaid?.addEventListener('input', () => onSettingChange(true));

  // WhatsApp Modal Tabs & Actions
  document.querySelectorAll('.wa-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentWaType = btn.getAttribute('data-watype');
      updateWaTabsUI();
      updateWaPreviewText();
    });
  });

  document.getElementById('btnSendWaModal')?.addEventListener('click', () => {
    if (!currentWaSale) return;
    const text = document.getElementById('waModalPreview')?.value || '';
    openWhatsAppDirect(currentWaSale.customerPhone, encodeURIComponent(text));
    closeModal('whatsappModal');
  });

  document.getElementById('btnCopyWaMsg')?.addEventListener('click', () => {
    const text = document.getElementById('waModalPreview')?.value || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Message copied to clipboard! 📋');
      });
    } else {
      const el = document.getElementById('waModalPreview');
      el?.select();
      document.execCommand('copy');
      showToast('Message copied! 📋');
    }
  });

  // Admin Reset Sales & Expenses (Strictly Protected by Master Password)
  document.getElementById('btnResetSalesExpenses')?.addEventListener('click', async () => {
    const password = prompt('🔒 MASTER SECURITY PROTECTED:\nEnter Master Password to reset/wipe sales and expenses:\n(Warning: Without master password, deletion is blocked)');
    if (!password) return;

    const confirmAgain = confirm('⚠️ FINAL CONFIRMATION:\nAre you sure you want to permanently clear all sales & expenses? This action cannot be reversed.');
    if (!confirmAgain) return;

    try {
      const res = await fetch('/api/reset-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('All sales and expenses cleared successfully! 🗑️');
        triggerAutoSaveSync();
        await loadAppData();
      } else {
        alert(data.error || 'Reset failed: Access denied');
      }
    } catch (err) {
      alert('Could not complete reset: ' + err.message);
    }
  });
  // Quick Date Chips: Sale Modal
  document.getElementById('btnSaleDateToday')?.addEventListener('click', () => {
    const saleDate = document.getElementById('saleDateInput');
    if (saleDate) {
      saleDate.value = getLocalTodayDateString();
      updateLiveExpiryPreview();
      showToast('Date set to Today');
    }
  });
  document.getElementById('btnSaleDateYesterday')?.addEventListener('click', () => {
    const saleDate = document.getElementById('saleDateInput');
    if (saleDate) {
      saleDate.value = getLocalYesterdayDateString();
      updateLiveExpiryPreview();
      showToast('Date set to Yesterday');
    }
  });

  // Quick Date Chips: Expense Modal
  document.getElementById('btnExpenseDateToday')?.addEventListener('click', () => {
    const expenseDate = document.getElementById('expenseDateInput');
    if (expenseDate) {
      expenseDate.value = getLocalTodayDateString();
      showToast('Date set to Today');
    }
  });
  document.getElementById('btnExpenseDateYesterday')?.addEventListener('click', () => {
    const expenseDate = document.getElementById('expenseDateInput');
    if (expenseDate) {
      expenseDate.value = getLocalYesterdayDateString();
      showToast('Date set to Yesterday');
    }
  });
}

function switchView(viewId) {
  STATE.currentView = viewId;

  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(viewId)?.classList.add('active');

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-view') === viewId);
  });
  document.querySelectorAll('.mobile-nav-btn').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-view') === viewId);
  });

  // Ensure target view content is rendered immediately
  if (viewId === 'salesView') renderSales();
  else if (viewId === 'expensesView') renderExpenses();
  else if (viewId === 'pendingView') renderPendingPayments();
  else if (viewId === 'remindersView') renderReminders();
  else if (viewId === 'adminView') renderAdminCatalog();

  window.scrollTo(0, 0);
}

function openModal(id) {
  document.getElementById(id)?.classList.add('active');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
}

// ==================== SALE FORM CRUD ====================
function setDefaultDates() {
  const today = getLocalTodayDateString();
  const saleDate = document.getElementById('saleDateInput');
  const expenseDate = document.getElementById('expenseDateInput');
  if (saleDate) {
    saleDate.value = today;
  }
  if (expenseDate) {
    expenseDate.value = today;
  }
}

function openSaleModal() {
  document.getElementById('saleEditId').value = '';
  document.getElementById('saleModalTitle').textContent = 'New Sale Entry';
  document.getElementById('saleForm').reset();
  setDefaultDates();
  onProductChange();
  openModal('saleModal');
  setTimeout(() => {
    document.getElementById('salePhoneInput')?.focus({ preventScroll: true });
  }, 30);
}

function openEditSale(id) {
  const sale = (STATE.data.sales || []).find(s => s.id === id);
  if (!sale) return;

  document.getElementById('saleEditId').value = id;
  document.getElementById('saleModalTitle').textContent = 'Edit Sale Record';
  document.getElementById('saleDateInput').value = sale.date;
  document.getElementById('salePhoneInput').value = sale.customerPhone;
  document.getElementById('saleNameInput').value = sale.customerName || '';
  document.getElementById('saleProductSelect').value = sale.product;
  document.getElementById('saleTypeSelect').value = sale.accountType || 'Shared';

  onProductOrTypeChange();

  document.getElementById('saleAccountLogin').value = sale.accountLogin || '';
  document.getElementById('salePlanSelect').value = String(sale.planMonths);
  document.getElementById('saleAmountInput').value = sale.amount;
  document.getElementById('saleNotesInput').value = sale.notes || '';

  const radios = document.getElementsByName('saleStatus');
  radios.forEach(r => {
    r.checked = (r.value === sale.paymentStatus);
  });

  updateLiveExpiryPreview();
  openModal('saleModal');
}

async function handleSaleSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('saleEditId').value;
  const date = document.getElementById('saleDateInput').value;
  const customerPhone = document.getElementById('salePhoneInput').value.trim();
  const customerName = document.getElementById('saleNameInput').value.trim();
  const product = document.getElementById('saleProductSelect').value;
  const accountType = document.getElementById('saleTypeSelect').value;
  const accountLogin = document.getElementById('saleAccountLogin').value.trim();
  const planSelect = document.getElementById('salePlanSelect');
  const planMonths = Number(planSelect.value) || 1;
  const planLabel = planSelect.options[planSelect.selectedIndex]?.getAttribute('data-label') || `${planMonths} Month(s)`;
  const amount = Number(document.getElementById('saleAmountInput').value) || 0;
  const notes = document.getElementById('saleNotesInput').value.trim();

  let paymentStatus = 'Pending';
  document.getElementsByName('saleStatus').forEach(r => {
    if (r.checked) paymentStatus = r.value;
  });

  const payload = {
    date,
    customerPhone,
    customerName,
    product,
    accountType,
    accountLogin,
    planMonths,
    planLabel,
    amount,
    paymentStatus,
    notes,
    updatedAt: new Date().toISOString()
  };

  const saleId = editId || ('sale_' + Date.now());
  const saleItem = {
    id: saleId,
    ...payload,
    expiryDate: calculateExpiry(date, planMonths),
    createdAt: editId ? (STATE.data.sales.find(s => s.id === editId)?.createdAt || new Date().toISOString()) : new Date().toISOString()
  };

  // Immediate Local Update (Never lost on refresh)
  STATE.data.sales = STATE.data.sales || [];
  if (editId) {
    const idx = STATE.data.sales.findIndex(s => s.id === editId);
    if (idx !== -1) {
      STATE.data.sales[idx] = saleItem;
    }
  } else {
    STATE.data.sales.unshift(saleItem);
  }

  saveLocalState();
  closeModal('saleModal');
  showToast(editId ? 'Sale updated successfully! 💾' : 'New sale added & auto-saved! 🎉');
  renderApp();

  // Instant Cloud Auto-Save (NO REFRESH NEEDED)
  triggerAutoSaveSync();
}

async function markSalePaid(id) {
  const sale = (STATE.data.sales || []).find(s => s.id === id);
  if (sale) {
    sale.paymentStatus = 'Paid';
    sale.updatedAt = new Date().toISOString();
    saveLocalState();
    showToast('Marked as Paid! ✓');
    renderApp();
    triggerAutoSaveSync();
  }
}

async function deleteSale(id) {
  if (!confirm('Are you sure you want to delete this sale record?')) return;
  STATE.data.sales = (STATE.data.sales || []).filter(s => s.id !== id);
  STATE.data.settings = STATE.data.settings || {};
  STATE.data.settings.deletedSaleIds = STATE.data.settings.deletedSaleIds || [];
  if (!STATE.data.settings.deletedSaleIds.includes(id)) {
    STATE.data.settings.deletedSaleIds.push(id);
  }
  saveLocalState();
  showToast('Sale record deleted');
  renderApp();
  triggerAutoSaveSync();
}

// ==================== EXPENSE FORM CRUD ====================
function openExpenseModal() {
  document.getElementById('expenseEditId').value = '';
  document.getElementById('expenseModalTitle').textContent = 'New Expense Entry';
  document.getElementById('expenseForm').reset();
  setDefaultDates();
  openModal('expenseModal');
}

function openEditExpense(id) {
  const expense = (STATE.data.expenses || []).find(e => e.id === id);
  if (!expense) return;

  document.getElementById('expenseEditId').value = id;
  document.getElementById('expenseModalTitle').textContent = 'Edit Expense Record';
  document.getElementById('expenseDateInput').value = expense.date;
  document.getElementById('expenseCategorySelect').value = expense.category;
  document.getElementById('expenseDescInput').value = expense.description || '';
  document.getElementById('expenseAmountInput').value = expense.amount;
  openModal('expenseModal');
}

async function handleExpenseSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('expenseEditId').value;
  const date = document.getElementById('expenseDateInput').value;
  const category = document.getElementById('expenseCategorySelect').value;
  const description = document.getElementById('expenseDescInput').value.trim();
  const amount = Number(document.getElementById('expenseAmountInput').value) || 0;

  const payload = {
    date,
    category,
    description,
    amount,
    updatedAt: new Date().toISOString()
  };

  const expId = editId || ('exp_' + Date.now());
  const expItem = {
    id: expId,
    ...payload,
    createdAt: editId ? (STATE.data.expenses.find(e => e.id === editId)?.createdAt || new Date().toISOString()) : new Date().toISOString()
  };

  // Immediate Local Update (Never lost on refresh)
  STATE.data.expenses = STATE.data.expenses || [];
  if (editId) {
    const idx = STATE.data.expenses.findIndex(e => e.id === editId);
    if (idx !== -1) STATE.data.expenses[idx] = expItem;
  } else {
    STATE.data.expenses.unshift(expItem);
  }

  saveLocalState();
  closeModal('expenseModal');
  showToast(editId ? 'Expense updated! 💾' : 'Expense recorded & auto-saved! 💸');
  renderApp();

  // Instant Cloud Auto-Save (NO REFRESH NEEDED)
  triggerAutoSaveSync();
}

async function deleteExpense(id) {
  if (!confirm('Are you sure you want to delete this expense record?')) return;
  STATE.data.expenses = (STATE.data.expenses || []).filter(e => e.id !== id);
  STATE.data.settings = STATE.data.settings || {};
  STATE.data.settings.deletedExpenseIds = STATE.data.settings.deletedExpenseIds || [];
  if (!STATE.data.settings.deletedExpenseIds.includes(id)) {
    STATE.data.settings.deletedExpenseIds.push(id);
  }
  saveLocalState();
  showToast('Expense record deleted');
  renderApp();
  triggerAutoSaveSync();
}

// ==================== ADMIN PRODUCTS CRUD ====================
function openNewProductModal() {
  document.getElementById('productEditId').value = '';
  document.getElementById('productModalTitle').textContent = 'Add New Tool / Product';
  document.getElementById('productForm').reset();
  const rows = document.getElementById('plansListRowsContainer');
  rows.innerHTML = '';
  addPlanRow(1, '1 Month (30 Days)', 0);
  openModal('productModal');
}

function openEditProduct(id) {
  const prod = (STATE.data.products || []).find(p => p.id === id);
  if (!prod) return;

  document.getElementById('productEditId').value = id;
  document.getElementById('productModalTitle').textContent = 'Edit Product & Plans';
  document.getElementById('prodNameInput').value = prod.name;
  document.getElementById('prodTypeSelect').value = prod.type || 'Shared';

  const rows = document.getElementById('plansListRowsContainer');
  rows.innerHTML = '';

  (prod.plans || []).forEach(pl => {
    addPlanRow(pl.months, pl.label, pl.price);
  });

  if (!prod.plans || prod.plans.length === 0) {
    addPlanRow(1, '1 Month (30 Days)', 0);
  }

  openModal('productModal');
}

function addPlanRow(months = 1, label = '', price = 0) {
  const container = document.getElementById('plansListRowsContainer');
  const div = document.createElement('div');
  div.className = 'plan-edit-row';
  div.innerHTML = `
    <input type="number" class="plan-months-input form-control" style="width: 70px;" value="${months}" min="1" placeholder="M" title="Months">
    <input type="text" class="plan-label-input form-control flex-1" value="${escapeHtml(label || months + ' Month(s)')}" placeholder="e.g. 1 Month (30 Days)">
    <input type="number" class="plan-price-input form-control" style="width: 100px;" value="${price}" min="0" placeholder="Rs.">
    <button type="button" class="btn btn-action-delete" style="padding: 6px 10px;" onclick="this.parentElement.remove()">&times;</button>
  `;
  container.appendChild(div);
}

async function handleProductSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('productEditId').value;
  const name = document.getElementById('prodNameInput').value.trim();
  const type = document.getElementById('prodTypeSelect').value;

  const planRows = document.querySelectorAll('.plan-edit-row');
  const plans = [];

  planRows.forEach(row => {
    const months = Number(row.querySelector('.plan-months-input').value) || 1;
    const label = row.querySelector('.plan-label-input').value.trim() || `${months} Month(s)`;
    const price = Number(row.querySelector('.plan-price-input').value) || 0;
    plans.push({ months, label, price });
  });

  const id = editId || ('prod_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + (type || 'shared').toLowerCase());
  const productObj = {
    id,
    name,
    type: type || 'Shared',
    plans
  };

  // Immediate Local Update (Never lost on refresh)
  STATE.data.products = STATE.data.products || [];
  const existingIdx = STATE.data.products.findIndex(p => p.id === id);
  if (existingIdx >= 0) {
    STATE.data.products[existingIdx] = productObj;
  } else {
    STATE.data.products.push(productObj);
  }

  saveLocalState();
  populateProductDropdowns();
  renderAdminCatalog();
  renderApp();
  closeModal('productModal');
  showToast('Product & Pricing saved & auto-synced! 🎉');

  // Instant Cloud Auto-Save (NO REFRESH NEEDED)
  triggerAutoSaveSync();

  try {
    await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, plans })
    });
  } catch (err) {
    console.warn('Product sync warning:', err);
  }
}

async function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this tool and all its plans?')) return;
  STATE.data.products = (STATE.data.products || []).filter(p => p.id !== id);
  saveLocalState();
  populateProductDropdowns();
  renderAdminCatalog();
  renderApp();
  showToast('Product deleted & auto-synced');

  // Instant Cloud Auto-Save (NO REFRESH NEEDED)
  triggerAutoSaveSync();

  try {
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('Delete product sync warning:', err);
  }
}

// ==================== EXCEL & DATA DOWNLOAD ====================
async function triggerExcelDownload() {
  try {
    showToast('Generating Excel file...');
    const link = document.createElement('a');
    link.href = '/api/export/excel';
    link.download = `A&B_Tools_Ledger_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => showToast('Excel Sheet downloaded! 📥'), 600);
  } catch (err) {
    console.warn('Server excel download failed, running client SheetJS fallback:', err);
    fallbackClientExcelDownload();
  }
}

async function fallbackClientExcelDownload() {
  if (typeof XLSX === 'undefined') {
    showToast('Loading Excel export engine... ⏳');
    const loaded = await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
    if (!loaded || typeof XLSX === 'undefined') {
      alert('Could not load Excel export engine. Please check your internet connection.');
      return;
    }
  }
  const wb = XLSX.utils.book_new();

  // 1. Sales Sheet
  const salesRows = (STATE.data.sales || []).map(s => ({
    'Sale ID': s.id,
    'Date': s.date,
    'Customer Phone': s.customerPhone,
    'Customer Name': s.customerName || '',
    'Product': s.product,
    'Account Type': s.accountType || '',
    'Assigned Account': s.accountLogin || '',
    'Plan': s.planLabel || `${s.planMonths} Month(s)`,
    'Amount (Rs.)': s.amount || 0,
    'Payment Status': s.paymentStatus || 'Pending',
    'Expiry Date': s.expiryDate || '',
    'Notes': s.notes || ''
  }));
  const wsSales = XLSX.utils.json_to_sheet(salesRows.length ? salesRows : [{ Note: 'Empty' }]);
  XLSX.utils.book_append_sheet(wb, wsSales, 'Sales');

  // 2. Expenses Sheet
  const expenseRows = (STATE.data.expenses || []).map(e => ({
    'Date': e.date,
    'Category': e.category,
    'Description': e.description || '',
    'Amount (Rs.)': e.amount || 0
  }));
  const wsExpenses = XLSX.utils.json_to_sheet(expenseRows.length ? expenseRows : [{ Note: 'Empty' }]);
  XLSX.utils.book_append_sheet(wb, wsExpenses, 'Expenses');

  // 3. Products Sheet
  const productRows = [];
  (STATE.data.products || []).forEach(p => {
    (p.plans || []).forEach(pl => {
      productRows.push({
        'Product': p.name,
        'Type': p.type,
        'Plan': pl.label,
        'Price (Rs.)': pl.price
      });
    });
  });
  const wsProducts = XLSX.utils.json_to_sheet(productRows.length ? productRows : [{ Note: 'Empty' }]);
  XLSX.utils.book_append_sheet(wb, wsProducts, 'Products');

  XLSX.writeFile(wb, `A&B_Tools_Ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
  showToast('Excel Sheet downloaded!');
}

function downloadJsonBackup() {
  const jsonStr = JSON.stringify(STATE.data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `A&B_Tools_Backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON backup file downloaded!');
}

function handleJsonRestore(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (!parsed.sales && !parsed.products) {
        alert('Invalid backup file format');
        return;
      }
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupData: parsed })
      });
      if (res.ok) {
        showToast('Data restored from backup successfully! 🎉');
        await loadAppData();
      }
    } catch (err) {
      alert('Error reading backup file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ==================== SECURITY: PIN CHANGE ====================
async function handleChangePin(e) {
  e.preventDefault();
  const oldPin = document.getElementById('currentPinInput').value.trim();
  const newPin = document.getElementById('changeNewPinInput').value.trim();
  const msgEl = document.getElementById('changePinMessage');
  msgEl.textContent = '';

  try {
    const res = await fetch('/api/auth/change-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPin, newPin })
    });
    const result = await res.json();
    if (res.ok) {
      msgEl.className = 'pin-feedback-msg text-green';
      msgEl.textContent = 'Security PIN updated successfully! ✓';
      localStorage.setItem('ab_tools_pin', newPin);
      document.getElementById('changePinForm').reset();
      showToast('PIN updated & auto-synced across devices! 🔒');
      triggerAutoSaveSync();
    } else {
      msgEl.className = 'pin-feedback-msg text-rose';
      msgEl.textContent = result.error || 'Failed to update PIN';
    }
  } catch (err) {
    msgEl.className = 'pin-feedback-msg text-rose';
    msgEl.textContent = 'Could not connect to server';
  }
}

// ==================== UTILS ====================
function calculateDaysRemaining(expiryDateStr) {
  if (!expiryDateStr) return null;
  const todayStr = getLocalTodayDateString();
  const [ey, em, ed] = expiryDateStr.split('-').map(Number);
  const [ty, tm, td] = todayStr.split('-').map(Number);

  const expDate = new Date(ey, em - 1, ed);
  const curDate = new Date(ty, tm - 1, td);

  const diffTime = expDate - curDate;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function formatDaysBadge(days) {
  if (days === null) return '';
  if (days < 0) return `<span class="badge-req">Expired (${Math.abs(days)}d ago)</span>`;
  if (days === 0) return `<span class="badge-req font-bold">Expires Today!</span>`;
  if (days === 1) return `<span class="badge-amber font-bold">Expires Tomorrow!</span>`;
  return `<span class="text-muted" style="font-size: 11px;">(${days}d left)</span>`;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = parts[2];
  const monthName = months[parseInt(parts[1], 10) - 1] || parts[1];
  const year = parts[0];
  return `${day} ${monthName} ${year}`;
}

function formatPhone(phone) {
  if (!phone) return '';
  return phone.replace(/(\d{4})(\d{7})/, '$1 $2');
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied to clipboard: ${text}`);
  }).catch(() => {
    showToast(`Copied to clipboard!`);
  });
}

function showToast(msg) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('active');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('active');
  }, 2600);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
