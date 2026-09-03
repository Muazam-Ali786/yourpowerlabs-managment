/* YourPower Labs — app.js */

const API = 'http://localhost:3000/api';
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

let currentYear, currentMonth, activeType = 'debit';
let currentUser = null, allCats = [], selectedFile = null, summaryData = null;

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('ypl_token');
  if (!token) { window.location.href = 'login.html'; return; }

  try {
    const res = await apiFetch('/auth/me');
    if (!res.ok) throw new Error();
    currentUser = await res.json();
  } catch { logout(); return; }

  // Apply saved theme
  if (localStorage.getItem('ypl_theme') === 'light') applyTheme('light');

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  document.getElementById('inDate').valueAsDate = now;

  document.getElementById('navUser').textContent = currentUser.username;
  const roleEl = document.getElementById('navRole');
  roleEl.textContent = currentUser.role === 'admin' ? 'Admin' : 'User';
  if (currentUser.role !== 'admin') roleEl.classList.add('user');

  if (currentUser.role === 'admin') {
    document.getElementById('adminBtn').style.display = 'flex';
    document.getElementById('delHead').textContent = '';
    document.getElementById('btnCredit').style.display = 'block';
  }

  // Auto logout - 15 min
  let timer;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { showToast('⏰ Auto logged out'); setTimeout(logout, 1500); }, 15*60*1000);
  };
  ['click','keydown','touchstart'].forEach(e => document.addEventListener(e, resetTimer, {passive:true}));
  resetTimer();

  document.getElementById('prevBtn').onclick = () => changeMonth(-1);
  document.getElementById('nextBtn').onclick = () => changeMonth(1);
  document.getElementById('typeFilter').onchange = renderTable;
  document.getElementById('catFilter').onchange = renderTable;
  document.getElementById('searchBox').oninput = renderTable;

  // Drag drop upload
  const ua = document.getElementById('uploadArea');
  ua.addEventListener('dragover', e => { e.preventDefault(); ua.style.borderColor='var(--accent)'; });
  ua.addEventListener('dragleave', () => ua.style.borderColor='');
  ua.addEventListener('drop', e => { e.preventDefault(); ua.style.borderColor=''; if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

  // Overlay close on click outside
  ['adminOverlay','catOverlay','passOverlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) document.getElementById(id).classList.remove('open');
    });
  });

  await loadCats();
  await refresh();
});

/* ── API ── */
function apiFetch(path, opts={}) {
  const token = localStorage.getItem('ypl_token');
  opts.headers = { ...(opts.headers||{}), 'Authorization': `Bearer ${token}` };
  if (opts.body && !opts.headers['Content-Type'])
    opts.headers['Content-Type'] = 'application/json';
  return fetch(API + path, opts);
}

/* ── AUTH ── */
async function doLogout() {
  try { await apiFetch('/auth/logout', {method:'POST'}); } catch {}
  logout();
}
function logout() {
  localStorage.removeItem('ypl_token');
  localStorage.removeItem('ypl_user');
  window.location.href = 'login.html';
}

