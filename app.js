// Jiby — local-only expense tracker
// State is persisted entirely in localStorage; no backend.

const STORAGE_KEY = 'jiby.state.v1';

/**
 * Shape:
 * {
 *   months: {
 *     "2026-07": { salary: 3000, bills: [{id,name,amount,createdAt,recurringId?}], ledger: [{id,type,description,amount,resultingBalance,timestamp}] }
 *   },
 *   recurringTemplates: [{id,name,amount,dueDay,active,lastAppliedMonth}],
 *   selectedMonth: "2026-07"
 * }
 */

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load saved data, starting fresh.', e);
  }
  return { months: {}, recurringTemplates: [], selectedMonth: monthKey(new Date()) };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

function formatMonthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatMoney(amount) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function getMonth(key) {
  if (!state.months[key]) {
    state.months[key] = { salary: 0, bills: [], ledger: [] };
  }
  return state.months[key];
}

function remainingBalance(key) {
  const month = getMonth(key);
  const spent = month.bills.reduce((sum, b) => sum + b.amount, 0);
  return month.salary - spent;
}

function addLedgerEntry(monthKeyStr, type, description, amount) {
  const month = getMonth(monthKeyStr);
  month.ledger.unshift({
    id: crypto.randomUUID(),
    type,
    description,
    amount,
    resultingBalance: remainingBalance(monthKeyStr),
    timestamp: new Date().toISOString(),
  });
}

// ---- Mutations ----

function setSalary(monthKeyStr, amount) {
  const month = getMonth(monthKeyStr);
  month.salary = amount;
  addLedgerEntry(monthKeyStr, 'salary_set', `Salary set to ${formatMoney(amount)}`, amount);
  saveState();
}

function addBill(monthKeyStr, name, amount, recurringId = null) {
  const month = getMonth(monthKeyStr);
  const bill = { id: crypto.randomUUID(), name, amount, createdAt: new Date().toISOString(), recurringId };
  month.bills.push(bill);
  addLedgerEntry(monthKeyStr, recurringId ? 'recurring_applied' : 'bill_added', `${name}`, -amount);
  saveState();
}

function deleteBill(monthKeyStr, billId) {
  const month = getMonth(monthKeyStr);
  const idx = month.bills.findIndex((b) => b.id === billId);
  if (idx === -1) return;
  const [removed] = month.bills.splice(idx, 1);
  addLedgerEntry(monthKeyStr, 'bill_removed', `Removed ${removed.name}`, removed.amount);
  saveState();
}

function addRecurringTemplate(name, amount, dueDay) {
  state.recurringTemplates.push({
    id: crypto.randomUUID(), name, amount, dueDay, active: true, lastAppliedMonth: null,
  });
  saveState();
}

function toggleRecurringTemplate(id) {
  const t = state.recurringTemplates.find((t) => t.id === id);
  if (t) t.active = !t.active;
  saveState();
}

function deleteRecurringTemplate(id) {
  state.recurringTemplates = state.recurringTemplates.filter((t) => t.id !== id);
  saveState();
}

// Applies any recurring bill whose due day has passed for the real-world current month.
function applyDueRecurring() {
  const today = new Date();
  const currentMonthKeyStr = monthKey(today);
  const currentDay = today.getDate();
  let changed = false;

  for (const template of state.recurringTemplates) {
    if (!template.active) continue;
    if (template.lastAppliedMonth === currentMonthKeyStr) continue;
    if (currentDay < template.dueDay) continue;

    addBill(currentMonthKeyStr, template.name, template.amount, template.id);
    template.lastAppliedMonth = currentMonthKeyStr;
    changed = true;
  }

  if (changed) saveState();
}

// ---- Rendering ----

function render() {
  const key = state.selectedMonth;
  const month = getMonth(key);
  const remaining = remainingBalance(key);
  const spent = month.bills.reduce((sum, b) => sum + b.amount, 0);

  document.getElementById('monthLabel').textContent = formatMonthLabel(key);
  document.getElementById('remainingBalance').textContent = formatMoney(remaining);
  document.getElementById('remainingBalance').className =
    'text-3xl font-bold mt-1 tabular-nums ' + (remaining < 0 ? 'text-rose-600' : 'text-slate-900');
  document.getElementById('salaryDisplay').textContent = formatMoney(month.salary);
  document.getElementById('spentDisplay').textContent = formatMoney(spent);
  document.getElementById('salaryInput').value = month.salary || '';

  renderBills(month, key);
  renderRecurring();
  renderHistory(month);
}

