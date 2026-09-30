const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'ab_tools_db.json');
const EXCEL_FILE = path.join(DATA_DIR, 'AB_Tools_Business_Ledger.xlsx');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
      lastExcelExport: null
    }
  };
}

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = getInitialDb();
      writeDb(initial);
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const data = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const parsed = JSON.parse(data);
    if (!parsed.products || parsed.products.length === 0) {
      parsed.products = DEFAULT_PRODUCTS;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading db:', err);
    return getInitialDb();
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    syncExcelWorkbook(data);
  } catch (err) {
    console.error('Error writing db:', err);
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

// Sync all data into Excel workbook with 3 sheets: Sales, Expenses, Products
function syncExcelWorkbook(data) {
  try {
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

    XLSX.writeFile(wb, EXCEL_FILE);
  } catch (err) {
    console.error('Error generating Excel file:', err);
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

// Add Sale
app.post('/api/sales', (req, res) => {
  const {
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
    notes
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

  const newSale = {
    id: 'sale_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
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
    createdAt: new Date().toISOString()
  };

  db.sales.unshift(newSale);
  writeDb(db);
  res.status(201).json({ success: true, sale: newSale });
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

  writeDb(db);
  res.json({ success: true, message: 'Sale deleted successfully' });
});

// ======================== EXPENSES ========================

// Add Expense
app.post('/api/expenses', (req, res) => {
  const { date, category, description, amount } = req.body;
  if (!category || !amount) {
    return res.status(400).json({ error: 'Category and Amount are required!' });
  }

  const db = readDb();
  const newExpense = {
    id: 'exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    date: date || getLocalDateString(),
    category: category.trim(),
    description: (description && description.trim()) ? description.trim() : category.trim(),
    amount: Number(amount) || 0,
    createdAt: new Date().toISOString()
  };

  db.expenses.unshift(newExpense);
  writeDb(db);
  res.status(201).json({ success: true, expense: newExpense });
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

// Direct Download Excel (.xlsx)
app.get('/api/export/excel', (req, res) => {
  const db = readDb();
  syncExcelWorkbook(db);

  if (fs.existsSync(EXCEL_FILE)) {
    const today = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="AB_Tools_Ledger_${today}.xlsx"`);
    const fileStream = fs.createReadStream(EXCEL_FILE);
    fileStream.pipe(res);
  } else {
    res.status(500).json({ error: 'Failed to generate Excel file' });
  }
});

// JSON Full Backup Download
app.get('/api/backup/download', (req, res) => {
  const db = readDb();
  const today = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="AB_Tools_Backup_${today}.json"`);
  res.send(JSON.stringify(db, null, 2));
});

// JSON Full Restore
app.post('/api/backup/restore', (req, res) => {
  const { backupData } = req.body;
  if (!backupData || (!backupData.sales && !backupData.products)) {
    return res.status(400).json({ error: 'Invalid backup file format' });
  }
  const db = readDb();
  db.sales = backupData.sales || db.sales;
  db.expenses = backupData.expenses || db.expenses;
  db.products = backupData.products || db.products;
  if (backupData.pin) db.pin = backupData.pin;
  writeDb(db);
  res.json({ success: true, message: 'Backup restored successfully!' });
});

// Reset System
app.post('/api/reset-data', (req, res) => {
  const { pin } = req.body;
  const db = readDb();
  if (db.pin && String(pin).trim() !== db.pin) {
    return res.status(401).json({ error: 'Incorrect PIN! Cannot reset system data' });
  }
  db.sales = [];
  db.expenses = [];
  writeDb(db);
  res.json({ success: true, message: 'Sales and Expenses cleared successfully!' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 A&B Tools Business Manager Running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`===============================================`);
  const initialData = readDb();
  syncExcelWorkbook(initialData);
});