/* ── THEME ── */
function toggleTheme() {
  const cur = localStorage.getItem('ypl_theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  document.getElementById('themeBtn').textContent = t === 'light' ? '🌙' : '☀️';
  localStorage.setItem('ypl_theme', t);
}

/* ── HELPERS ── */
function toMonthStr(y, m) { return `${y}-${String(m+1).padStart(2,'0')}`; }
function fmtRs(n) { return 'Rs ' + Math.abs(n).toLocaleString(); }
function fmtDate(d) {
  const dt = new Date(d+'T00:00:00');
  return `${dt.getDate()} ${MONTHS[dt.getMonth()].slice(0,3)} ${dt.getFullYear()}`;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── MONTH NAV ── */
function changeMonth(dir) {
  currentMonth += dir;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  refresh();
}

/* ── TYPE TOGGLE ── */
function setType(t) {
  activeType = t;
  document.getElementById('btnDebit').className  = 'type-btn' + (t==='debit' ? ' active-debit' : '');
  document.getElementById('btnCredit').className = 'type-btn' + (t==='credit' ? ' active-credit' : '');
}

/* ── FILE UPLOAD ── */
function onFileSelect(e) { if(e.target.files[0]) handleFile(e.target.files[0]); }
function handleFile(f) {
  selectedFile = f;
  const prev = document.getElementById('uploadPreview');
  const img  = document.getElementById('previewImg');
  document.getElementById('previewName').textContent = f.name;
  prev.style.display = 'flex';
  if (f.type.startsWith('image/')) { img.src = URL.createObjectURL(f); img.style.display='block'; }
  else img.style.display = 'none';
}
function clearFile() {
  selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('previewImg').src = '';
}

/* ── LIGHTBOX ── */
function openLightbox(src) {
  document.getElementById('lbImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lbImg').src = '';
}

/* ── CATEGORIES ── */
async function loadCats() {
  const res = await apiFetch('/categories');
  allCats = await res.json();

  // Cat filter dropdown
  const cf = document.getElementById('catFilter');
  const prev = cf.value;
  cf.innerHTML = '<option value="">All Categories</option>';
  allCats.forEach(c => { const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; cf.appendChild(o); });
  cf.value = prev;

  // Cat select in form
  const ic = document.getElementById('inCat');
  const pv = ic.value;
  ic.innerHTML = '';
  allCats.forEach(c => { const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; ic.appendChild(o); });
  ic.value = pv;

  renderCatList();
}

function renderCatList() {
  const isAdmin = currentUser?.role === 'admin';
  document.getElementById('catList').innerHTML = allCats.map(c => `
    <div class="cat-item">
      <span class="cat-dot" style="background:${c.color}"></span>
      <span class="cat-name">${c.name}</span>
      ${c.is_default
        ? '<span class="cat-tag">default</span>'
        : isAdmin
          ? `<button class="btn-del-cat" onclick="deleteCat(${c.id},'${c.name}')">✕</button>`
          : '<span class="cat-tag">custom</span>'}
    </div>`).join('');
}

function openCatModal() { document.getElementById('catOverlay').classList.add('open'); }
function closeCatModal() {
  document.getElementById('catOverlay').classList.remove('open');
  document.getElementById('catName').value = '';
}

async function saveCategory() {
  const name = document.getElementById('catName').value.trim();
  const color = document.getElementById('catColor').value;
  if (!name) { alert('Enter a category name.'); return; }
  const res = await apiFetch('/categories', { method:'POST', body: JSON.stringify({name,color}) });
  if (res.status === 409) { alert(`"${name}" already exists.`); return; }
  if (!res.ok) { alert('Error.'); return; }
  closeCatModal();
  await loadCats();
  showToast(`✅ "${name}" added!`);
}

async function deleteCat(id, name) {
  if (!confirm(`Delete category "${name}"?`)) return;
  const res = await apiFetch(`/categories/${id}`, {method:'DELETE'});
  if (!res.ok) { alert('Cannot delete.'); return; }
  await loadCats(); await refresh();
  showToast('🗑 Category deleted');
}

/* ── MAIN REFRESH ── */
async function refresh() {
  const ms = toMonthStr(currentYear, currentMonth);
  document.getElementById('monthLabel').textContent = `${MONTHS[currentMonth]} ${currentYear}`;
  try {
    const res = await apiFetch(`/summary/${ms}`);
    if (res.status === 401) { logout(); return; }
    summaryData = await res.json();
    updateBalance(summaryData);
    renderTable();
    renderBreakdown(summaryData);
  } catch {
    document.getElementById('tbody').innerHTML =
      `<tr><td colspan="9" style="text-align:center;color:var(--red);padding:30px">Cannot connect to backend.</td></tr>`;
  }
}

/* ── BALANCE ── */
function updateBalance(s) {
  document.getElementById('bBudget').textContent = fmtRs(s.budget);
  document.getElementById('bCredit').textContent = '+ ' + fmtRs(s.total_credit);
  document.getElementById('bDebit').textContent  = '− ' + fmtRs(s.total_debit);

  const mb = document.getElementById('bMonth');
  mb.textContent = (s.this_month_balance<0?'− ':'')+fmtRs(s.this_month_balance);
  mb.className = 'bal-val ' + (s.this_month_balance>=0?'green':'red');

  const cf = document.getElementById('bCarry');
  const carry = s.carry_forward||0;
  cf.textContent = (carry<0?'− ':'+ ')+fmtRs(carry);
  cf.className = 'bal-val ' + (carry>=0?'purple':'red');

  const tb = document.getElementById('bTotal');
  const total = s.total_balance||0;
  tb.textContent = (total<0?'− ':'')+fmtRs(total);
  tb.className = 'bal-val ' + (total>=0?'green':'red');
}

/* ── TABLE ── */
function renderTable() {
  if (!summaryData) return;
  const typeF = document.getElementById('typeFilter').value;
  const catF  = document.getElementById('catFilter').value;
  const srch  = document.getElementById('searchBox').value.toLowerCase();
  const isAdmin = currentUser?.role === 'admin';

  let rows = [...summaryData.expenses];
  if (typeF) rows = rows.filter(e => e.type === typeF);
  if (catF)  rows = rows.filter(e => e.category === catF);
  if (srch)  rows = rows.filter(e =>
    (e.description||'').toLowerCase().includes(srch) ||
    e.category.toLowerCase().includes(srch) ||
    (e.added_by||'').toLowerCase().includes(srch));

  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('emptyState');

  if (!rows.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display = 'none';

  const catMap = {};
  allCats.forEach(c => catMap[c.name] = c.color);

  tbody.innerHTML = rows.map((e,i) => {
    const isD = e.type==='debit';
    const color = catMap[e.category]||'#94a3b8';

    // Receipt cell
    let rcell = '<span style="color:var(--muted)">—</span>';
    if (e.receipt_path) {
      const url = `http://localhost:3000${e.receipt_path}`;
      const ext = e.receipt_path.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','gif','webp'].includes(ext)) {
        rcell = `<img src="${url}" class="receipt-thumb" onclick="openLightbox('${url}')" title="View receipt"/>`;
      } else if (ext==='pdf') {
        rcell = `<button class="receipt-btn" onclick="window.open('${url}','_blank')">📄 PDF</button>`;
      }
    }

    return `<tr>
      <td style="color:var(--muted)">${i+1}</td>
      <td style="white-space:nowrap">${fmtDate(e.date)}</td>
      <td><span class="badge ${isD?'badge-debit':'badge-credit'}">${isD?'− Debit':'+ Credit'}</span></td>
      <td><span class="cat-dot" style="background:${color}"></span>${e.category}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.description||''}">${e.description||'—'}</td>
      <td class="${isD?'amt-debit':'amt-credit'}">${isD?'−':'+'}Rs ${Number(e.amount).toLocaleString()}</td>
      <td style="color:var(--muted);font-size:12px">${e.added_by||'—'}</td>
      <td>${rcell}</td>
      ${isAdmin ? `<td><button class="btn-del" onclick="deleteEntry(${e.id})" title="Delete">🗑</button></td>` : '<td></td>'}
    </tr>`;
  }).join('');
}

/* ── BREAKDOWN ── */
function renderBreakdown(s) {
  const cats = s.categories;
  const catMap = {}; allCats.forEach(c => catMap[c.name]=c.color);
  const sorted = Object.entries(cats).map(([n,v])=>({n,t:v.debit+v.credit})).sort((a,b)=>b.t-a.t);
  const grand = sorted.reduce((s,c)=>s+c.t,0)||1;
  const el = document.getElementById('breakdown');
  if (!sorted.length) { el.innerHTML='<p style="color:var(--muted);font-size:13px">No data this month.</p>'; return; }
  el.innerHTML = sorted.map(c=>`
    <div class="cat-bar-row">
      <div class="cat-bar-top">
        <span><span class="cat-dot" style="background:${catMap[c.n]||'#94a3b8'}"></span>${c.n}</span>
        <span style="font-size:12px;color:var(--muted)">Rs ${c.t.toLocaleString()}</span>
      </div>
      <div class="cat-bar-track">
        <div class="cat-bar-fill" style="width:${(c.t/grand*100).toFixed(1)}%;background:${catMap[c.n]||'#94a3b8'}"></div>
      </div>
    </div>`).join('');
}

/* ── ADD ENTRY ── */
async function addEntry() {
  const date   = document.getElementById('inDate').value;
  const amount = parseFloat(document.getElementById('inAmount').value);
  const cat    = document.getElementById('inCat').value;
  const desc   = document.getElementById('inDesc').value.trim();

  if (!date || !amount || amount<=0) { alert('Enter valid date and amount.'); return; }

  const fd = new FormData();
  fd.append('date', date); fd.append('amount', amount);
  fd.append('type', activeType); fd.append('category', cat);
  fd.append('description', desc);
  if (selectedFile) fd.append('receipt', selectedFile);

  const res = await fetch(`${API}/expenses`, {
    method:'POST',
    headers: { 'Authorization': `Bearer ${localStorage.getItem('ypl_token')}` },
    body: fd
  });

  if (res.status===401) { logout(); return; }
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    alert(err.detail || 'Could not save.'); return;
  }

  document.getElementById('inAmount').value = '';
  document.getElementById('inDesc').value   = '';
  clearFile();

  const d = new Date(date+'T00:00:00');
  currentMonth = d.getMonth(); currentYear = d.getFullYear();
  await refresh();
  showToast(activeType==='debit' ? '📤 Debit added!' : '📥 Credit added!');
}

/* ── DELETE ENTRY ── */
async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  const res = await apiFetch(`/expenses/${id}`, {method:'DELETE'});
  if (!res.ok) { alert('Could not delete.'); return; }
  await refresh();
  showToast('🗑 Deleted');
}