function renderBills(month, key) {
  const list = document.getElementById('billsList');
  const empty = document.getElementById('billsEmpty');
  list.innerHTML = '';

  if (month.bills.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const bill of [...month.bills].reverse()) {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between py-2.5';
    li.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm font-medium text-slate-800 truncate">${escapeHtml(bill.name)}${bill.recurringId ? ' <span class="text-xs text-indigo-500 font-normal">↻ recurring</span>' : ''}</p>
        <p class="text-xs text-slate-400">${formatDateTime(bill.createdAt)}</p>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <span class="text-sm font-semibold text-rose-600 tabular-nums">-${formatMoney(bill.amount)}</span>
        <button data-action="delete-bill" data-id="${bill.id}" aria-label="Delete bill"
          class="w-8 h-8 flex items-center justify-center text-slate-400 active:text-rose-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`;
    list.appendChild(li);
  }
}

function renderRecurring() {
  const list = document.getElementById('recurringList');
  const empty = document.getElementById('recurringEmpty');
  list.innerHTML = '';

  if (state.recurringTemplates.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const t of state.recurringTemplates) {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between py-2.5';
    li.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm font-medium text-slate-800 truncate">${escapeHtml(t.name)}</p>
        <p class="text-xs text-slate-400">Due day ${t.dueDay} of each month</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-sm font-semibold text-slate-700 tabular-nums">${formatMoney(t.amount)}</span>
        <button data-action="toggle-recurring" data-id="${t.id}"
          class="text-xs font-medium px-2 py-1 rounded-lg ${t.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
          ${t.active ? 'Active' : 'Paused'}
        </button>
        <button data-action="delete-recurring" data-id="${t.id}" aria-label="Delete recurring bill"
          class="w-8 h-8 flex items-center justify-center text-slate-400 active:text-rose-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`;
    list.appendChild(li);
  }
}

const LEDGER_STYLES = {
  salary_set: { icon: '💰', color: 'text-slate-700' },
  bill_added: { icon: '➖', color: 'text-rose-600' },
  bill_removed: { icon: '↩️', color: 'text-emerald-600' },
  recurring_applied: { icon: '↻', color: 'text-indigo-600' },
};

function renderHistory(month) {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  list.innerHTML = '';

  if (month.ledger.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const entry of month.ledger) {
    const style = LEDGER_STYLES[entry.type] || { icon: '•', color: 'text-slate-600' };
    const li = document.createElement('li');
    li.className = 'py-2.5';
    li.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm text-slate-700 truncate">${style.icon} ${escapeHtml(entry.description)}</p>
        <span class="text-sm font-medium tabular-nums ${style.color} shrink-0">${entry.amount >= 0 ? '+' : ''}${formatMoney(entry.amount)}</span>
      </div>
      <p class="text-xs text-slate-400 mt-0.5">${formatDateTime(entry.timestamp)} · balance ${formatMoney(entry.resultingBalance)}</p>`;
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Event wiring ----

function init() {
  applyDueRecurring();
  render();

  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    state.selectedMonth = shiftMonthKey(state.selectedMonth, -1);
    saveState();
    render();
  });

  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    state.selectedMonth = shiftMonthKey(state.selectedMonth, 1);
    saveState();
    render();
  });

  document.getElementById('salaryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('salaryInput');
    const amount = parseFloat(input.value);
    if (isNaN(amount) || amount < 0) return;
    setSalary(state.selectedMonth, amount);
    render();
  });

  document.getElementById('billForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('billName');
    const amountInput = document.getElementById('billAmount');
    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    if (!name || isNaN(amount) || amount <= 0) return;
    addBill(state.selectedMonth, name, amount);
    nameInput.value = '';
    amountInput.value = '';
    render();
  });

  document.getElementById('recurringForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('recurringName');
    const amountInput = document.getElementById('recurringAmount');
    const dueDayInput = document.getElementById('recurringDueDay');
    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const dueDay = parseInt(dueDayInput.value, 10);
    if (!name || isNaN(amount) || amount <= 0 || isNaN(dueDay) || dueDay < 1 || dueDay > 31) return;
    addRecurringTemplate(name, amount, dueDay);
    nameInput.value = '';
    amountInput.value = '';
    dueDayInput.value = '';
    render();
  });

  document.getElementById('billsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="delete-bill"]');
    if (!btn) return;
    if (confirm('Delete this bill? Its amount will be added back to your balance.')) {
      deleteBill(state.selectedMonth, btn.dataset.id);
      render();
    }
  });

  document.getElementById('recurringList').addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-action="toggle-recurring"]');
    const deleteBtn = e.target.closest('[data-action="delete-recurring"]');
    if (toggleBtn) {
      toggleRecurringTemplate(toggleBtn.dataset.id);
      render();
    } else if (deleteBtn) {
      if (confirm('Delete this recurring bill? Future months will no longer be charged.')) {
        deleteRecurringTemplate(deleteBtn.dataset.id);
        render();
      }
    }
  });

  document.getElementById('historyToggle').addEventListener('click', () => {
    document.getElementById('historyList').classList.toggle('hidden');
    document.getElementById('historyChevron').classList.toggle('rotate-180');
  });
}

init();
