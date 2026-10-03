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

// Cloud KV / Redis Persistent Storage Adapter (Upstash Redis / Vercel KV)
const KV_REST_API_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function syncFromCloudKV() {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return false;
  try {
    const res = await fetch(`${KV_REST_API_URL}/get/ab_tools_db`, {
      headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.result) {
        const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
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
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return;
  try {
    await fetch(`${KV_REST_API_URL}/set/ab_tools_db`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(data))
    });
  } catch (err) {
    console.warn('Cloud KV write warning:', err.message);
  }
}

// Auto-sync Cloud KV for incoming API calls if configured
app.use(async (req, res, next) => {
  if (KV_REST_API_URL && KV_REST_API_TOKEN && req.path.startsWith('/api')) {
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

function getInitialDb() {
  return {
    pin: null, // First time user sets custom PIN, no default PIN
    products: DEFAULT_PRODUCTS,
    sales: [],
    expenses: [],
    settings: {
      businessName: 'A&B Tools Business Manager',
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
      memoryDb = parsed;
      return memoryDb;
    }
  } catch (err) {
    console.error('Error reading db:', err);
  }

  memoryDb = getInitialDb();
  return memoryDb;
}

function writeDb(data) {
  data.settings = data.settings || {};
  data.settings.lastModified = Date.now();
  data.settings.deletedSaleIds = data.settings.deletedSaleIds || [];
  data.settings.deletedExpenseIds = data.settings.deletedExpenseIds || [];
  memoryDb = data;
  try {
    if (!fs.existsSync(WRITABLE_DATA_DIR)) {
      fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('Filesystem write warning (continuing with in-memory):', err.message);
  }

  // Push to Cloud KV / Redis if configured
  if (KV_REST_API_URL && KV_REST_API_TOKEN) {
    syncToCloudKV(data).catch(err => console.warn('Cloud KV sync write warning:', err.message));
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
  res.json({
    pinSet: !!db.pin,
    businessName: db.settings?.businessName || 'A&B Tools Business Manager',
    salesCount: (db.sales || []).length,
    expensesCount: (db.expenses || []).length
  });
});

// Setup Initial PIN
app.post('/api/auth/setup-pin', (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 digits' });
  }
  const db = readDb();
  if (db.pin) {
    return res.status(400).json({ error: 'PIN is already configured' });
  }
  db.pin = String(pin).trim();
  writeDb(db);
  res.json({ success: true, message: 'PIN configured successfully!' });
});

// Verify PIN
app.post('/api/auth/verify-pin', (req, res) => {
  const { pin } = req.body;
  const db = readDb();
  if (!db.pin) {
    return res.status(400).json({ error: 'Please set your PIN first' });
  }
  if (String(pin).trim() === db.pin) {
    return res.json({ success: true, message: 'Welcome back' });
  }
  return res.status(401).json({ error: 'Incorrect PIN! Please try again' });
});

// Change PIN
app.post('/api/auth/change-pin', (req, res) => {
  const { oldPin, newPin } = req.body;
  const db = readDb();
  if (!db.pin || String(oldPin).trim() === db.pin) {
    if (!newPin || newPin.length < 4) {
      return res.status(400).json({ error: 'New PIN must be at least 4 digits' });
    }
    db.pin = String(newPin).trim();
    writeDb(db);
    return res.json({ success: true, message: 'PIN changed successfully!' });
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
    settings: db.settings || {}
  });
});

// ======================== SALES ========================

// Add or Upsert Sale
app.post('/api/sales', (req, res) => {
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

  writeDb(db);
  res.status(201).json({ success: true, sale: saleObj });
});

// Update Sale
app.put('/api/sales/:id', (req, res) => {
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

  writeDb(db);
  res.json({ success: true, sale: db.sales[index] });
});

// Quick Update Payment Status
app.patch('/api/sales/:id/status', (req, res) => {
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
  writeDb(db);
  res.json({ success: true, sale });
});

// Delete Sale
app.delete('/api/sales/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const initialLength = db.sales.length;
  db.sales = db.sales.filter(s => s.id !== id);

  if (db.sales.length === initialLength) {
    return res.status(404).json({ error: 'Sale record not found' });
  }

  db.settings = db.settings || {};
  db.settings.deletedSaleIds = db.settings.deletedSaleIds || [];
  if (!db.settings.deletedSaleIds.includes(id)) {
    db.settings.deletedSaleIds.push(id);
    if (db.settings.deletedSaleIds.length > 500) db.settings.deletedSaleIds.shift();
  }

  writeDb(db);
  res.json({ success: true, message: 'Sale deleted successfully' });
});

// ======================== EXPENSES ========================

// Add or Upsert Expense
app.post('/api/expenses', (req, res) => {
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

  writeDb(db);
  res.status(201).json({ success: true, expense: expObj });
});

// Update Expense
app.put('/api/expenses/:id', (req, res) => {
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

  writeDb(db);
  res.json({ success: true, expense: db.expenses[index] });
});

// Delete Expense
app.delete('/api/expenses/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const initialLength = db.expenses.length;
  db.expenses = db.expenses.filter(e => e.id !== id);

  if (db.expenses.length === initialLength) {
    return res.status(404).json({ error: 'Expense record not found' });
  }

  db.settings = db.settings || {};
  db.settings.deletedExpenseIds = db.settings.deletedExpenseIds || [];
  if (!db.settings.deletedExpenseIds.includes(id)) {
    db.settings.deletedExpenseIds.push(id);
    if (db.settings.deletedExpenseIds.length > 500) db.settings.deletedExpenseIds.shift();
  }

  writeDb(db);
  res.json({ success: true, message: 'Expense deleted successfully' });
});

// ======================== PRODUCTS / CATALOG (ADMIN) ========================

// Add or Update Full Product
app.post('/api/products', (req, res) => {
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

  writeDb(db);
  res.json({ success: true, product: productObj });
});

// Delete Product
app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.products = db.products.filter(p => p.id !== id);
  writeDb(db);
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
    res.setHeader('Content-Disposition', `attachment; filename="AB_Tools_Ledger_${today}.xlsx"`);
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
  res.setHeader('Content-Disposition', `attachment; filename="AB_Tools_Backup_${today}.json"`);
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
app.post('/api/sync', (req, res) => {
  try {
    const {
      sales: incomingSales,
      expenses: incomingExpenses,
      products: incomingProducts,
      settings: incomingSettings,
      pin: incomingPin
    } = req.body;
    const db = readDb();

    const deletedSales = new Set([
      ...(db.settings?.deletedSaleIds || []),
      ...(incomingSettings?.deletedSaleIds || [])
    ]);
    const deletedExpenses = new Set([
      ...(db.settings?.deletedExpenseIds || []),
      ...(incomingSettings?.deletedExpenseIds || [])
    ]);

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

    if (incomingPin && String(incomingPin).trim().length >= 4) {
      db.pin = String(incomingPin).trim();
    }

    db.settings = {
      ...db.settings,
      ...(incomingSettings || {}),
      lastModified: Date.now(),
      deletedSaleIds: Array.from(deletedSales),
      deletedExpenseIds: Array.from(deletedExpenses)
    };

    writeDb(db);

    res.json({
      success: true,
      sales: db.sales || [],
      expenses: db.expenses || [],
      products: db.products || DEFAULT_PRODUCTS,
      settings: db.settings,
      pin: db.pin
    });
  } catch (err) {
    console.error('Realtime sync error:', err);
    res.status(500).json({ error: 'Realtime sync failed: ' + err.message });
  }
});

// Update Business Settings Directly
app.post('/api/settings', (req, res) => {
  try {
    const { businessName, currency, whatsappTemplate, templateExpiry, templatePending, templateWelcome, templatePaid, defaultPeriod } = req.body;
    const db = readDb();
    db.settings = db.settings || {};
    if (businessName !== undefined) db.settings.businessName = String(businessName).trim();
    if (currency !== undefined) db.settings.currency = String(currency).trim();
    if (whatsappTemplate !== undefined) db.settings.whatsappTemplate = String(whatsappTemplate).trim();
    if (templateExpiry !== undefined) db.settings.templateExpiry = String(templateExpiry).trim();
    if (templatePending !== undefined) db.settings.templatePending = String(templatePending).trim();
    if (templateWelcome !== undefined) db.settings.templateWelcome = String(templateWelcome).trim();
    if (templatePaid !== undefined) db.settings.templatePaid = String(templatePaid).trim();
    if (defaultPeriod !== undefined) db.settings.defaultPeriod = String(defaultPeriod).trim();
    db.settings.lastModified = Date.now();
    writeDb(db);
    res.json({ success: true, settings: db.settings });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ error: 'Failed to save settings: ' + err.message });
  }
});

// JSON Full Restore (Smart Non-Destructive Merge)
app.post('/api/backup/restore', (req, res) => {
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
  writeDb(db);
  res.json({ success: true, message: 'Backup restored successfully!', salesCount: db.sales.length });
});

// Reset System (Protected by Master Password Sad12345@)
app.post('/api/reset-data', (req, res) => {
  const { password } = req.body;
  const MASTER_RESET_PASSWORD = 'Sad12345@';

  if (!password || String(password).trim() !== MASTER_RESET_PASSWORD) {
    return res.status(403).json({ error: 'Incorrect Master Security Password! Reset is locked.' });
  }

  const db = readDb();
  db.sales = [];
  db.expenses = [];
  writeDb(db);
  res.json({ success: true, message: 'Sales and Expenses cleared successfully!' });
});

// Start Server
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 A&B Tools Business Manager Running at:`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`===============================================`);
    const initialData = readDb();
    syncExcelWorkbook(initialData);
  });
}

module.exports = app;