/* ── ADMIN PANEL ── */
function openAdmin() {
  document.getElementById('adminOverlay').classList.add('open');
  const now = new Date();
  document.getElementById('budgetMonth').value = toMonthStr(now.getFullYear(), now.getMonth());
  loadUsers();
}
function closeAdmin() { document.getElementById('adminOverlay').classList.remove('open'); }

function switchTab(tab, btn) {
  document.querySelectorAll('.atab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (tab==='budgets') loadBudgets();
}

async function loadUsers() {
  const res = await apiFetch('/users');
  const users = await res.json();
  document.getElementById('userList').innerHTML = users.map(u=>`
    <div class="user-row">
      <span class="user-name">👤 ${u.username}</span>
      <span class="${u.role==='admin'?'tag-admin':'tag-user'}">${u.role}</span>
      <span style="font-size:11px;color:var(--muted)">${(u.created_at||'').split('T')[0]}</span>
      <button class="btn-sm" onclick="openPassModal(${u.id},'${u.username}')">🔑</button>
      ${u.username!=='Admin'?`<button class="btn-sm danger" onclick="deleteUser(${u.id},'${u.username}')">🗑</button>`:''}
    </div>`).join('');
}

async function createUser() {
  const username = document.getElementById('nuName').value.trim();
  const password = document.getElementById('nuPass').value;
  const role     = document.getElementById('nuRole').value;
  if (!username||!password) { alert('Enter username and password.'); return; }
  const res = await apiFetch('/users', {method:'POST', body:JSON.stringify({username,password,role})});
  if (res.status===409) { alert('Username already exists.'); return; }
  if (!res.ok) { alert('Error.'); return; }
  document.getElementById('nuName').value=''; document.getElementById('nuPass').value='';
  await loadUsers();
  showToast(`✅ "${username}" created!`);
}

function openPassModal(uid, uname) {
  document.getElementById('passUid').value = uid;
  document.getElementById('passSubtitle').textContent = `Change password for: ${uname}`;
  document.getElementById('passInput').value = '';
  document.getElementById('passOverlay').classList.add('open');
}
function closePassModal() { document.getElementById('passOverlay').classList.remove('open'); }

async function savePassword() {
  const uid  = document.getElementById('passUid').value;
  const pass = document.getElementById('passInput').value;
  if (!pass) { alert('Enter new password.'); return; }
  const res = await apiFetch(`/users/${uid}/password`, {method:'PUT', body:JSON.stringify({new_password:pass})});
  if (!res.ok) { alert('Error.'); return; }
  closePassModal();
  showToast('✅ Password updated!');
}

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"?`)) return;
  const res = await apiFetch(`/users/${id}`, {method:'DELETE'});
  if (!res.ok) { alert('Cannot delete.'); return; }
  await loadUsers();
  showToast(`🗑 "${name}" deleted`);
}

