// Admin dashboard. Relies on window.apiFetch / window.API_BASE_URL from config.js.

let currentAdmin = null;

function showToast(msg) {
    const t = document.getElementById('admin-toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function money(n) { return `$${Number(n || 0).toFixed(2)}`; }
function dateFmt(d) { return d ? new Date(d).toLocaleDateString() + ' ' + new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }

// -------------------------------------------------------------
// AUTH
// -------------------------------------------------------------
async function checkAdminAuth() {
    try {
        const data = await apiFetch('/api/admin/me');
        currentAdmin = data.admin;
        enterDashboard();
    } catch {
        currentAdmin = null;
        document.getElementById('admin-login-screen').style.display = 'flex';
        document.getElementById('admin-shell').style.display = 'none';
    }
}

document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('admin-login-email').value;
    const password = document.getElementById('admin-login-password').value;
    const errorEl = document.getElementById('admin-login-error');
    errorEl.style.display = 'none';

    try {
        const data = await apiFetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        currentAdmin = data.admin;
        enterDashboard();
    } catch (err) {
        errorEl.innerText = err.message;
        errorEl.style.display = 'block';
    }
});

document.getElementById('admin-logout-btn').addEventListener('click', async () => {
    await apiFetch('/api/admin/logout', { method: 'POST' });
    currentAdmin = null;
    window.location.reload();
});

function enterDashboard() {
    document.getElementById('admin-login-screen').style.display = 'none';
    document.getElementById('admin-shell').style.display = 'block';
    document.getElementById('admin-role-badge').innerText = currentAdmin.role;

    const isOwner = currentAdmin.role === 'owner';
    document.getElementById('team-nav-btn').style.display = isOwner ? 'block' : 'none';
    document.getElementById('audit-nav-btn').style.display = isOwner ? 'block' : 'none';

    loadDashboardStats();
}

// -------------------------------------------------------------
// TAB NAVIGATION
// -------------------------------------------------------------
document.querySelectorAll('#admin-sidebar nav button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#admin-sidebar nav button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById(`tab-${tab}`).classList.add('active');

        if (tab === 'dashboard') loadDashboardStats();
        if (tab === 'products') loadProducts();
        if (tab === 'scrape') loadScrapeJobs();
        if (tab === 'orders') loadOrders();
        if (tab === 'coupons') loadCoupons();
        if (tab === 'customers') loadCustomers();
        if (tab === 'team') loadTeam();
        if (tab === 'audit') loadAuditLog();
    });
});

// -------------------------------------------------------------
// DASHBOARD
// -------------------------------------------------------------
async function loadDashboardStats() {
    try {
        const s = await apiFetch('/api/admin/stats');
        const statusMap = {};
        s.ordersByStatus.forEach(row => statusMap[row.status] = row.count);

        document.getElementById('stat-grid').innerHTML = `
            <div class="stat-card"><div class="label">Revenue</div><div class="value">${money(s.revenue)}</div></div>
            <div class="stat-card"><div class="label">Customers</div><div class="value">${s.customerCount}</div></div>
            <div class="stat-card"><div class="label">Active Products</div><div class="value">${s.productCount}</div></div>
            <div class="stat-card"><div class="label">Pending Orders</div><div class="value">${statusMap.pending || 0}</div></div>
            <div class="stat-card"><div class="label">Pending Scrape Jobs</div><div class="value">${s.pendingScrapeJobs}</div></div>
        `;

        const list = document.getElementById('low-stock-list');
        list.innerHTML = s.lowStock.length
            ? s.lowStock.map(p => `<li><span>${p.title}</span><span>${p.stock_quantity} left</span></li>`).join('')
            : '<li class="admin-empty" style="border:none;">Nothing running low.</li>';
    } catch (err) {
        showToast(err.message);
    }
}

// -------------------------------------------------------------
// PRODUCTS
// -------------------------------------------------------------
let editingProductId = null;

