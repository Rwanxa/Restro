/* ===== RestaurantOS Frontend Application ===== */

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    user: null,
    token: null,
    currentPage: 'dashboard',
    rawMaterialsLowStockOnly: false,
    posProducts: [],
    posCart: {},
    dashboardRefreshTimer: null,
};

function resetSessionUiState() {
    state.rawMaterialsLowStockOnly = false;
    state.posProducts = [];
    state.posCart = {};
}

// ─── API Helper ───────────────────────────────────────────────────────────────
async function api(method, endpoint, body = null, isFormData = false) {
    const opts = {
        method,
        credentials: 'include',
        headers: {},
    };
    if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
    if (body && !isFormData) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    } else if (body && isFormData) {
        opts.body = body; // FormData
    }
    const res = await fetch(`/api${endpoint}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || 'Request failed');
        err.data = data;
        throw err;
    }
    return data;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = 'all 0.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(title, bodyHTML, onSubmit) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.add('active');

    if (onSubmit) {
        const form = document.getElementById('modal-form');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                await onSubmit(e);
            };
        }
    }
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-overlay').classList.remove('active');
}

// ─── Format Helpers ───────────────────────────────────────────────────────────
function fmt(num) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(num || 0);
}

function fmtDate(dt) {
    return new Date(dt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtShortDate(dt) {
    return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function login(email, password) {
    resetSessionUiState();
    const data = await api('POST', '/auth/login', { email, password });
    state.user = data.user;
    state.token = data.token;
    localStorage.setItem('ros_token', data.token);
    localStorage.setItem('ros_user', JSON.stringify(data.user));
    return data;
}

async function logout() {
    try { await api('POST', '/auth/logout'); } catch (_) { }
    state.user = null;
    state.token = null;
    resetSessionUiState();
    if (state.dashboardRefreshTimer) {
        clearInterval(state.dashboardRefreshTimer);
        state.dashboardRefreshTimer = null;
    }
    localStorage.removeItem('ros_token');
    localStorage.removeItem('ros_user');
    showLoginPage();
}

function restoreSession() {
    const token = localStorage.getItem('ros_token');
    const user = localStorage.getItem('ros_user');
    if (token && user) {
        state.token = token;
        state.user = JSON.parse(user);
        return true;
    }
    return false;
}

// ─── Page Navigation ──────────────────────────────────────────────────────────
function showLoginPage() {
    document.getElementById('login-page').classList.add('active');
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('main-app').classList.remove('active');
}

function showMainApp() {
    document.getElementById('login-page').classList.remove('active');
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('main-app').classList.add('active');
    updateUserUI();
    navigateTo('dashboard');
    startClock();
    startDashboardAutoRefresh();
}

function updateUserUI() {
    const u = state.user;
    if (!u) return;
    const initial = (u.name || 'U')[0].toUpperCase();
    document.getElementById('sidebar-user-name').textContent = u.name;
    document.getElementById('sidebar-user-role').textContent = u.role.replace('_', ' ');
    document.getElementById('sidebar-avatar').textContent = initial;
    document.getElementById('topbar-avatar').textContent = initial;
    document.getElementById('topbar-user-name').textContent = u.name;

    // Show/hide admin section
    const adminSection = document.getElementById('admin-section');
    adminSection.style.display = u.role === 'super_admin' ? '' : 'none';
}

function navigateTo(page) {
    state.currentPage = page;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navEl = document.getElementById(`nav-${page}`);
    if (navEl) navEl.classList.add('active');

    // Update page title
    const titles = { dashboard: 'Dashboard', products: 'Products', 'raw-materials': 'Raw Materials', sales: 'Sales', users: 'Users' };
    document.getElementById('page-title').textContent = titles[page] || page;

    // Show/hide pages
    document.querySelectorAll('.content-page').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
    });
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) {
        pageEl.classList.add('active');
        pageEl.classList.remove('hidden');
    }

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');

    // Load page data
    loadPageData(page);
}

function loadPageData(page) {
    switch (page) {
        case 'dashboard': loadDashboard(); break;
        case 'products': loadProducts(); break;
        case 'raw-materials': loadRawMaterials(); break;
        case 'sales': loadSales(); break;
        case 'users': loadUsers(); break;
    }
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function startClock() {
    const el = document.getElementById('topbar-time');
    const tick = () => {
        el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    setInterval(tick, 1000);
}

function startDashboardAutoRefresh() {
    if (state.dashboardRefreshTimer) return;
    state.dashboardRefreshTimer = setInterval(() => {
        if (state.user && state.currentPage === 'dashboard') {
            loadDashboard();
        }
    }, 15000);
}

function getLocalDateKey(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const [summary, products, sales] = await Promise.all([
            api('GET', '/sales/summary'),
            api('GET', '/products'),
            api('GET', '/sales'),
        ]);

        document.getElementById('stat-revenue-val').textContent = fmt(summary.total_revenue);
        document.getElementById('stat-profit-val').textContent = fmt(summary.total_profit);
        document.getElementById('stat-products-val').textContent = products.length;
        document.getElementById('stat-sales-val').textContent = summary.total_transactions || 0;

        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);
        const todayKey = getLocalDateKey(today);
        const yesterdayKey = getLocalDateKey(yesterday);
        const dailyProfit = sales
            .filter(s => getLocalDateKey(s.date_time) === todayKey)
            .reduce((sum, s) => sum + Number(s.total_profit || 0), 0);
        const yesterdayProfit = sales
            .filter(s => getLocalDateKey(s.date_time) === yesterdayKey)
            .reduce((sum, s) => sum + Number(s.total_profit || 0), 0);

        document.getElementById('kpi-daily-profit').textContent = fmt(dailyProfit);
        document.getElementById('kpi-yesterday-profit').textContent = fmt(yesterdayProfit);
        document.getElementById('kpi-total-sales').textContent = summary.total_transactions || 0;

        const dashCards = document.getElementById('dashboard-product-cards');
        const featured = [...products].sort((a, b) => b.sell_count - a.sell_count).slice(0, 6);
        if (featured.length === 0) {
            dashCards.innerHTML = `<div class="empty-state"><div class="empty-icon">🍕</div><p>No products yet</p></div>`;
        } else {
            dashCards.innerHTML = featured.map((p) => `
              <article class="dashboard-product-card">
                <div class="dashboard-product-media">
                  ${p.photo_url
                    ? `<img src="${p.photo_url}" alt="${escHtml(p.name)}" class="dashboard-product-image" />`
                    : `<div class="dashboard-product-placeholder">🍽️</div>`}
                </div>
                <div class="dashboard-product-info">
                  <strong>${escHtml(p.name)}</strong>
                  <span>Cost: ${fmt(p.manufacturing_cost)}</span>
                  <span>Price: ${fmt(p.selling_price)}</span>
                  <span class="${Number(p.profit_per_item) >= 0 ? 'profit-positive' : 'profit-negative'}">Profit: ${fmt(p.profit_per_item)}</span>
                </div>
              </article>
            `).join('');
        }

        // Top products by sell_count
        const sorted = [...products].sort((a, b) => b.sell_count - a.sell_count).slice(0, 5);
        const topList = document.getElementById('top-products-list');
        if (sorted.length === 0) {
            topList.innerHTML = `<div class="empty-state"><div class="empty-icon">🍕</div><p>No products yet</p></div>`;
        } else {
            topList.innerHTML = sorted.map((p, i) => `
        <div class="rank-item">
          <div class="rank-num">${i + 1}</div>
          <span class="rank-name">${escHtml(p.name)}</span>
          <span class="rank-count">${p.sell_count} sold</span>
        </div>
      `).join('');
        }

        // Recent sales
        const recentList = document.getElementById('recent-sales-list');
        const recent = sales.slice(0, 6);
        if (recent.length === 0) {
            recentList.innerHTML = `<div class="empty-state"><div class="empty-icon">🧾</div><p>No sales yet</p></div>`;
        } else {
            recentList.innerHTML = recent.map(s => `
        <div class="recent-item">
          <div>
            <div class="recent-name">${escHtml(s.product_name || 'Unknown')}</div>
            <div class="recent-meta">${fmtDate(s.date_time)} · qty ${s.quantity}</div>
          </div>
          <span class="recent-amount">${fmt(s.total_price)}</span>
        </div>
      `).join('');
        }
    } catch (err) {
        toast('Failed to load dashboard: ' + err.message, 'error');
    }
}

// ─── Products ─────────────────────────────────────────────────────────────────
async function loadProducts() {
    try {
        const products = await api('GET', '/products');
        const grid = document.getElementById('products-grid');
        const emptyCard = document.getElementById('products-empty-card');
        if (products.length === 0) {
            grid.innerHTML = '';
            emptyCard.classList.remove('hidden');
            return;
        }
        emptyCard.classList.add('hidden');
        grid.innerHTML = products.map(p => {
            const ingredients = Array.isArray(p.ingredients) ? p.ingredients : [];
            const ingredientsPreview = ingredients.length
                ? ingredients.slice(0, 3).map(i => `${escHtml(i.raw_material_name)} (${Number(i.quantity_used)} ${escHtml(i.raw_material_unit)})`).join(' · ')
                : 'No ingredients linked';
            const image = p.photo_url
                ? `<img src="${p.photo_url}" alt="${escHtml(p.name)}" class="product-card-image" />`
                : `<div class="product-card-image-placeholder">🍽️</div>`;
            return `
      <article class="product-card">
        <div class="product-card-media">
          ${image}
        </div>
        <div class="product-card-body">
          <h3 class="product-card-title">${escHtml(p.name)}</h3>
          <p class="product-card-meta">${ingredientsPreview}</p>
          <div class="product-card-stats">
            <div><span>Mfg</span><strong>${fmt(p.manufacturing_cost)}</strong></div>
            <div><span>Price</span><strong>${fmt(p.selling_price)}</strong></div>
            <div><span>Profit</span><strong class="${p.profit_per_item >= 0 ? 'profit-positive' : 'profit-negative'}">${fmt(p.profit_per_item)}</strong></div>
            <div><span>Sold</span><strong>${p.sell_count}</strong></div>
          </div>
          <div class="actions-cell">
            <button class="btn btn-sm btn-secondary" onclick="editProduct('${p.id}')">✏️ Edit</button>
            ${state.user.role === 'super_admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteProduct('${p.id}', decodeURIComponent('${encodeURIComponent(p.name)}'))">🗑️</button>` : ''}
          </div>
        </div>
      </article>
    `;
        }).join('');
    } catch (err) {
        toast('Failed to load products: ' + err.message, 'error');
    }
}

async function showAddProductModal(existingProduct = null) {
    const isEdit = !!existingProduct;
    const p = existingProduct || {};
    let materials = [];
    try {
        materials = await api('GET', '/raw-materials');
    } catch (err) {
        toast('Failed to load raw materials for ingredients: ' + err.message, 'error');
        return;
    }
    const materialOptions = materials.map(m => `<option value="${m.id}" data-unit="${escHtml(m.unit)}">${escHtml(m.name)} (${escHtml(m.unit)})</option>`).join('');
    const existingIngredients = Array.isArray(p.ingredients) ? p.ingredients : [];
    const html = `
    <form class="modal-form" id="modal-form" enctype="multipart/form-data">
      <div class="form-group">
        <label>Product Name *</label>
        <input type="text" name="name" value="${escHtml(p.name || '')}" placeholder="e.g. Margherita Pizza" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Manufacturing Cost ($) (Auto)</label>
          <input type="number" name="manufacturing_cost" value="${p.manufacturing_cost || ''}" step="0.01" min="0" placeholder="0.00" readonly />
        </div>
        <div class="form-group">
          <label>Selling Price ($) *</label>
          <input type="number" name="selling_price" value="${p.selling_price || ''}" step="0.01" min="0" placeholder="0.00" required />
        </div>
      </div>
      <div class="form-group">
        <label>Product Photo</label>
        <div class="upload-dropzone" id="photo-dropzone">
          <input type="file" name="photo" accept="image/*" id="photo-input" class="hidden-file-input" />
          <p class="upload-dropzone-title">Drag and drop product image here</p>
          <p class="upload-dropzone-sub">or click to browse</p>
        </div>
        ${p.photo_url ? `<img src="${p.photo_url}" class="photo-preview" id="photo-preview" />` : '<img class="photo-preview hidden" id="photo-preview" />'}
      </div>
      <div class="form-group">
        <label>Ingredients</label>
        <div id="ingredients-list" class="ingredients-list"></div>
        <button type="button" class="btn btn-sm btn-secondary" id="add-ingredient-row">+ Add Ingredient</button>
      </div>
      <div class="form-group">
        <label>Calculated Profit / Item</label>
        <div class="profit-preview" id="profit-preview">—</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '💾 Save Changes' : '➕ Add Product'}</button>
      </div>
    </form>
  `;
    openModal(isEdit ? 'Edit Product' : 'Add New Product', html, async () => {
        const form = document.getElementById('modal-form');
        const fd = new FormData(form);
        const ingredients = readProductIngredients();
        fd.set('ingredients', JSON.stringify(ingredients));
        try {
            if (isEdit) {
                await api('PUT', `/products/${p.id}`, fd, true);
                toast('Product updated!', 'success');
            } else {
                await api('POST', '/products', fd, true);
                toast('Product added!', 'success');
            }
            closeModal();
            loadProducts();
        } catch (err) {
            toast(err.message, 'error');
        }
    });

    // Photo preview and dropzone
    setTimeout(() => {
        const form = document.getElementById('modal-form');
        if (!form) return;
        const dropzone = document.getElementById('photo-dropzone');
        const photoInput = document.getElementById('photo-input');
        const ingredientsList = document.getElementById('ingredients-list');
        const addIngredientBtn = document.getElementById('add-ingredient-row');
        const mfgInput = form.querySelector('input[name="manufacturing_cost"]');
        const priceInput = form.querySelector('input[name="selling_price"]');
        const materialCostById = new Map(materials.map(m => [m.id, Number(m.cost_per_unit || 0)]));

        const previewImage = (file) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const preview = document.getElementById('photo-preview');
                preview.src = ev.target.result;
                preview.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        };

        if (dropzone && photoInput) {
            dropzone.addEventListener('click', () => photoInput.click());
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('drag-over');
            });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('drag-over');
                const file = e.dataTransfer?.files?.[0];
                if (!file) return;
                const dt = new DataTransfer();
                dt.items.add(file);
                photoInput.files = dt.files;
                previewImage(file);
            });
            photoInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) previewImage(file);
            });
        }

        function updateProfit() {
            let mfg = 0;
            const rows = Array.from(document.querySelectorAll('#ingredients-list .ingredient-row'));
            for (const row of rows) {
                const rawMaterialId = row.querySelector('.ingredient-material')?.value;
                const qty = parseFloat(row.querySelector('.ingredient-qty')?.value);
                if (!rawMaterialId || !Number.isFinite(qty) || qty <= 0) continue;
                mfg += (materialCostById.get(rawMaterialId) || 0) * qty;
            }
            if (mfgInput) mfgInput.value = mfg.toFixed(2);
            const price = parseFloat(priceInput.value) || 0;
            const profit = price - mfg;
            const preview = document.getElementById('profit-preview');
            preview.textContent = fmt(profit);
            preview.className = `profit-preview ${profit >= 0 ? 'profit-positive' : 'profit-negative'}`;
        }

        const renderIngredientRow = (ingredient = null) => {
            const row = document.createElement('div');
            row.className = 'ingredient-row';
            row.innerHTML = `
              <select class="ingredient-material" required>
                <option value="">Select material</option>
                ${materialOptions}
              </select>
              <input type="number" class="ingredient-qty" min="0.01" step="0.01" placeholder="Qty used" required />
              <button type="button" class="btn btn-sm btn-danger ingredient-remove">✕</button>
            `;
            const select = row.querySelector('.ingredient-material');
            const qty = row.querySelector('.ingredient-qty');
            if (ingredient) {
                select.value = ingredient.raw_material_id;
                qty.value = ingredient.quantity_used;
            }
            row.querySelector('.ingredient-remove').addEventListener('click', () => {
                row.remove();
                updateProfit();
            });
            select.addEventListener('change', updateProfit);
            qty.addEventListener('input', updateProfit);
            ingredientsList.appendChild(row);
            updateProfit();
        };

        if (addIngredientBtn) {
            addIngredientBtn.addEventListener('click', () => renderIngredientRow());
        }
        if (existingIngredients.length) {
            existingIngredients.forEach(i => renderIngredientRow(i));
        }

        if (mfgInput) mfgInput.addEventListener('input', updateProfit);
        if (priceInput) priceInput.addEventListener('input', updateProfit);
        updateProfit();
    }, 30);
}

function readProductIngredients() {
    const rows = Array.from(document.querySelectorAll('#ingredients-list .ingredient-row'));
    const ingredients = [];
    for (const row of rows) {
        const raw_material_id = row.querySelector('.ingredient-material').value;
        const quantity_used = parseFloat(row.querySelector('.ingredient-qty').value);
        if (!raw_material_id && !Number.isFinite(quantity_used)) continue;
        if (!raw_material_id || !Number.isFinite(quantity_used) || quantity_used <= 0) {
            throw new Error('Please provide valid raw material and quantity for each ingredient row.');
        }
        ingredients.push({ raw_material_id, quantity_used });
    }
    return ingredients;
}

async function editProduct(id) {
    try {
        const product = await api('GET', `/products/${id}`);
        showAddProductModal(product);
    } catch (err) {
        toast('Failed to load product: ' + err.message, 'error');
    }
}

async function deleteProduct(id, name) {
    if (!confirm(`Delete product "${name}"? This cannot be undone.`)) return;
    try {
        await api('DELETE', `/products/${id}`);
        toast('Product deleted.', 'success');
        loadProducts();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ─── Raw Materials ────────────────────────────────────────────────────────────
async function loadRawMaterials() {
    try {
        const materials = await api('GET', '/raw-materials');
        const lowStockResult = await api('GET', '/raw-materials/low-stock');
        const lowStockIds = new Set((lowStockResult.items || []).map(item => item.id));
        const visibleMaterials = state.rawMaterialsLowStockOnly
            ? materials.filter(m => lowStockIds.has(m.id))
            : materials;

        updateRawMaterialStats(materials, lowStockResult.count || 0);
        updateLowStockAlert(lowStockResult.count || 0);

        const tbody = document.getElementById('materials-tbody');
        if (visibleMaterials.length === 0) {
            const isFiltered = state.rawMaterialsLowStockOnly;
            tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">${isFiltered ? '✅' : '🥦'}</div><p>${isFiltered ? 'No low-stock items right now.' : 'No raw materials yet. Add your first item!'}</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = visibleMaterials.map(m => {
            const isLowStock = lowStockIds.has(m.id);
            const quantity = Number(m.quantity_available || 0);
            const threshold = Number(m.low_stock_threshold || 0);
            const totalValue = quantity * Number(m.cost_per_unit || 0);
            return `
      <tr class="${isLowStock ? 'low-stock' : ''}">
        <td><strong>${escHtml(m.name)}</strong></td>
        <td>${quantity} ${escHtml(m.unit)}</td>
        <td>${threshold} ${escHtml(m.unit)}</td>
        <td><span class="${isLowStock ? 'badge-low-stock' : 'badge-ok'}">${isLowStock ? 'Low Stock' : 'In Stock'}</span></td>
        <td>${escHtml(m.unit)}</td>
        <td>${fmt(m.cost_per_unit)}</td>
        <td class="${totalValue > 0 ? 'profit-positive' : ''}">${fmt(totalValue)}</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-sm btn-secondary" onclick="editMaterial('${m.id}')">✏️ Edit</button>
            ${state.user.role === 'super_admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteMaterial('${m.id}', '${escHtml(m.name)}')">🗑️</button>` : ''}
          </div>
        </td>
      </tr>
    `;
        }).join('');
    } catch (err) {
        toast('Failed to load raw materials: ' + err.message, 'error');
    }
}

function updateRawMaterialStats(materials, lowStockCount) {
    const total = materials.length;
    const inventoryValue = materials.reduce((sum, m) => sum + (Number(m.quantity_available || 0) * Number(m.cost_per_unit || 0)), 0);
    const uniqueUnits = new Set(materials.map(m => (m.unit || '').trim().toLowerCase()).filter(Boolean)).size;

    document.getElementById('rm-stat-total').textContent = total;
    document.getElementById('rm-stat-value').textContent = fmt(inventoryValue);
    document.getElementById('rm-stat-lowstock').textContent = lowStockCount;
    document.getElementById('rm-stat-units').textContent = uniqueUnits;
}

function updateLowStockAlert(lowStockCount) {
    const lowStockAlert = document.getElementById('low-stock-alert');
    const lowStockAlertText = document.getElementById('low-stock-alert-text');
    const lowStockCard = document.getElementById('rm-stat-lowstock-card');

    if (lowStockCount > 0) {
        lowStockAlert.classList.remove('hidden');
        lowStockAlertText.textContent = `${lowStockCount} item${lowStockCount === 1 ? '' : 's'} running low on stock.`;
        lowStockCard.classList.add('rm-stat-card--warning');
    } else {
        lowStockAlert.classList.add('hidden');
        lowStockCard.classList.remove('rm-stat-card--warning');
    }
}

function showAddMaterialModal(existing = null) {
    const isEdit = !!existing;
    const m = existing || {};
    const html = `
    <form class="modal-form" id="modal-form">
      <div class="form-group">
        <label>Material Name *</label>
        <input type="text" name="name" value="${escHtml(m.name || '')}" placeholder="e.g. Wheat Flour" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Quantity Available *</label>
          <input type="number" name="quantity_available" value="${m.quantity_available || ''}" step="0.01" min="0" placeholder="0" required />
        </div>
        <div class="form-group">
          <label>Unit *</label>
          <input type="text" name="unit" value="${escHtml(m.unit || '')}" placeholder="kg, liters, pcs..." required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Cost Per Unit ($) *</label>
          <input type="number" name="cost_per_unit" value="${m.cost_per_unit || ''}" step="0.01" min="0" placeholder="0.00" required />
        </div>
        <div class="form-group">
          <label>Low-Stock Threshold *</label>
          <input type="number" name="low_stock_threshold" value="${m.low_stock_threshold || 10}" step="0.01" min="0" placeholder="10" required />
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '💾 Save Changes' : '➕ Add Material'}</button>
      </div>
    </form>
  `;
    openModal(isEdit ? 'Edit Raw Material' : 'Add Raw Material', html, async () => {
        const form = document.getElementById('modal-form');
        const fd = new FormData(form);
        const body = Object.fromEntries(fd.entries());
        try {
            if (isEdit) {
                await api('PUT', `/raw-materials/${m.id}`, body);
                toast('Material updated!', 'success');
            } else {
                await api('POST', '/raw-materials', body);
                toast('Material added!', 'success');
            }
            closeModal();
            loadRawMaterials();
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

async function editMaterial(id) {
    try {
        const material = await api('GET', `/raw-materials/${id}`);
        showAddMaterialModal(material);
    } catch (err) {
        toast('Failed to load material: ' + err.message, 'error');
    }
}

async function deleteMaterial(id, name) {
    if (!confirm(`Delete material "${name}"?`)) return;
    try {
        await api('DELETE', `/raw-materials/${id}`);
        toast('Material deleted.', 'success');
        loadRawMaterials();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function toggleRawMaterialsLowStockFilter() {
    state.rawMaterialsLowStockOnly = !state.rawMaterialsLowStockOnly;
    const btn = document.getElementById('filter-lowstock-btn');
    btn.classList.toggle('active', state.rawMaterialsLowStockOnly);
    btn.textContent = state.rawMaterialsLowStockOnly ? 'Show All' : '⚠️ Low Stock Only';
    loadRawMaterials();
}

// ─── Sales ────────────────────────────────────────────────────────────────────
async function loadSales() {
    try {
        const [sales, summary, products] = await Promise.all([
            api('GET', '/sales'),
            api('GET', '/sales/summary'),
            api('GET', '/products'),
        ]);

        state.posProducts = products;
        document.getElementById('sum-transactions').textContent = summary.total_transactions || 0;
        document.getElementById('sum-items').textContent = summary.total_items_sold || 0;
        document.getElementById('sum-revenue').textContent = fmt(summary.total_revenue);
        document.getElementById('sum-profit').textContent = fmt(summary.total_profit);
        renderPosProducts(products);
        renderPosCart();

        const tbody = document.getElementById('sales-tbody');
        if (sales.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🧾</div><p>No sales recorded yet.</p></div></td></tr>`;
            return;
        }
        tbody.innerHTML = sales.map(s => `
      <tr>
        <td><strong>${escHtml(s.product_name || 'Unknown')}</strong></td>
        <td>${s.quantity}</td>
        <td>${fmt(s.total_price)}</td>
        <td class="profit-positive">${fmt(s.total_profit)}</td>
        <td>${fmtDate(s.date_time)}</td>
        <td>
          ${state.user.role === 'super_admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteSale('${s.id}')">🗑️</button>` : '—'}
        </td>
      </tr>
    `).join('');
    } catch (err) {
        toast('Failed to load sales: ' + err.message, 'error');
    }
}

function renderPosProducts(products) {
    const grid = document.getElementById('pos-products-grid');
    if (!grid) return;
    if (!products.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><p>No products available.</p></div>`;
        return;
    }
    grid.innerHTML = products.map(p => `
      <button class="pos-product-card" data-product-id="${p.id}" type="button">
        <div class="pos-product-media">
          ${p.photo_url
            ? `<img src="${p.photo_url}" class="pos-product-image" alt="${escHtml(p.name)}" />`
            : `<div class="pos-product-placeholder">🍽️</div>`}
        </div>
        <div class="pos-product-info">
          <strong>${escHtml(p.name)}</strong>
          <span>${fmt(p.selling_price)}</span>
        </div>
      </button>
    `).join('');

    grid.querySelectorAll('.pos-product-card').forEach((el) => {
        el.addEventListener('click', () => {
            addToCart(el.dataset.productId);
            el.classList.remove('added');
            void el.offsetWidth;
            el.classList.add('added');
        });
    });
}

