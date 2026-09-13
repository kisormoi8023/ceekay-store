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

// --- Forgot password (admin) ---
const adminLoginFormEl = document.getElementById('admin-login-form');
const adminForgotFormEl = document.getElementById('admin-forgot-form');

document.getElementById('admin-show-forgot')?.addEventListener('click', (e) => {
    e.preventDefault();
    adminLoginFormEl.style.display = 'none';
    adminForgotFormEl.style.display = 'block';
});
document.getElementById('admin-forgot-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    adminForgotFormEl.style.display = 'none';
    adminLoginFormEl.style.display = 'block';
});

adminForgotFormEl?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('admin-forgot-email').value.trim();
    const msgEl = document.getElementById('admin-forgot-msg');
    if (!email) return;
    msgEl.style.color = '';
    msgEl.textContent = 'Sending…';
    try {
        const data = await apiFetch('/api/admin/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        msgEl.style.color = 'var(--admin-success, green)';
        msgEl.textContent = data.message || "If an admin account exists for that email, we've sent a reset link.";
        if (data.resetUrl) {
            const a = document.createElement('a');
            a.href = data.resetUrl;
            a.textContent = 'Open reset link';
            msgEl.appendChild(document.createElement('br'));
            msgEl.appendChild(a);
        }
    } catch (err) {
        msgEl.style.color = 'var(--admin-danger, crimson)';
        msgEl.textContent = err.message || 'Request failed.';
    }
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
// PRODUCTS — list view
// -------------------------------------------------------------
const $ = (id) => document.getElementById(id);
let editingProductId = null;

async function loadProducts() {
    const tbody = $('products-table-body');
    showProductList();
    try {
        const products = await apiFetch('/api/admin/products');
        tbody.innerHTML = products.length ? products.map(p => `
            <tr class="row-clickable" onclick="openProductDetail('${p.product_id}')">
                <td><img src="${p.default_image || ''}" alt=""></td>
                <td>${p.title}</td>
                <td>${p.category || '—'}</td>
                <td>${money(p.base_retail_price)}</td>
                <td>${p.stock_quantity}${Number(p.stock_quantity) < 5 ? ' <span class="badge pending">low</span>' : ''}</td>
                <td>${p.units_sold ?? 0}</td>
                <td><span class="badge ${p.active ? 'active' : 'inactive'}">${p.active ? 'Active' : 'Hidden'}</span></td>
                <td onclick="event.stopPropagation()">
                    <button class="admin-btn small ghost" onclick="openProductDetail('${p.product_id}')">Open</button>
                    <button class="admin-btn small danger" onclick="deleteProduct('${p.product_id}')">Delete</button>
                </td>
            </tr>
        `).join('') : `<tr><td colspan="8" class="admin-empty">No products yet — add one, or queue a scrape job.</td></tr>`;
        window._adminProducts = products;
    } catch (err) {
        showToast(err.message);
    }
}

function showProductList() {
    $('products-list-view').style.display = 'block';
    $('product-detail-view').style.display = 'none';
}

$('new-product-btn').addEventListener('click', () => {
    editingProductId = null;
    ['pf-id', 'pf-title', 'pf-category', 'pf-price', 'pf-stock', 'pf-image', 'pf-description'].forEach(id => $(id).value = '');
    $('pf-id').disabled = false;
    $('product-form-card').style.display = 'block';
});
$('product-cancel-btn').addEventListener('click', () => { $('product-form-card').style.display = 'none'; });

$('product-save-btn').addEventListener('click', async () => {
    const productId = $('pf-id').value.trim();
    const productName = $('pf-title').value.trim();
    if (!productId || !productName) { showToast('Product ID and title are required'); return; }
    const payload = {
        productId, productName,
        category: $('pf-category').value,
        price: parseFloat($('pf-price').value) || 0,
        stockQuantity: parseInt($('pf-stock').value) || 0,
        imageUrl: $('pf-image').value,
        description: $('pf-description').value
    };
    try {
        await apiFetch('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Product added');
        $('product-form-card').style.display = 'none';
        loadProducts();
    } catch (err) { showToast(err.message); }
});

window.deleteProduct = async function (productId) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try {
        await apiFetch(`/api/admin/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
        showToast('Product deleted');
        loadProducts();
    } catch (err) { showToast(err.message); }
};

// -------------------------------------------------------------
// PRODUCTS — detail view
// -------------------------------------------------------------
let pdCurrent = null; // { product, images, stats }

window.openProductDetail = async function (productId) {
    try {
        pdCurrent = await apiFetch(`/api/admin/products/${encodeURIComponent(productId)}`);
    } catch (err) { showToast(err.message); return; }

    const { product: p, images, stats } = pdCurrent;
    $('products-list-view').style.display = 'none';
    $('product-detail-view').style.display = 'block';
    window.scrollTo(0, 0);

    $('pd-title-h').innerText = p.title || p.product_id;
    $('pd-meta').innerText = `ID ${p.product_id}  ·  updated ${dateFmt(p.updated_at)}`;
    $('pd-toggle-active').innerText = p.active ? 'Hide from store' : 'Publish to store';

    // stats
    const stockValue = Number(p.stock_quantity || 0) * Number(p.base_retail_price || 0);
    $('pd-stats').innerHTML = [
        ['Units sold', stats.units_sold ?? 0],
        ['Gross revenue', money(stats.gross_revenue)],
        ['Orders', stats.order_count ?? 0],
        ['Last sold', stats.last_ordered ? dateFmt(stats.last_ordered) : '—'],
        ['In stock', p.stock_quantity ?? 0],
        ['Stock value', money(stockValue)],
        ['Variants', (p.variants || []).length],
        ['Status', p.active ? 'Active' : 'Hidden']
    ].map(([label, value]) => `<div class="stat-card"><span class="label">${label}</span><span class="value">${value}</span></div>`).join('');

    // core
    $('pd-title').value = p.title || '';
    $('pd-category').value = p.category || '';
    $('pd-price').value = p.base_retail_price ?? '';
    $('pd-stock').value = p.stock_quantity ?? '';
    $('pd-vendor-url').value = p.vendor_url || '';
    $('pd-description').value = p.description || '';

    renderPdImages(images);
    renderPdVariants(p.variants || []);
};

function renderPdImages(images) {
    const strip = $('pd-image-strip');
    strip.innerHTML = (images && images.length)
        ? images.map((src, i) => `<figure><img src="${src}" alt="">${i === 0 ? '<figcaption>main</figcaption>' : ''}</figure>`).join('')
        : '<p class="pd-meta">No images yet — click “Edit images”.</p>';
}

function renderPdVariants(variants) {
    const body = $('pd-variants-body');
    const empty = $('pd-variants-empty');
    if (!variants.length) {
        body.innerHTML = '';
        empty.style.display = 'block';
        $('pd-save-variants').style.display = 'none';
        return;
    }
    empty.style.display = 'none';
    $('pd-save-variants').style.display = '';
    body.innerHTML = variants.map((v, i) => `
        <tr data-i="${i}">
            <td>${v.image ? `<img src="${v.image}" alt="">` : '—'}</td>
            <td>${v.color || '—'}</td>
            <td>${v.size || '—'}</td>
            <td>${v.sku || '—'}</td>
            <td><input type="number" step="0.01" class="pd-cell v-cost" value="${v.vendor_price ?? ''}"></td>
            <td><input type="number" step="0.01" class="pd-cell v-retail" value="${v.retail_price ?? ''}"></td>
            <td class="v-margin">${marginLabel(v.vendor_price, v.retail_price)}</td>
        </tr>`).join('');

    body.querySelectorAll('tr').forEach(tr => {
        const recompute = () => {
            const cost = parseFloat(tr.querySelector('.v-cost').value);
            const retail = parseFloat(tr.querySelector('.v-retail').value);
            tr.querySelector('.v-margin').innerText = marginLabel(cost, retail);
        };
        tr.querySelector('.v-cost').addEventListener('input', recompute);
        tr.querySelector('.v-retail').addEventListener('input', recompute);
    });
}

function marginLabel(cost, retail) {
    cost = Number(cost); retail = Number(retail);
    if (!retail || !cost) return '—';
    const pct = ((retail - cost) / retail) * 100;
    return `${money(retail - cost)} (${pct.toFixed(0)}%)`;
}

$('pd-back').addEventListener('click', (e) => { e.preventDefault(); loadProducts(); });

$('pd-save-core').addEventListener('click', async () => {
    if (!pdCurrent) return;
    const body = {
        title: $('pd-title').value.trim(),
        category: $('pd-category').value.trim() || null,
        base_retail_price: parseFloat($('pd-price').value) || 0,
        stock_quantity: parseInt($('pd-stock').value) || 0,
        vendor_url: $('pd-vendor-url').value.trim() || null
    };
    await savePatch(body, 'Details saved');
});

$('pd-save-desc').addEventListener('click', async () => {
    if (!pdCurrent) return;
    await savePatch({ description: $('pd-description').value }, 'Description saved');
});

$('pd-save-variants').addEventListener('click', async () => {
    if (!pdCurrent) return;
    const rows = $('pd-variants-body').querySelectorAll('tr');
    const variants = pdCurrent.product.variants.map((v, i) => {
        const tr = rows[i];
        if (!tr) return v;
        return {
            ...v,
            vendor_price: parseFloat(tr.querySelector('.v-cost').value) || 0,
            retail_price: parseFloat(tr.querySelector('.v-retail').value) || 0
        };
    });
    await savePatch({ variants }, 'Variant prices saved');
});

$('pd-toggle-active').addEventListener('click', async () => {
    if (!pdCurrent) return;
    await savePatch({ active: pdCurrent.product.active ? 0 : 1 }, pdCurrent.product.active ? 'Hidden from store' : 'Published');
});

$('pd-delete').addEventListener('click', async () => {
    if (!pdCurrent) return;
    if (!confirm(`Delete "${pdCurrent.product.title}"? This cannot be undone.`)) return;
    try {
        await apiFetch(`/api/admin/products/${encodeURIComponent(pdCurrent.product.product_id)}`, { method: 'DELETE' });
        showToast('Product deleted');
        loadProducts();
    } catch (err) { showToast(err.message); }
});

async function savePatch(body, okMsg) {
    try {
        await apiFetch(`/api/admin/products/${encodeURIComponent(pdCurrent.product.product_id)}`, {
            method: 'PATCH', body: JSON.stringify(body)
        });
        showToast(okMsg);
        openProductDetail(pdCurrent.product.product_id); // reload
    } catch (err) { showToast(err.message); }
}

// -------------------------------------------------------------
// PRODUCTS — image manager modal
// -------------------------------------------------------------
let imgModalList = [];

$('pd-edit-images').addEventListener('click', () => {
    if (!pdCurrent) return;
    imgModalList = [...(pdCurrent.images || [])];
    renderImgModal();
    $('image-modal').style.display = 'flex';
});
function closeImgModal() { $('image-modal').style.display = 'none'; }
$('image-modal-close').addEventListener('click', closeImgModal);
$('image-modal-cancel').addEventListener('click', closeImgModal);

function renderImgModal() {
    const list = $('image-edit-list');
    list.innerHTML = imgModalList.length ? imgModalList.map((src, i) => `
        <li>
            <img src="${src}" alt="">
            <span class="ie-url">${src}</span>
            ${i === 0 ? '<span class="badge active">main</span>' : ''}
            <span class="ie-actions">
                <button class="admin-btn small ghost" ${i === 0 ? 'disabled' : ''} data-act="up" data-i="${i}">↑</button>
                <button class="admin-btn small ghost" ${i === imgModalList.length - 1 ? 'disabled' : ''} data-act="down" data-i="${i}">↓</button>
                <button class="admin-btn small danger" data-act="del" data-i="${i}">Remove</button>
            </span>
        </li>`).join('') : '<li class="pd-meta">No images. Add one below.</li>';

    list.querySelectorAll('button[data-act]').forEach(b => {
        b.addEventListener('click', () => {
            const i = Number(b.dataset.i);
            if (b.dataset.act === 'del') imgModalList.splice(i, 1);
            if (b.dataset.act === 'up' && i > 0) [imgModalList[i - 1], imgModalList[i]] = [imgModalList[i], imgModalList[i - 1]];
            if (b.dataset.act === 'down' && i < imgModalList.length - 1) [imgModalList[i + 1], imgModalList[i]] = [imgModalList[i], imgModalList[i + 1]];
            renderImgModal();
        });
    });
}

$('image-add-btn').addEventListener('click', () => {
    const url = $('image-add-url').value.trim();
    if (!url) return;
    imgModalList.push(url);
    $('image-add-url').value = '';
    renderImgModal();
});
$('image-add-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('image-add-btn').click(); } });

$('image-modal-save').addEventListener('click', async () => {
    if (!pdCurrent) return;
    try {
        await apiFetch(`/api/admin/products/${encodeURIComponent(pdCurrent.product.product_id)}/images`, {
            method: 'PUT', body: JSON.stringify({ images: imgModalList })
        });
        showToast('Photos updated');
        closeImgModal();
        openProductDetail(pdCurrent.product.product_id);
    } catch (err) { showToast(err.message); }
});

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
        tbody.innerHTML = orders.length ? orders.map(o => {
            const method = (o.payment_method || '—').replace('_', ' ');
            const paid = o.payment_status === 'paid';
            const payCell = paid
                ? `<span title="${method}">✔ paid <small>(${method})</small></span>`
                : `<span title="${method}">${method}${o.payment_reference ? ` · ${o.payment_reference}` : ''}</span>
                   <button class="admin-btn small" onclick="markPaid(${o.id})">Mark paid</button>`;
            return `
            <tr>
                <td>#${o.id}</td>
                <td>${o.customer_name || o.email}</td>
                <td>${money(o.total_amount)}</td>
                <td>${payCell}</td>
                <td>
                    <select onchange="updateOrderStatus(${o.id}, this.value)">
                        ${['pending', 'processing', 'shipped', 'completed', 'cancelled'].map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </td>
                <td>${dateFmt(o.created_at)}</td>
                <td><button class="admin-btn small ghost" onclick="viewOrder(${o.id})">View</button></td>
            </tr>`;
        }).join('') : `<tr><td colspan="7" class="admin-empty">No orders yet.</td></tr>`;
    } catch (err) {
        showToast(err.message);
    }
}

async function markPaid(orderId) {
    if (!confirm(`Mark order #${orderId} as paid?`)) return;
    try {
        await apiFetch(`/api/admin/orders/${orderId}/mark-paid`, { method: 'POST' });
        showToast(`Order #${orderId} marked paid`);
        loadOrders();
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