async function loadProducts() {
    const tbody = document.getElementById('products-table-body');
    try {
        const products = await apiFetch('/api/admin/products');
        tbody.innerHTML = products.length ? products.map(p => `
            <tr>
                <td><img src="${p.default_image || ''}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;"></td>
                <td>${p.title}</td>
                <td>${p.category || '—'}</td>
                <td>${money(p.base_retail_price)}</td>
                <td>${p.stock_quantity}</td>
                <td><span class="badge ${p.active ? 'active' : 'inactive'}">${p.active ? 'Active' : 'Hidden'}</span></td>
                <td>
                    <button class="admin-btn small ghost" onclick="editProduct('${p.product_id}')">Edit</button>
                    <button class="admin-btn small danger" onclick="deleteProduct('${p.product_id}')">Delete</button>
                </td>
            </tr>
        `).join('') : `<tr><td colspan="7" class="admin-empty">No products yet — add one, or queue a scrape job.</td></tr>`;

        window._adminProducts = products;
    } catch (err) {
        showToast(err.message);
    }
}

document.getElementById('new-product-btn').addEventListener('click', () => {
    editingProductId = null;
    ['pf-id', 'pf-title', 'pf-category', 'pf-price', 'pf-stock', 'pf-image', 'pf-description'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('pf-id').disabled = false;
    document.getElementById('product-form-card').style.display = 'block';
});

document.getElementById('product-cancel-btn').addEventListener('click', () => {
    document.getElementById('product-form-card').style.display = 'none';
});

window.editProduct = function (productId) {
    const p = (window._adminProducts || []).find(x => x.product_id === productId);
    if (!p) return;
    editingProductId = productId;
    document.getElementById('pf-id').value = p.product_id;
    document.getElementById('pf-id').disabled = true;
    document.getElementById('pf-title').value = p.title || '';
    document.getElementById('pf-category').value = p.category || '';
    document.getElementById('pf-price').value = p.base_retail_price || 0;
    document.getElementById('pf-stock').value = p.stock_quantity || 0;
    document.getElementById('pf-image').value = p.default_image || '';
    document.getElementById('pf-description').value = p.description || '';
    document.getElementById('product-form-card').style.display = 'block';
};

document.getElementById('product-save-btn').addEventListener('click', async () => {
    const productId = document.getElementById('pf-id').value.trim();
    const productName = document.getElementById('pf-title').value.trim();
    if (!productId || !productName) { showToast('Product ID and title are required'); return; }

    const payload = {
        productId,
        productName,
        category: document.getElementById('pf-category').value,
        price: parseFloat(document.getElementById('pf-price').value) || 0,
        stockQuantity: parseInt(document.getElementById('pf-stock').value) || 0,
        imageUrl: document.getElementById('pf-image').value,
        description: document.getElementById('pf-description').value
    };

    try {
        await apiFetch('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
        showToast(editingProductId ? 'Product updated' : 'Product added');
        document.getElementById('product-form-card').style.display = 'none';
        loadProducts();
    } catch (err) {
        showToast(err.message);
    }
});

window.deleteProduct = async function (productId) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try {
        await apiFetch(`/api/admin/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
        showToast('Product deleted');
        loadProducts();
    } catch (err) {
        showToast(err.message);
    }
};

// -------------------------------------------------------------
// SCRAPER BOT JOBS
// -------------------------------------------------------------
document.getElementById('scrape-submit-btn').addEventListener('click', async () => {
    const url = document.getElementById('scrape-url-input').value.trim();
    if (!url) { showToast('Enter a vendor URL first'); return; }
    try {
        await apiFetch('/api/admin/scrape-jobs', { method: 'POST', body: JSON.stringify({ vendor_url: url }) });
        document.getElementById('scrape-url-input').value = '';
        showToast('Scrape job queued');
        loadScrapeJobs();
    } catch (err) {
        showToast(err.message);
    }
});

async function loadScrapeJobs() {
    const tbody = document.getElementById('scrape-table-body');
    try {
        const jobs = await apiFetch('/api/admin/scrape-jobs');
        tbody.innerHTML = jobs.length ? jobs.map(j => `
            <tr>
                <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${j.vendor_url}</td>
                <td><span class="badge ${j.status}">${j.status}</span></td>
                <td>${j.result_product_id || (j.error_message ? `<span style="color:var(--admin-danger); font-size:12px;">${j.error_message}</span>` : '—')}</td>
                <td>${dateFmt(j.created_at)}</td>
            </tr>
        `).join('') : `<tr><td colspan="4" class="admin-empty">No scrape jobs yet.</td></tr>`;
    } catch (err) {
        showToast(err.message);
    }
}

// -------------------------------------------------------------
// ORDERS
// -------------------------------------------------------------
document.getElementById('order-status-filter').addEventListener('change', loadOrders);

async function loadOrders() {
    const tbody = document.getElementById('orders-table-body');
    const status = document.getElementById('order-status-filter').value;
    try {
        const url = status ? `/api/admin/orders?status=${status}` : '/api/admin/orders';
        const orders = await apiFetch(url);
        tbody.innerHTML = orders.length ? orders.map(o => `
            <tr>
                <td>#${o.id}</td>
                <td>${o.customer_name || o.email}</td>
                <td>${money(o.total_amount)}</td>
                <td>
                    <select onchange="updateOrderStatus(${o.id}, this.value)">
                        ${['pending', 'processing', 'shipped', 'completed', 'cancelled'].map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </td>
                <td>${dateFmt(o.created_at)}</td>
                <td><button class="admin-btn small ghost" onclick="viewOrder(${o.id})">View</button></td>
            </tr>
        `).join('') : `<tr><td colspan="6" class="admin-empty">No orders yet.</td></tr>`;
    } catch (err) {
        showToast(err.message);
    }
}

window.updateOrderStatus = async function (orderId, status) {
    try {
        await apiFetch(`/api/admin/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        showToast(`Order #${orderId} marked ${status}`);
    } catch (err) {
        showToast(err.message);
    }
};

window.viewOrder = async function (orderId) {
    try {
        const o = await apiFetch(`/api/admin/orders/${orderId}`);
        const lines = o.items.map(i => `${i.quantity} × ${i.product_name} — ${money(i.price)}`).join('\n');
        alert(`Order #${o.id}\nCustomer: ${o.customer_name || o.email}\nStatus: ${o.status}\n\n${lines}\n\nTotal: ${money(o.total_amount)}`);
    } catch (err) {
        showToast(err.message);
    }
};

// -------------------------------------------------------------
// COUPONS
// -------------------------------------------------------------
document.getElementById('coupon-save-btn').addEventListener('click', async () => {
    const code = document.getElementById('cf-code').value.trim();
    const percent = document.getElementById('cf-percent').value;
    const amount = document.getElementById('cf-amount').value;
    const expires = document.getElementById('cf-expires').value;

    if (!code || (!percent && !amount)) { showToast('Enter a code and either a % or $ discount'); return; }

    try {
        await apiFetch('/api/admin/coupons', {
            method: 'POST',
            body: JSON.stringify({
                code,
                discount_percent: percent ? parseFloat(percent) : null,
                discount_amount: amount ? parseFloat(amount) : null,
                expires_at: expires || null
            })
        });
        ['cf-code', 'cf-percent', 'cf-amount', 'cf-expires'].forEach(id => document.getElementById(id).value = '');
        showToast('Coupon created');
        loadCoupons();
    } catch (err) {
        showToast(err.message);
    }
});

async function loadCoupons() {
    const tbody = document.getElementById('coupons-table-body');
    try {
        const coupons = await apiFetch('/api/admin/coupons');
        tbody.innerHTML = coupons.length ? coupons.map(c => `
            <tr>
                <td><strong>${c.code}</strong></td>
                <td>${c.discount_percent ? `${c.discount_percent}%` : money(c.discount_amount)}</td>
                <td><span class="badge ${c.active ? 'active' : 'inactive'}">${c.active ? 'Active' : 'Disabled'}</span></td>
                <td>${c.expires_at ? dateFmt(c.expires_at) : 'Never'}</td>
                <td>
                    <button class="admin-btn small ghost" onclick="toggleCoupon(${c.id}, ${!c.active})">${c.active ? 'Disable' : 'Enable'}</button>
                    <button class="admin-btn small danger" onclick="deleteCoupon(${c.id})">Delete</button>
                </td>
            </tr>
        `).join('') : `<tr><td colspan="5" class="admin-empty">No coupons yet.</td></tr>`;
    } catch (err) {
        showToast(err.message);
    }
}

window.toggleCoupon = async function (id, active) {
    await apiFetch(`/api/admin/coupons/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    loadCoupons();
};
window.deleteCoupon = async function (id) {
    if (!confirm('Delete this coupon?')) return;
    await apiFetch(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    loadCoupons();
};

// -------------------------------------------------------------
// CUSTOMERS
// -------------------------------------------------------------
async function loadCustomers() {
    const tbody = document.getElementById('customers-table-body');
    try {
        const customers = await apiFetch('/api/admin/customers');
        tbody.innerHTML = customers.length ? customers.map(c => `
            <tr>
                <td>${c.email}</td>
                <td>${c.name || '—'}</td>
                <td>${[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                <td>${dateFmt(c.created_at)}</td>
            </tr>
        `).join('') : `<tr><td colspan="4" class="admin-empty">No customers yet.</td></tr>`;
    } catch (err) {
        showToast(err.message);
    }
}

// -------------------------------------------------------------
// TEAM (owner only)
// -------------------------------------------------------------
document.getElementById('team-add-btn').addEventListener('click', async () => {
    const email = document.getElementById('tf-email').value.trim();
    const name = document.getElementById('tf-name').value.trim();
    const password = document.getElementById('tf-password').value;
    const role = document.getElementById('tf-role').value;

    if (!email || !password) { showToast('Email and password required'); return; }

    try {
        await apiFetch('/api/admin/team', { method: 'POST', body: JSON.stringify({ email, name, password, role }) });
        ['tf-email', 'tf-name', 'tf-password'].forEach(id => document.getElementById(id).value = '');
        showToast('Team member added');
        loadTeam();
    } catch (err) {
        showToast(err.message);
    }
});

async function loadTeam() {
    const tbody = document.getElementById('team-table-body');
    try {
        const team = await apiFetch('/api/admin/team');
        tbody.innerHTML = team.map(t => `
            <tr>
                <td>${t.email}</td>
                <td>${t.name || '—'}</td>
                <td><span class="badge ${t.role}">${t.role}</span></td>
                <td><span class="badge ${t.active ? 'active' : 'inactive'}">${t.active ? 'Active' : 'Disabled'}</span></td>
                <td>
                    ${t.id === currentAdmin.id ? '<em style="color:var(--admin-muted); font-size:12px;">(you)</em>' : `
                        <button class="admin-btn small ghost" onclick="toggleTeamActive(${t.id}, ${!t.active})">${t.active ? 'Disable' : 'Enable'}</button>
                        <button class="admin-btn small danger" onclick="removeTeamMember(${t.id})">Remove</button>
                    `}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast(err.message);
    }
}

window.toggleTeamActive = async function (id, active) {
    try {
        await apiFetch(`/api/admin/team/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
        loadTeam();
    } catch (err) {
        showToast(err.message);
    }
};

window.removeTeamMember = async function (id) {
    if (!confirm('Remove this team member? They will lose access immediately.')) return;
    try {
        await apiFetch(`/api/admin/team/${id}`, { method: 'DELETE' });
        showToast('Team member removed');
        loadTeam();
    } catch (err) {
        showToast(err.message);
    }
};

// -------------------------------------------------------------
// AUDIT LOG (owner only)
// -------------------------------------------------------------
async function loadAuditLog() {
    const tbody = document.getElementById('audit-table-body');
    try {
        const rows = await apiFetch('/api/admin/audit-log');
        tbody.innerHTML = rows.length ? rows.map(r => `
            <tr>
                <td>${dateFmt(r.created_at)}</td>
                <td>${r.admin_email}</td>
                <td>${r.action}</td>
                <td style="font-size:12px; color:var(--admin-muted);">${JSON.stringify(r.details || {})}</td>
            </tr>
        `).join('') : `<tr><td colspan="4" class="admin-empty">Nothing logged yet.</td></tr>`;
    } catch (err) {
        showToast(err.message);
    }
}

// -------------------------------------------------------------
// INIT
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', checkAdminAuth);