/* ── BUDGETS ── */
async function loadBudgets() {
  const month = document.getElementById('budgetMonth').value;
  if (!month) { alert('Select a month.'); return; }
  const res  = await apiFetch(`/budget/all/${month}`);
  const data = await res.json();
  document.getElementById('budgetList').innerHTML = data.map(u=>`
    <div class="budget-row">
      <span class="budget-name">👤 ${u.username}</span>
      <input class="budget-input" type="number" id="bamt-${u.user_id}" value="${u.amount||0}" min="0"/>
      <button class="btn-save-budget" onclick="saveBudget(${u.user_id},'${month}')">Save</button>
      <span style="font-size:11px;color:var(--muted)">Rs ${Number(u.amount||0).toLocaleString()}</span>
    </div>`).join('');
}

async function saveBudget(uid, month) {
  const amount = parseFloat(document.getElementById(`bamt-${uid}`).value);
  if (!amount||amount<=0) { alert('Enter a valid amount.'); return; }
  const res = await apiFetch('/budget', {method:'POST', body:JSON.stringify({user_id:uid, month, amount})});
  if (!res.ok) { alert('Error.'); return; }
  await loadBudgets();
  showToast('✅ Budget saved!');
}

/* ── EXPORT CSV ── */
async function exportCSV() {
  if (!summaryData) return;
  const rows = [
    ['#','Date','Type','Category','Description','Amount','Added By','Receipt'],
    ...summaryData.expenses.map((e,i)=>[
      i+1, e.date, e.type, e.category,
      `"${e.description||''}"`,
      (e.type==='debit'?'-':'+')+e.amount,
      e.added_by||'',
      e.receipt_path ? `http://localhost:3000${e.receipt_path}` : ''
    ]),
    [],[],
    ['','','','','Budget',summaryData.budget,'',''],
    ['','','','','Credit',summaryData.total_credit,'',''],
    ['','','','','Debit',summaryData.total_debit,'',''],
    ['','','','','This Month',summaryData.this_month_balance,'',''],
    ['','','','','Carry Forward',summaryData.carry_forward,'',''],
    ['','','','','Total',summaryData.total_balance,'',''],
  ];
  const blob = new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `YPL-${toMonthStr(currentYear,currentMonth)}.csv`;
  a.click();
}