function getPosCartTotals() {
    const items = Object.values(state.posCart);
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalBill = items.reduce((sum, item) => sum + (item.quantity * Number(item.selling_price || 0)), 0);
    const totalProfit = items.reduce((sum, item) => sum + (item.quantity * Number(item.profit_per_item || 0)), 0);
    return { totalItems, totalBill, totalProfit };
}

function renderPosCart() {
    const cartContainer = document.getElementById('pos-cart-items');
    if (!cartContainer) return;
    const items = Object.values(state.posCart);
    if (!items.length) {
        cartContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><p>Cart is empty. Click products to add.</p></div>`;
    } else {
        cartContainer.innerHTML = items.map(item => `
          <div class="pos-cart-item">
            <div class="pos-cart-item-main">
              <strong>${escHtml(item.name)}</strong>
              <span>${fmt(item.selling_price)} each</span>
            </div>
            <div class="pos-cart-controls">
              <button class="btn btn-sm btn-secondary" data-action="dec" data-id="${item.id}" type="button">-</button>
              <input class="pos-qty-input" data-id="${item.id}" type="number" min="1" value="${item.quantity}" />
              <button class="btn btn-sm btn-secondary" data-action="inc" data-id="${item.id}" type="button">+</button>
              <button class="btn btn-sm btn-danger" data-action="remove" data-id="${item.id}" type="button">✕</button>
            </div>
          </div>
        `).join('');
    }

    const totals = getPosCartTotals();
    document.getElementById('pos-cart-total-items').textContent = totals.totalItems;
    document.getElementById('pos-cart-total-bill').textContent = fmt(totals.totalBill);
    document.getElementById('pos-cart-total-profit').textContent = fmt(totals.totalProfit);

    cartContainer.querySelectorAll('[data-action]').forEach((el) => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            const action = el.dataset.action;
            if (action === 'inc') updateCartItemQuantity(id, (state.posCart[id]?.quantity || 0) + 1);
            if (action === 'dec') updateCartItemQuantity(id, (state.posCart[id]?.quantity || 1) - 1);
            if (action === 'remove') removeCartItem(id);
        });
    });
    cartContainer.querySelectorAll('.pos-qty-input').forEach((el) => {
        el.addEventListener('input', () => {
            updateCartItemQuantity(el.dataset.id, parseInt(el.value, 10));
        });
    });
}

function addToCart(productId) {
    const product = state.posProducts.find(p => p.id === productId);
    if (!product) return;
    if (!state.posCart[productId]) {
        state.posCart[productId] = {
            id: product.id,
            name: product.name,
            selling_price: Number(product.selling_price || 0),
            profit_per_item: Number(product.profit_per_item || 0),
            quantity: 0,
        };
    }
    state.posCart[productId].quantity += 1;
    renderPosCart();
}

function updateCartItemQuantity(productId, quantity) {
    const q = Number(quantity);
    if (!state.posCart[productId]) return;
    if (!Number.isFinite(q) || q <= 0) {
        delete state.posCart[productId];
    } else {
        state.posCart[productId].quantity = q;
    }
    renderPosCart();
}

function removeCartItem(productId) {
    delete state.posCart[productId];
    renderPosCart();
}

async function checkoutPosCart() {
    const items = Object.values(state.posCart).map(item => ({
        product_id: item.id,
        quantity: item.quantity,
    }));
    if (!items.length) {
        toast('Add at least one product to cart.', 'info');
        return;
    }
    try {
        const result = await api('POST', '/sales/checkout', { items });
        state.posCart = {};
        renderPosCart();
        triggerCheckoutSuccess(result);
        toast(`Checkout complete. ${result.total_items} item(s) sold.`, 'success');
        loadSales();
    } catch (err) {
        const firstDetail = err?.data?.details?.[0];
        if (firstDetail) {
            toast(`${firstDetail.raw_material_name} short: need ${firstDetail.required} ${firstDetail.unit}, have ${firstDetail.available} ${firstDetail.unit}`, 'error');
        } else {
            toast(err.message, 'error');
        }
    }
}

function triggerCheckoutSuccess(result) {
    const banner = document.getElementById('pos-checkout-success');
    if (!banner) return;
    banner.textContent = `Checkout complete: ${fmt(result.total_bill)} billed`;
    banner.classList.remove('hidden');
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    setTimeout(() => {
        banner.classList.remove('show');
        banner.classList.add('hidden');
    }, 1800);
}

async function deleteSale(id) {
    if (!confirm('Delete this sale record?')) return;
    try {
        await api('DELETE', `/sales/${id}`);
        toast('Sale deleted.', 'success');
        loadSales();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ─── Users ────────────────────────────────────────────────────────────────────
async function loadUsers() {
    if (state.user.role !== 'super_admin') {
        navigateTo('dashboard');
        return;
    }
    try {
        const users = await api('GET', '/auth/users');
        const tbody = document.getElementById('users-tbody');
        tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="user-avatar sm">${(u.name || 'U')[0].toUpperCase()}</div>
            <strong>${escHtml(u.name)}</strong>
          </div>
        </td>
        <td>${escHtml(u.email)}</td>
        <td><span class="badge badge-${u.role === 'super_admin' ? 'admin' : 'staff'}">${u.role.replace('_', ' ')}</span></td>
        <td>${fmtDate(u.created_at)}</td>
        <td>
          ${u.id !== state.user.id
                ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}', '${escHtml(u.name)}')">🗑️ Remove</button>`
                : `<span style="color:var(--text-muted);font-size:12px;">You</span>`}
        </td>
      </tr>
    `).join('');
    } catch (err) {
        toast('Failed to load users: ' + err.message, 'error');
    }
}

function showAddUserModal() {
    const html = `
    <form class="modal-form" id="modal-form">
      <div class="form-group">
        <label>Full Name *</label>
        <input type="text" name="name" placeholder="John Doe" required />
      </div>
      <div class="form-group">
        <label>Email Address *</label>
        <input type="email" name="email" placeholder="john@restaurant.com" required />
      </div>
      <div class="form-group">
        <label>Password *</label>
        <input type="password" name="password" placeholder="Min 6 characters" minlength="6" required />
      </div>
      <div class="form-group">
        <label>Role *</label>
        <select name="role" required>
          <option value="staff">Staff</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">➕ Create User</button>
      </div>
    </form>
  `;
    openModal('Add New User', html, async () => {
        const form = document.getElementById('modal-form');
        const fd = new FormData(form);
        const body = Object.fromEntries(fd.entries());
        try {
            await api('POST', '/auth/register', body);
            toast('User created!', 'success');
            closeModal();
            loadUsers();
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

async function deleteUser(id, name) {
    if (!confirm(`Remove user "${name}"?`)) return;
    try {
        await api('DELETE', `/auth/users/${id}`);
        toast('User removed.', 'success');
        loadUsers();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ─── Security Helper ──────────────────────────────────────────────────────────
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Login form
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('login-btn');
        const errEl = document.getElementById('login-error');
        const btnText = btn.querySelector('.btn-text');
        const btnLoader = btn.querySelector('.btn-loader');

        errEl.classList.add('hidden');
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
        btn.disabled = true;

        try {
            await login(email, password);
            showMainApp();
        } catch (err) {
            errEl.textContent = err.message;
            errEl.classList.remove('hidden');
        } finally {
            btnText.classList.remove('hidden');
            btnLoader.classList.add('hidden');
            btn.disabled = false;
        }
    });

    // Toggle password visibility
    document.getElementById('toggle-pwd').addEventListener('click', () => {
        const input = document.getElementById('login-password');
        input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', logout);

    // Nav items
    document.querySelectorAll('.nav-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(el.dataset.page);
        });
    });

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-overlay')) closeModal();
    });

    // Add buttons
    document.getElementById('add-product-btn').addEventListener('click', () => showAddProductModal());
    document.getElementById('add-material-btn').addEventListener('click', () => showAddMaterialModal());
    document.getElementById('filter-lowstock-btn').addEventListener('click', toggleRawMaterialsLowStockFilter);
    document.getElementById('low-stock-alert-close').addEventListener('click', () => {
        document.getElementById('low-stock-alert').classList.add('hidden');
    });
    document.getElementById('pos-checkout-btn').addEventListener('click', () => checkoutPosCart());
    document.getElementById('add-user-btn').addEventListener('click', () => showAddUserModal());

    // Mobile menu
    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });

    // Restore session or show login
    if (restoreSession()) {
        try {
            // Verify token is still valid
            const me = await api('GET', '/auth/me');
            state.user = me;
            localStorage.setItem('ros_user', JSON.stringify(me));
            showMainApp();
        } catch (_) {
            showLoginPage();
        }
    } else {
        showLoginPage();
    }
});
