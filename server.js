const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// Detect serverless environment (Vercel, AWS Lambda, etc.)
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);

// Root bundled data directory (read-only on serverless)
const BUNDLED_DATA_DIR = path.join(__dirname, 'data');
const BUNDLED_DB_FILE = path.join(BUNDLED_DATA_DIR, 'ab_tools_db.json');

// Writable data directory: use os.tmpdir() on serverless to prevent EROFS errors
const WRITABLE_DATA_DIR = isServerless ? path.join(os.tmpdir(), 'ab_tools_data') : BUNDLED_DATA_DIR;
const DB_FILE = path.join(WRITABLE_DATA_DIR, 'ab_tools_db.json');
const EXCEL_FILE = path.join(WRITABLE_DATA_DIR, 'AB_Tools_Business_Ledger.xlsx');

try {
  if (!fs.existsSync(WRITABLE_DATA_DIR)) {
    fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('Could not initialize writable data directory:', err.message);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Disable caching for all API responses so mobile browsers and CDNs never serve stale data
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Cloud KV / Redis Persistent Storage Adapter (Upstash Redis / Vercel KV)
const DEFAULT_KV_URL = 'https://desired-elephant-221971.upstash.io';
const DEFAULT_KV_TOKEN = 'gQAAAAAAA2MTAAIgcDFkZTgzY2JmODU0YWE0YjI3OGFiODkyZjMyNzUxMzcyMw';

function getCloudKvCredentials() {
  const db = memoryDb || {};
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || db?.settings?.kvUrl || DEFAULT_KV_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || db?.settings?.kvToken || DEFAULT_KV_TOKEN;
  return {
    url: url ? String(url).trim() : null,
    token: token ? String(token).trim() : null
  };
}

async function syncFromCloudKV() {
  const { url, token } = getCloudKvCredentials();
  if (!url || !token) return false;
  try {
    const res = await fetch(`${url}/get/ab_tools_db`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.result) {
        let parsed = data.result;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch (_) {}
        }
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch (_) {}
        }
        if (parsed && typeof parsed === 'object') {
          parsed.settings = parsed.settings || {};
          parsed.settings.deletedSaleIds = parsed.settings.deletedSaleIds || [];
          ['sale_1790808573942_ktuq', 'sale_1790891345201_z6tu'].forEach(id => {
            if (!parsed.settings.deletedSaleIds.includes(id)) parsed.settings.deletedSaleIds.push(id);
          });
          const delSales = new Set(parsed.settings.deletedSaleIds);
          if (parsed.sales) {
            parsed.sales = parsed.sales.filter(s => s && s.id && !delSales.has(s.id) && s.id !== 'sale_1790808573942_ktuq' && s.id !== 'sale_1790891345201_z6tu');
          }
          parsed.settings.deletedExpenseIds = parsed.settings.deletedExpenseIds || [];
          const delExpenses = new Set(parsed.settings.deletedExpenseIds);
          if (parsed.expenses) {
            parsed.expenses = parsed.expenses.filter(e => e && e.id && !delExpenses.has(e.id));
          }
          parsed.recycleBin = parsed.recycleBin || [];
          memoryDb = parsed;
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('Cloud KV read warning:', err.message);
  }
  return false;
}

async function syncToCloudKV(data) {
  const { url, token } = getCloudKvCredentials();
  if (!url || !token) return false;
  try {
    const res = await fetch(`${url}/set/ab_tools_db`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('Cloud KV write warning:', res.status, txt);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Cloud KV write warning:', err.message);
    return false;
  }
}

// Auto-sync Cloud KV for incoming API calls if configured
app.use(async (req, res, next) => {
  const { url, token } = getCloudKvCredentials();
  if (url && token && req.path.startsWith('/api') && !req.path.startsWith('/api/cloud-kv/test')) {
    await syncFromCloudKV();
  }
  next();
});

// Default initial catalog as specified in specification
const DEFAULT_PRODUCTS = [
  {
    id: 'prod_surfshark_shared',
    name: 'Surfshark',
    type: 'Shared',
    plans: [
      { months: 1, label: '1 Month (30 Days)', price: 250 },
      { months: 2, label: '2 Months (60 Days)', price: 400 },
      { months: 3, label: '3 Months (90 Days)', price: 600 },
      { months: 6, label: '6 Months (180 Days)', price: 1000 },
      { months: 12, label: '12 Months (360 Days)', price: 1600 }
    ]
  },
  {
    id: 'prod_surfshark_private',
    name: 'Surfshark',
    type: 'Private',
    plans: [
      { months: 2, label: '2 Months (60 Days)', price: 2200 },
      { months: 12, label: '1 Year (360 Days)', price: 9499 }
    ]
  },
  {
    id: 'prod_nord_shared',
    name: 'Nord',
    type: 'Shared',
    plans: [
      { months: 3, label: '3 Months (90 Days)', price: 500 },
      { months: 6, label: '6 Months (180 Days)', price: 900 },
      { months: 9, label: '9 Months (270 Days)', price: 1300 },
      { months: 12, label: '12 Months (360 Days)', price: 1600 }
    ]
  },
  {
    id: 'prod_nord_private',
    name: 'Nord',
    type: 'Private',
    plans: [
      { months: 3, label: '3 Months (90 Days)', price: 1800 },
      { months: 12, label: '12 Months (360 Days)', price: 6500 }
    ]
  },
  {
    id: 'prod_gemini_pro',
    name: 'Gemini Pro',
    type: 'Shared',
    plans: [
      { months: 18, label: '18 Months (540 Days)', price: 750 }
    ]
  },
  {
    id: 'prod_capcut',
    name: 'CapCut',
    type: 'Shared',
    plans: [
      { months: 1, label: '1 Month (30 Days)', price: 450 }
    ]
  },
  {
    id: 'prod_chatgpt',
    name: 'ChatGPT',
    type: 'Shared',
    plans: [
      { months: 1, label: '1 Month (30 Days)', price: 800 }
    ]
  },
  {
    id: 'prod_muse_ai',
    name: 'Muse AI',
    type: 'Shared',
    plans: [
      { months: 1, label: '1 Month (30 Days)', price: 500 }
    ]
  }
];

function sanitizeBusinessName(name) {
  if (!name) return 'Monkey Tools';
  const s = String(name).trim();
  if (s === '' || s.includes('A&B') || s.includes('Business Manager')) {
    return 'Monkey Tools';
  }
  return s;
}

function getInitialDb() {
  return {
    pin: null, // First time user sets custom PIN, no default PIN
    products: DEFAULT_PRODUCTS,
    sales: [],
    expenses: [],
    settings: {
      businessName: 'Monkey Tools',
      currency: 'Rs.',
      lastModified: 1,
      deletedSaleIds: ['sale_1790808573942_ktuq', 'sale_1790891345201_z6tu'],
      deletedExpenseIds: [],
      lastExcelExport: null
    }
  };
}

let memoryDb = null;

function readDb() {
  if (memoryDb) {
    if (memoryDb.settings) {
      memoryDb.settings.businessName = sanitizeBusinessName(memoryDb.settings.businessName);
    }
    return memoryDb;
  }
  try {
    let raw = null;
    if (fs.existsSync(DB_FILE)) {
      raw = fs.readFileSync(DB_FILE, 'utf8');
    } else if (fs.existsSync(BUNDLED_DB_FILE)) {
      raw = fs.readFileSync(BUNDLED_DB_FILE, 'utf8');
    }

    if (raw) {
      const data = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
      const parsed = JSON.parse(data);
      if (!parsed.products || parsed.products.length === 0) {
        parsed.products = DEFAULT_PRODUCTS;
      }
      parsed.settings = parsed.settings || {};
      parsed.settings.businessName = sanitizeBusinessName(parsed.settings.businessName);
      parsed.settings.deletedSaleIds = parsed.settings.deletedSaleIds || [];
      ['sale_1790808573942_ktuq', 'sale_1790891345201_z6tu'].forEach(id => {
        if (!parsed.settings.deletedSaleIds.includes(id)) parsed.settings.deletedSaleIds.push(id);
      });
      const delSales = new Set(parsed.settings.deletedSaleIds);
      if (parsed.sales) {
        parsed.sales = parsed.sales.filter(s => s && s.id && !delSales.has(s.id) && s.id !== 'sale_1790808573942_ktuq' && s.id !== 'sale_1790891345201_z6tu');
      }
      parsed.settings.deletedExpenseIds = parsed.settings.deletedExpenseIds || [];
      const delExpenses = new Set(parsed.settings.deletedExpenseIds);
      if (parsed.expenses) {
        parsed.expenses = parsed.expenses.filter(e => e && e.id && !delExpenses.has(e.id));
      }
      parsed.recycleBin = parsed.recycleBin || [];
      memoryDb = parsed;
      return memoryDb;
    }
  } catch (err) {
    console.error('Error reading db:', err);
  }

  memoryDb = getInitialDb();
  memoryDb.recycleBin = memoryDb.recycleBin || [];
  return memoryDb;
}

async function writeDb(data) {
  data.settings = data.settings || {};
  data.settings.businessName = sanitizeBusinessName(data.settings.businessName);
  data.settings.lastModified = Date.now();
  data.settings.deletedSaleIds = data.settings.deletedSaleIds || [];
  data.settings.deletedExpenseIds = data.settings.deletedExpenseIds || [];
  data.recycleBin = data.recycleBin || [];
  memoryDb = data;
  try {
    if (!fs.existsSync(WRITABLE_DATA_DIR)) {
      fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('Filesystem write warning (continuing with in-memory):', err.message);
  }

  // Push to Cloud KV / Redis if configured - AWAIT is required on serverless to prevent freeze
  const { url: kvUrl, token: kvToken } = getCloudKvCredentials();
  if (kvUrl && kvToken) {
    try {
      await syncToCloudKV(data);
    } catch (err) {
      console.warn('Cloud KV sync write warning:', err.message);
    }
  }

  if (!isServerless) {
    try {
      syncExcelWorkbook(data);
    } catch (err) {
      console.warn('Excel disk write warning:', err.message);
    }
  }
}

// Calculate inclusive expiry date:
// expiry = purchase date + (plan months * 30 - 1 day)
function calculateExpiry(purchaseDateStr, months) {
  if (!purchaseDateStr) return '';
  const [y, m, d] = purchaseDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const daysToAdd = Number(months) * 30 - 1;
  date.setDate(date.getDate() + daysToAdd);
  const resY = date.getFullYear();
  const resM = String(date.getMonth() + 1).padStart(2, '0');
  const resD = String(date.getDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

function getLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Build Excel workbook in memory with 3 sheets: Sales, Expenses, Products
function buildExcelWorkbook(data) {
  const wb = XLSX.utils.book_new();

  // 1. Sales Sheet
  const salesRows = (data.sales || []).map(s => ({
    'Sale ID': s.id || '',
    'Date': s.date || '',
    'Customer Phone': s.customerPhone || '',
    'Customer Name': s.customerName || '',
    'Product': s.product || '',
    'Account Type': s.accountType || '',
    'Assigned Account (Email/Login)': s.accountLogin || '',
    'Plan Duration': s.planLabel || `${s.planMonths} Month(s)`,
    'Plan Months': s.planMonths || '',
    'Amount (Rs.)': s.amount || 0,
    'Payment Status': s.paymentStatus || 'Pending',
    'Expiry Date': s.expiryDate || '',
    'Notes': s.notes || '',
    'Created At': s.createdAt || ''
  }));
  const wsSales = XLSX.utils.json_to_sheet(salesRows.length ? salesRows : [{ Note: 'No sales records found' }]);
  XLSX.utils.book_append_sheet(wb, wsSales, 'Sales');

  // 2. Expenses Sheet
  const expensesRows = (data.expenses || []).map(e => ({
    'Expense ID': e.id || '',
    'Date': e.date || '',
    'Category': e.category || '',
    'Description': e.description || e.category || '',
    'Amount (Rs.)': e.amount || 0,
    'Created At': e.createdAt || ''
  }));
  const wsExpenses = XLSX.utils.json_to_sheet(expensesRows.length ? expensesRows : [{ Note: 'No expense records found' }]);
  XLSX.utils.book_append_sheet(wb, wsExpenses, 'Expenses');

  // 3. Products Sheet
  const productsRows = [];
  (data.products || []).forEach(p => {
    (p.plans || []).forEach(pl => {
      productsRows.push({
        'Product Name': p.name || '',
        'Account Type': p.type || '',
        'Plan Duration (Months)': pl.months || '',
        'Plan Description': pl.label || '',
        'Price (Rs.)': pl.price || 0
      });
    });
  });
  const wsProducts = XLSX.utils.json_to_sheet(productsRows.length ? productsRows : [{ Note: 'No products found' }]);
  XLSX.utils.book_append_sheet(wb, wsProducts, 'Products');

  return wb;
}

// Sync all data into Excel workbook file on disk (for localhost)
function syncExcelWorkbook(data) {
  try {
    const wb = buildExcelWorkbook(data);
    XLSX.writeFile(wb, EXCEL_FILE);
  } catch (err) {
    console.error('Error writing Excel file:', err);
  }
}

// ======================== API ROUTES ========================

// Status / PIN Check
app.get('/api/status', (req, res) => {
  const db = readDb();
  const creds = getCloudKvCredentials();
  res.json({
    pinSet: !!db.pin,
    pinLength: db.pin ? String(db.pin).length : 0,
    businessName: sanitizeBusinessName(db.settings?.businessName),
    salesCount: (db.sales || []).length,
    expensesCount: (db.expenses || []).length,
    cloudKvConfigured: !!(creds.url && creds.token),
    cloudKvUrl: creds.url ? (creds.url.slice(0, 18) + '...') : ''
  });
});

// Test Cloud KV Connection
app.post('/api/cloud-kv/test', async (req, res) => {
  try {
    let { kvUrl, kvToken } = req.body;
    if (!kvUrl || !kvToken) {
      const creds = getCloudKvCredentials();
      kvUrl = kvUrl || creds.url;
      kvToken = kvToken || creds.token;
    }
    if (!kvUrl || !kvToken) {
      return res.status(400).json({ success: false, error: 'Upstash URL and Token are required' });
    }
    const cleanUrl = String(kvUrl).trim();
    const cleanToken = String(kvToken).trim();
    const testRes = await fetch(`${cleanUrl}/get/ping`, {
      headers: { Authorization: `Bearer ${cleanToken}` }
    });
    if (testRes.ok) {
      return res.json({ success: true, message: 'Cloud KV Connected successfully! 🎉' });
    }
    const txt = await testRes.text().catch(() => '');
    return res.status(400).json({ success: false, error: `Connection failed (${testRes.status}): ${txt || testRes.statusText}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Connection error: ' + err.message });
  }
});

// Setup Initial PIN
app.post('/api/auth/setup-pin', async (req, res) => {
  const { pin } = req.body;
  const cleanPin = String(pin || '').trim();
  if (!cleanPin || cleanPin.length < 4 || cleanPin.length > 6 || !/^\d{4,6}$/.test(cleanPin)) {
    return res.status(400).json({ error: 'PIN must be between 4 and 6 numeric digits' });
  }
  const db = readDb();
  if (db.pin) {
    return res.status(400).json({ error: 'PIN is already configured' });
  }
  db.pin = cleanPin;
  await writeDb(db);
  res.json({ success: true, message: 'PIN configured successfully!', pinLength: cleanPin.length });
});

// Verify PIN
app.post('/api/auth/verify-pin', (req, res) => {
  const { pin } = req.body;
  const db = readDb();
  if (!db.pin) {
    return res.status(400).json({ error: 'Please set your PIN first' });
  }
  const cleanPin = String(pin || '').trim();
  if (cleanPin === String(db.pin).trim()) {
    return res.json({ success: true, message: 'Welcome back' });
  }
  return res.status(401).json({ error: 'Incorrect PIN! Please try again' });
});

// Change PIN
app.post('/api/auth/change-pin', async (req, res) => {
  const { oldPin, newPin } = req.body;
  const db = readDb();
  const cleanOld = String(oldPin || '').trim();
  const cleanNew = String(newPin || '').trim();

  if (!db.pin || cleanOld === String(db.pin).trim()) {
    if (!cleanNew || cleanNew.length < 4 || cleanNew.length > 6 || !/^\d{4,6}$/.test(cleanNew)) {
      return res.status(400).json({ error: 'New PIN must be between 4 and 6 numeric digits' });
    }
    db.pin = cleanNew;
    db.settings = db.settings || {};
    db.settings.lastModified = Date.now();
    await writeDb(db);
    return res.json({
      success: true,
      message: 'PIN changed successfully!',
      pin: cleanNew,
      pinLength: cleanNew.length
    });
  }
  return res.status(401).json({ error: 'Current PIN is incorrect' });
});

// Full Data
app.get('/api/data', (req, res) => {
  const db = readDb();
  res.json({
    sales: db.sales || [],
    expenses: db.expenses || [],
    products: db.products || DEFAULT_PRODUCTS,
    recycleBin: db.recycleBin || [],
    settings: db.settings || {}
  });
});

// ======================== SALES ========================

// Add or Upsert Sale
app.post('/api/sales', async (req, res) => {
  const {
    id,
    date,
    customerName,
    customerPhone,
    product,
    accountType,
    accountLogin,
    planMonths,
    planLabel,
    amount,
    paymentStatus,
    notes,
    createdAt,
    updatedAt
  } = req.body;

  if (!customerPhone || !product || !accountLogin || !amount) {
    return res.status(400).json({
      error: 'Customer Phone, Product, Assigned Account, and Amount are required!'
    });
  }

  const db = readDb();
  const saleDate = date || getLocalDateString();
  const months = Number(planMonths) || 1;
  const expiryDate = calculateExpiry(saleDate, months);
  const saleId = id || ('sale_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));

  const saleObj = {
    id: saleId,
    date: saleDate,
    customerName: customerName ? customerName.trim() : '',
    customerPhone: customerPhone.trim(),
    product: product.trim(),
    accountType: accountType || 'Shared',
    accountLogin: accountLogin.trim(),
    planMonths: months,
    planLabel: planLabel || `${months} Month(s)`,
    amount: Number(amount) || 0,
    paymentStatus: paymentStatus || 'Pending', // Paid, Pending, Unpaid
    expiryDate,
    notes: notes ? notes.trim() : '',
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: updatedAt || new Date().toISOString()
  };

  const existingIdx = (db.sales || []).findIndex(s => s.id === saleId);
  if (existingIdx !== -1) {
    db.sales[existingIdx] = { ...db.sales[existingIdx], ...saleObj };
  } else {
    db.sales.unshift(saleObj);
  }

  await writeDb(db);
  res.status(201).json({ success: true, sale: saleObj });
});

// Update Sale
app.put('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const index = db.sales.findIndex(s => s.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Sale record not found' });
  }

  const existing = db.sales[index];
  const updatedData = req.body;

  const saleDate = updatedData.date || existing.date;
  const months = Number(updatedData.planMonths || existing.planMonths) || 1;
  const expiryDate = calculateExpiry(saleDate, months);

  db.sales[index] = {
    ...existing,
    ...updatedData,
    id,
    date: saleDate,
    planMonths: months,
    amount: Number(updatedData.amount !== undefined ? updatedData.amount : existing.amount),
    expiryDate,
    updatedAt: new Date().toISOString()
  };

  await writeDb(db);
  res.json({ success: true, sale: db.sales[index] });
});

// Quick Update Payment Status
app.patch('/api/sales/:id/status', async (req, res) => {
  const { id } = req.params;
  const { paymentStatus } = req.body;
  if (!['Paid', 'Pending', 'Unpaid'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Status must be Paid, Pending, or Unpaid' });
  }

  const db = readDb();
  const sale = db.sales.find(s => s.id === id);
  if (!sale) {
    return res.status(404).json({ error: 'Sale record not found' });
  }

  sale.paymentStatus = paymentStatus;
  sale.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ success: true, sale });
});

// Delete Sale (Moves to Recycle Bin)
app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const sale = db.sales.find(s => s.id === id);

  if (!sale) {
    return res.status(404).json({ error: 'Sale record not found' });
  }

  db.sales = db.sales.filter(s => s.id !== id);

  db.recycleBin = db.recycleBin || [];
  db.recycleBin.unshift({
    id: 'trash_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    originalId: id,
    type: 'sale',
    item: sale,
    deletedAt: new Date().toISOString()
  });
  if (db.recycleBin.length > 200) db.recycleBin.pop();

  db.settings = db.settings || {};
  db.settings.deletedSaleIds = db.settings.deletedSaleIds || [];
  if (!db.settings.deletedSaleIds.includes(id)) {
    db.settings.deletedSaleIds.push(id);
    if (db.settings.deletedSaleIds.length > 500) db.settings.deletedSaleIds.shift();
  }

  await writeDb(db);
  res.json({ success: true, message: 'Sale moved to Recycle Bin' });
});

// ======================== EXPENSES ========================

// Add or Upsert Expense
app.post('/api/expenses', async (req, res) => {
  const { id, date, category, description, amount, createdAt, updatedAt } = req.body;
  if (!category || !amount) {
    return res.status(400).json({ error: 'Category and Amount are required!' });
  }

  const db = readDb();
  const expId = id || ('exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));

  const expObj = {
    id: expId,
    date: date || getLocalDateString(),
    category: category.trim(),
    description: (description && description.trim()) ? description.trim() : category.trim(),
    amount: Number(amount) || 0,
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: updatedAt || new Date().toISOString()
  };

  const existingIdx = (db.expenses || []).findIndex(e => e.id === expId);
  if (existingIdx !== -1) {
    db.expenses[existingIdx] = { ...db.expenses[existingIdx], ...expObj };
  } else {
    db.expenses.unshift(expObj);
  }

  await writeDb(db);
  res.status(201).json({ success: true, expense: expObj });
});

// Update Expense
app.put('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const index = db.expenses.findIndex(e => e.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Expense record not found' });
  }

  const existing = db.expenses[index];
  const { date, category, description, amount } = req.body;

  db.expenses[index] = {
    ...existing,
    date: date || existing.date,
    category: category ? category.trim() : existing.category,
    description: (description && description.trim()) ? description.trim() : (category || existing.category),
    amount: Number(amount !== undefined ? amount : existing.amount),
    updatedAt: new Date().toISOString()
  };

  await writeDb(db);
  res.json({ success: true, expense: db.expenses[index] });
});

// Delete Expense (Moves to Recycle Bin)
app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const expense = db.expenses.find(e => e.id === id);

  if (!expense) {
    return res.status(404).json({ error: 'Expense record not found' });
  }

  db.expenses = db.expenses.filter(e => e.id !== id);

  db.recycleBin = db.recycleBin || [];
  db.recycleBin.unshift({
    id: 'trash_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    originalId: id,
    type: 'expense',
    item: expense,
    deletedAt: new Date().toISOString()
  });
  if (db.recycleBin.length > 200) db.recycleBin.pop();

  db.settings = db.settings || {};
  db.settings.deletedExpenseIds = db.settings.deletedExpenseIds || [];
  if (!db.settings.deletedExpenseIds.includes(id)) {
    db.settings.deletedExpenseIds.push(id);
    if (db.settings.deletedExpenseIds.length > 500) db.settings.deletedExpenseIds.shift();
  }

  await writeDb(db);
  res.json({ success: true, message: 'Expense moved to Recycle Bin' });
});

// ======================== RECYCLE BIN ENDPOINTS ========================

// Get Recycle Bin Items
app.get('/api/recycle-bin', (req, res) => {
  const db = readDb();
  res.json({ success: true, items: db.recycleBin || [] });
});

// Restore Item from Recycle Bin
app.post('/api/recycle-bin/restore/:id', async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.recycleBin = db.recycleBin || [];
  const index = db.recycleBin.findIndex(t => t.id === id || t.originalId === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Item not found in Recycle Bin' });
  }

  const trashEntry = db.recycleBin[index];
  db.recycleBin.splice(index, 1);

  if (trashEntry.type === 'sale') {
    db.sales = db.sales || [];
    const exists = db.sales.some(s => s.id === trashEntry.item.id);
    if (!exists) db.sales.unshift(trashEntry.item);
    if (db.settings?.deletedSaleIds) {
      db.settings.deletedSaleIds = db.settings.deletedSaleIds.filter(sid => sid !== trashEntry.originalId && sid !== trashEntry.item.id);
    }
  } else if (trashEntry.type === 'expense') {
    db.expenses = db.expenses || [];
    const exists = db.expenses.some(e => e.id === trashEntry.item.id);
    if (!exists) db.expenses.unshift(trashEntry.item);
    if (db.settings?.deletedExpenseIds) {
      db.settings.deletedExpenseIds = db.settings.deletedExpenseIds.filter(eid => eid !== trashEntry.originalId && eid !== trashEntry.item.id);
    }
  }

  await writeDb(db);
  res.json({ success: true, message: 'Item restored successfully', item: trashEntry.item, type: trashEntry.type });
});

// Permanently Delete Item from Recycle Bin
app.delete('/api/recycle-bin/:id', async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.recycleBin = (db.recycleBin || []).filter(t => t.id !== id && t.originalId !== id);
  await writeDb(db);
  res.json({ success: true, message: 'Item permanently deleted' });
});

// Empty Entire Recycle Bin
app.delete('/api/recycle-bin', async (req, res) => {
  const db = readDb();
  db.recycleBin = [];
  await writeDb(db);
  res.json({ success: true, message: 'Recycle Bin emptied successfully' });
});

// ======================== PRODUCTS / CATALOG (ADMIN) ========================

// Add or Update Full Product
app.post('/api/products', async (req, res) => {
  const { name, type, plans } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Product name is required' });
  }

  const db = readDb();
  const id = 'prod_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + (type || 'shared').toLowerCase();

  const existingIndex = db.products.findIndex(p => p.id === id);
  const productObj = {
    id,
    name: name.trim(),
    type: type || 'Shared',
    plans: Array.isArray(plans) ? plans : []
  };

  if (existingIndex >= 0) {
    db.products[existingIndex] = productObj;
  } else {
    db.products.push(productObj);
  }

  await writeDb(db);
  res.json({ success: true, product: productObj });
});

// Delete Product
app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.products = db.products.filter(p => p.id !== id);
  await writeDb(db);
  res.json({ success: true, message: 'Product deleted successfully' });
});

// ======================== EXCEL EXPORT & BACKUP ========================

// Direct Download Excel (.xlsx) - In-memory buffer streaming (100% crash-proof on Vercel)
app.get('/api/export/excel', (req, res) => {
  try {
    const db = readDb();
    const wb = buildExcelWorkbook(db);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const today = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Monkey_Tools_Ledger_${today}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  } catch (err) {
    console.error('Failed to generate Excel download:', err);
    return res.status(500).json({ error: 'Failed to generate Excel file: ' + err.message });
  }
});

// Catch-all route to serve public/index.html for any direct page navigation
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('Page not found');
});

// JSON Full Backup Download
app.get('/api/backup/download', (req, res) => {
  const db = readDb();
  const today = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="Monkey_Tools_Backup_${today}.json"`);
  res.send(JSON.stringify(db, null, 2));
});

// Helper to merge lists deduplicated by id without data loss
function mergeRecordLists(existing = [], incoming = [], deletedSet = new Set()) {
  const map = new Map();
  (existing || []).forEach(item => {
    if (item && item.id && !deletedSet.has(item.id)) map.set(item.id, item);
  });
  (incoming || []).forEach(item => {
    if (item && item.id && !deletedSet.has(item.id)) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      } else {
        const existingItem = map.get(item.id);
        const incomingTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
        const existingTime = new Date(existingItem.updatedAt || existingItem.createdAt || 0).getTime();
        if (incomingTime >= existingTime) {
          map.set(item.id, item);
        }
      }
    }
  });
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const dDiff = (b.date || '').localeCompare(a.date || '');
    if (dDiff !== 0) return dDiff;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
  return list;
}

// Universal Real-Time Sync endpoint (Cross-Device Instant Save without refresh)
app.post('/api/sync', async (req, res) => {
  try {
    const {
      sales: incomingSales,
      expenses: incomingExpenses,
      products: incomingProducts,
      settings: incomingSettings,
      recycleBin: incomingRecycleBin,
      pin: incomingPin
    } = req.body;
    const db = readDb();

    // Only explicitly restored items can be un-deleted
    const restoredSales = new Set(incomingSettings?.restoredSaleIds || []);
    const restoredExpenses = new Set(incomingSettings?.restoredExpenseIds || []);

    const deletedSales = new Set([
      ...(db.settings?.deletedSaleIds || []),
      ...(incomingSettings?.deletedSaleIds || [])
    ]);
    restoredSales.forEach(id => deletedSales.delete(id));

    const deletedExpenses = new Set([
      ...(db.settings?.deletedExpenseIds || []),
      ...(incomingSettings?.deletedExpenseIds || [])
    ]);
    restoredExpenses.forEach(id => deletedExpenses.delete(id));

    if (Array.isArray(incomingSales)) {
      db.sales = mergeRecordLists(db.sales, incomingSales, deletedSales);
    }
    if (Array.isArray(incomingExpenses)) {
      db.expenses = mergeRecordLists(db.expenses, incomingExpenses, deletedExpenses);
    }

    if (Array.isArray(incomingProducts) && incomingProducts.length > 0) {
      // Non-destructive product merge
      const prodMap = new Map();
      (db.products || DEFAULT_PRODUCTS).forEach(p => {
        if (p && p.id) prodMap.set(p.id, p);
      });
      incomingProducts.forEach(p => {
        if (p && p.id) prodMap.set(p.id, p);
      });
      db.products = Array.from(prodMap.values());
    }

    if (Array.isArray(incomingRecycleBin)) {
      db.recycleBin = incomingRecycleBin;
    }

    // NOTE: db.pin is strictly managed by /api/auth/change-pin and /api/auth/setup-pin
    // Background polling from stale devices must NEVER revert a newly changed PIN.

    db.settings = {
      ...db.settings,
      ...(incomingSettings || {}),
      businessName: sanitizeBusinessName(incomingSettings?.businessName || db.settings?.businessName),
      lastModified: Date.now(),
      deletedSaleIds: Array.from(deletedSales),
      deletedExpenseIds: Array.from(deletedExpenses)
    };

    await writeDb(db);

    res.json({
      success: true,
      sales: db.sales || [],
      expenses: db.expenses || [],
      products: db.products || DEFAULT_PRODUCTS,
      recycleBin: db.recycleBin || [],
      settings: db.settings,
      pin: db.pin,
      pinLength: db.pin ? String(db.pin).length : 0
    });
  } catch (err) {
    console.error('Realtime sync error:', err);
    res.status(500).json({ error: 'Realtime sync failed: ' + err.message });
  }
});

// Update Business Settings Directly
app.post('/api/settings', async (req, res) => {
  try {
    const { businessName, currency, whatsappTemplate, templateExpiry, templatePending, templateWelcome, templatePaid, defaultPeriod, kvUrl, kvToken } = req.body;
    const db = readDb();
    db.settings = db.settings || {};
    if (businessName !== undefined) db.settings.businessName = sanitizeBusinessName(businessName);
    if (currency !== undefined) db.settings.currency = String(currency).trim();
    if (whatsappTemplate !== undefined) db.settings.whatsappTemplate = String(whatsappTemplate).trim();
    if (templateExpiry !== undefined) db.settings.templateExpiry = String(templateExpiry).trim();
    if (templatePending !== undefined) db.settings.templatePending = String(templatePending).trim();
    if (templateWelcome !== undefined) db.settings.templateWelcome = String(templateWelcome).trim();
    if (templatePaid !== undefined) db.settings.templatePaid = String(templatePaid).trim();
    if (defaultPeriod !== undefined) db.settings.defaultPeriod = String(defaultPeriod).trim();
    if (kvUrl !== undefined) db.settings.kvUrl = String(kvUrl).trim();
    if (kvToken !== undefined) db.settings.kvToken = String(kvToken).trim();
    db.settings.lastModified = Date.now();
    await writeDb(db);
    res.json({ success: true, settings: db.settings });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ error: 'Failed to save settings: ' + err.message });
  }
});

// JSON Full Restore (Smart Non-Destructive Merge)
app.post('/api/backup/restore', async (req, res) => {
  const { backupData } = req.body;
  if (!backupData || (!backupData.sales && !backupData.products)) {
    return res.status(400).json({ error: 'Invalid backup file format' });
  }
  const db = readDb();
  const deletedSales = new Set([
    ...(db.settings?.deletedSaleIds || []),
    ...(backupData.settings?.deletedSaleIds || [])
  ]);
  const deletedExpenses = new Set([
    ...(db.settings?.deletedExpenseIds || []),
    ...(backupData.settings?.deletedExpenseIds || [])
  ]);

  db.sales = mergeRecordLists(db.sales, backupData.sales, deletedSales);
  db.expenses = mergeRecordLists(db.expenses, backupData.expenses, deletedExpenses);
  if (backupData.products && backupData.products.length) {
    db.products = backupData.products;
  }
  // Only set PIN on restore if the system has no PIN configured yet
  if (backupData.pin && !db.pin) {
    db.pin = backupData.pin;
  }
  db.settings = {
    ...db.settings,
    ...(backupData.settings || {}),
    deletedSaleIds: Array.from(deletedSales),
    deletedExpenseIds: Array.from(deletedExpenses)
  };
  await writeDb(db);
  res.json({ success: true, message: 'Backup restored successfully!', salesCount: db.sales.length });
});

// Reset System (Protected by Master Password Sad12345@)
app.post('/api/reset-data', async (req, res) => {
  const { password } = req.body;
  const MASTER_RESET_PASSWORD = 'Sad12345@';

  if (!password || String(password).trim() !== MASTER_RESET_PASSWORD) {
    return res.status(403).json({ error: 'Incorrect Master Security Password! Reset is locked.' });
  }

  const db = readDb();
  db.sales = [];
  db.expenses = [];
  await writeDb(db);
  res.json({ success: true, message: 'Sales and Expenses cleared successfully!' });
});

// Start Server
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 Monkey Tools Business Manager Running at:`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`===============================================`);
    const initialData = readDb();
    syncExcelWorkbook(initialData);
  });
}

module.exports = app;