/* ── EXPORT PDF ── */
async function exportPDF(type) {
  let url, filename;
  const ms = toMonthStr(currentYear, currentMonth);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  if (type==='monthly') { url=`${API}/export/pdf/${ms}`; filename=`YPL-${ms}.pdf`; }
  else if (type==='weekly') { url=`${API}/export/pdf/week/${dateStr}`; filename=`YPL-Week-${dateStr}.pdf`; }
  else { url=`${API}/export/pdf/year/${currentYear}`; filename=`YPL-Year-${currentYear}.pdf`; }

  showToast('⏳ Generating PDF...');
  try {
    const res = await fetch(url, { headers:{'Authorization':`Bearer ${localStorage.getItem('ypl_token')}`} });
    if (!res.ok) { alert('PDF failed.'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    showToast('✅ PDF downloaded!');
  } catch(e) { alert('PDF error: '+e.message); }
}

/* ── PRINT ── */
async function printReport() {
  if (!summaryData) return;
  const s = summaryData;
  const catMap = {}; allCats.forEach(c=>catMap[c.name]=c.color);
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>YPL Report</title>
  <style>
    body{font-family:Arial,sans-serif;padding:30px;color:#111}
    h1{font-size:18px;margin-bottom:4px}
    .sub{color:#666;font-size:12px;margin-bottom:18px}
    .sum{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
    .sc{padding:10px;border:1px solid #ddd;border-radius:6px}
    .sl{font-size:10px;color:#888;text-transform:uppercase;margin-bottom:3px}
    .sv{font-size:1.1rem;font-weight:700}
    .g{color:#22c55e}.r{color:#ef4444}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f1f5f9;padding:8px;text-align:left;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase}
    td{padding:8px;border:1px solid #e2e8f0}
    tr:nth-child(even)td{background:#f8fafc}
    .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px}
  </style></head><body>
  <h1>⚡ YourPower Labs — Expense Report</h1>
  <div class="sub">${MONTHS[currentMonth]} ${currentYear} | ${new Date().toLocaleString()}</div>
  <div class="sum">
    <div class="sc"><div class="sl">Budget</div><div class="sv">Rs ${s.budget.toLocaleString()}</div></div>
    <div class="sc"><div class="sl">Credit</div><div class="sv g">+Rs ${s.total_credit.toLocaleString()}</div></div>
    <div class="sc"><div class="sl">Debit</div><div class="sv r">-Rs ${s.total_debit.toLocaleString()}</div></div>
    <div class="sc"><div class="sl">Balance</div><div class="sv ${s.total_balance>=0?'g':'r'}">${s.total_balance>=0?'+':'−'}Rs ${Math.abs(s.total_balance).toLocaleString()}</div></div>
  </div>
  <table>
    <tr><th>#</th><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Amount</th><th>By</th></tr>
    ${s.expenses.map((e,i)=>`<tr>
      <td>${i+1}</td><td>${e.date}</td>
      <td style="color:${e.type==='debit'?'#ef4444':'#22c55e'}">${e.type==='debit'?'Debit':'Credit'}</td>
      <td><span class="dot" style="background:${catMap[e.category]||'#94a3b8'}"></span>${e.category}</td>
      <td>${e.description||'—'}</td>
      <td style="color:${e.type==='debit'?'#ef4444':'#22c55e'}">${e.type==='debit'?'−':'+'}Rs ${Number(e.amount).toLocaleString()}</td>
      <td>${e.added_by||'—'}</td>
    </tr>`).join('')}
  </table>
  </body></html>`);
  w.document.close(); w.print();
}
