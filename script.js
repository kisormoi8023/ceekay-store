// NOTE: API_BASE_URL and apiFetch come from config.js (loaded first).

// -------------------------------------------------------------
// 1. Navigation & UI Controls
// -------------------------------------------------------------
function initNavigation() {
    const bar = document.getElementById('bar');
    const close = document.getElementById('close');
    const nav = document.getElementById('navbar');

    if (bar) bar.addEventListener('click', () => nav.classList.add('active'));
    if (close) close.addEventListener('click', () => nav.classList.remove('active'));
}

// -------------------------------------------------------------
// 2. Hero Slideshow Controls
// -------------------------------------------------------------
function initHeroSlideshow() {
    const hero = document.getElementById("hero");
    const dots = document.querySelectorAll(".hero-dot");
    const prevBtn = document.getElementById("heroPrev");
    const nextBtn = document.getElementById("heroNext");

    if (!hero) return;

    let currentSlide = 1;
    const totalSlides = 2;
    let slideInterval;

    function setSlide(index) {
        currentSlide = index;
        if (currentSlide > totalSlides) currentSlide = 1;
        if (currentSlide < 1) currentSlide = totalSlides;

        hero.className = `bg-${currentSlide}`;
        dots.forEach((dot, i) => dot.classList.toggle("active", i + 1 === currentSlide));
    }

    function startSlideshow() {
        slideInterval = setInterval(() => setSlide(currentSlide + 1), 50000);
    }

    function resetTimer() {
        clearInterval(slideInterval);
        startSlideshow();
    }

    if (prevBtn) prevBtn.addEventListener("click", () => { setSlide(currentSlide - 1); resetTimer(); });
    if (nextBtn) nextBtn.addEventListener("click", () => { setSlide(currentSlide + 1); resetTimer(); });

    dots.forEach(dot => {
        dot.addEventListener("click", (e) => {
            const index = parseInt(e.target.getAttribute("data-index"));
            setSlide(index);
            resetTimer();
        });
    });

    startSlideshow();
}

// -------------------------------------------------------------
// 3. Catalog Fetching & Grid Rendering
// -------------------------------------------------------------
async function loadProducts() {
    try {
        const response = await fetch(`${window.API_BASE_URL}/api/products`);
        if (!response.ok) throw new Error('API server unreadable');
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
            processAndRenderProducts(data);
            return;
        }
        fetchLocalCatalog();
    } catch (err) {
        console.warn('Backend API unavailable, falling back to local products.json:', err);
        fetchLocalCatalog();
    }
}

function fetchLocalCatalog() {
    fetch('products.json')
        .then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
        })
        .then(products => processAndRenderProducts(products))
        .catch(err => {
            console.error('Error loading products.json:', err);
            document.querySelectorAll('.pro-container').forEach(container => {
                container.innerHTML = '<p style="padding: 20px;">Could not load products. If you opened this file directly in your browser, please run it through a local server instead.</p>';
            });
        });
}
function processAndRenderProducts(products) {
    const containers = document.querySelectorAll('.pro-container');
    // Silently return if the current page (e.g., cart.html) doesn't have a product container
    if (!containers || containers.length === 0) {
        return;
    }
    if (!Array.isArray(products) || products.length === 0) {
        containers.forEach(container => {
            container.innerHTML = '<p style="padding: 20px;">No products available.</p>';
        });
        return;
    }

    const productCardsHtml = products.map(product => {
        const id = product.product_id || product.id || 'unknown';
        const title = product.product_name || product.title || 'Untitled Product';

        const rawPrice = product.base_retail_price ?? product.price ?? 0;
        const price = isNaN(Number(rawPrice)) ? '0.00' : Number(rawPrice).toFixed(2);

        const image = product.default_image || product.image_url || product.image || 'img/p1.jpg';
        const detailUrl = `sproduct.html?id=${encodeURIComponent(id)}`;

        return `
            <div class="pro" data-id="${id}">
                <img src="${image}" alt="${title}" onclick="window.location.href='${detailUrl}'">
                <div class="des" onclick="window.location.href='${detailUrl}'">
                    <span>${product.category || 'CeeKay'}</span>
                    <h5>${title}</h5>
                    <h4>$${price}</h4>
                </div>
                <button class="add-to-cart-btn" data-id="${id}" aria-label="Add to Cart">
                    <i class="fas fa-shopping-bag"></i>
                </button>
            </div>
        `;
    }).join('');

    containers.forEach(container => {
        container.innerHTML = productCardsHtml;
    });

    attachCartEventListeners(products);
    loadSingleProductPage(products);
}

function attachCartEventListeners(products) {
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();

            const productId = this.getAttribute('data-id');
            const product = products.find(p => (p.product_id || p.id) === productId);

            if (product) {
                const title = product.product_name || product.title;
                const defaultVariant = (product.variants && product.variants.length > 0) ? product.variants[0] : null;
                const price = defaultVariant ? defaultVariant.retail_price : (product.base_retail_price || product.price || 0);
                const image = defaultVariant ? defaultVariant.image : (product.default_image || product.image_url || product.image);

                addToCart(productId, title, price, image, 1);
            }
        };
    });
}

// -------------------------------------------------------------
// 4. Single Product Page Loader (sproduct.html)
// -------------------------------------------------------------
function loadSingleProductPage(products) {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    if (!productId) return;

    const product = products.find(p => (p.product_id || p.id) === productId);
    if (!product) return;

    const mainImg = document.getElementById('MainImg');
    const titleEl = document.getElementById('product-title') || document.querySelector('.single-pro-details h4');
    const priceEl = document.getElementById('product-price') || document.querySelector('.single-pro-details h2');
    const descEl = document.getElementById('product-description');
    const sizeSelect = document.getElementById('size-select');
    const colorSelect = document.getElementById('color-select');
    const addToCartBtn = document.getElementById('add-to-cart-detail');

    if (titleEl) titleEl.innerText = product.title || product.product_name;
    if (descEl && product.description) descEl.innerText = product.description;

    const variants = product.variants || [];

    // --- Photo gallery: main image + thumbnail strip + prev/next controls ---
    const gallery = [...new Set([
        product.default_image || product.image_url || product.image,
        ...variants.map(v => v.image)
    ].filter(Boolean))];
    let galleryIndex = 0;

    const thumbStrip = document.getElementById('thumb-strip');
    const imgPrev = document.getElementById('img-prev');
    const imgNext = document.getElementById('img-next');
    const hasGallery = gallery.length > 1;

    function showImage(i) {
        if (!gallery.length) return;
        galleryIndex = (i + gallery.length) % gallery.length;
        if (mainImg) mainImg.src = gallery[galleryIndex];
        if (thumbStrip) {
            Array.from(thumbStrip.children).forEach((el, idx) =>
                el.classList.toggle('active', idx === galleryIndex));
        }
    }
    function showImageByUrl(url) {
        const idx = gallery.indexOf(url);
        if (idx > -1) showImage(idx);
        else if (mainImg && url) mainImg.src = url;
    }

    if (thumbStrip) {
        thumbStrip.innerHTML = gallery.map((src, i) =>
            `<img src="${src}" class="small-img" alt="View ${i + 1}" data-i="${i}">`
        ).join('');
        thumbStrip.querySelectorAll('.small-img').forEach(t =>
            t.addEventListener('click', () => showImage(Number(t.dataset.i))));
        thumbStrip.style.display = hasGallery ? '' : 'none';
    }
    if (imgPrev) { imgPrev.style.display = hasGallery ? '' : 'none'; imgPrev.onclick = () => showImage(galleryIndex - 1); }
    if (imgNext) { imgNext.style.display = hasGallery ? '' : 'none'; imgNext.onclick = () => showImage(galleryIndex + 1); }

    showImage(0);

    const uniqueColors = [...new Set(variants.map(v => v.color))].filter(Boolean);
    if (colorSelect && uniqueColors.length > 0) {
        colorSelect.innerHTML = uniqueColors.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    let selectedVariant = null;

    function updateSizeOptions() {
        if (!colorSelect || !sizeSelect) return;
        const selectedColor = colorSelect.value;
        const colorVariants = variants.filter(v => v.color === selectedColor);
        const availableSizes = [...new Set(colorVariants.map(v => v.size))].filter(Boolean);

        sizeSelect.innerHTML = availableSizes.map(s => `<option value="${s}">${s}</option>`).join('');
        updateVariantView();
    }

    function updateVariantView() {
        const selectedColor = colorSelect ? colorSelect.value : "Default";
        const selectedSize = sizeSelect ? sizeSelect.value : "Default";

        const matchedVariant = variants.find(v => v.color === selectedColor && v.size === selectedSize)
            || variants.find(v => v.color === selectedColor)
            || variants[0];

        selectedVariant = matchedVariant || null;

        if (matchedVariant) {
            if (matchedVariant.image) showImageByUrl(matchedVariant.image);
            if (priceEl && matchedVariant.retail_price) {
                priceEl.innerText = `$${parseFloat(matchedVariant.retail_price).toFixed(2)}`;
            }
        }
    }

    if (colorSelect) colorSelect.addEventListener('change', updateSizeOptions);
    if (sizeSelect) sizeSelect.addEventListener('change', updateVariantView);

    if (variants.length > 0) {
        updateSizeOptions();
    } else if (priceEl && (product.base_retail_price || product.price)) {
        priceEl.innerText = `$${parseFloat(product.base_retail_price || product.price).toFixed(2)}`;
    }

    if (addToCartBtn) {
        addToCartBtn.onclick = function (e) {
            e.preventDefault();
            const qtyInput = document.getElementById('product-quantity');
            let qty = qtyInput ? parseInt(qtyInput.value) : 1;
            if (!Number.isFinite(qty) || qty < 1) qty = 1;

            const price = selectedVariant?.retail_price ?? (product.base_retail_price || product.price || 0);
            const image = selectedVariant?.image || (mainImg ? mainImg.src : (product.default_image || product.image_url || product.image));

            addToCart(productId, product.title || product.product_name, price, image, qty);
        };
    }
}

// -------------------------------------------------------------
// 5. Cart Management & Server Synchronization
// -------------------------------------------------------------
window.syncCartWithServer = async function () {
    if (window.currentUser) {
        try {
            const data = await apiFetch('/api/cart');
            updateCartBadge(data.items);
            if (typeof renderCartTable === 'function') renderCartTable(data.items, data.coupon);
        } catch (err) {
            console.error('Failed to sync server cart:', err);
        }
    } else {
        const localCart = JSON.parse(localStorage.getItem('ceekay_cart') || '[]');
        updateCartBadge(localCart);
        if (typeof renderCartTable === 'function') renderCartTable(localCart, null);
    }
};

document.getElementById('coupon-apply-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('coupon-input');
    const msg = document.getElementById('coupon-message');
    const code = input.value.trim();
    if (!code) return;

    if (!window.currentUser) {
        msg.style.color = 'var(--admin-danger, #b6412c)';
        msg.innerText = 'Please log in to apply a coupon.';
        return;
    }

    try {
        await apiFetch('/api/cart/apply-coupon', { method: 'POST', body: JSON.stringify({ code }) });
        msg.style.color = 'green';
        msg.innerText = `Coupon "${code.toUpperCase()}" applied.`;
        window.syncCartWithServer();
    } catch (err) {
        msg.style.color = 'red';
        msg.innerText = err.message;
    }
});

async function addToCart(productId, productName, price, imageUrl, quantity = 1) {
    if (window.currentUser) {
        try {
            await apiFetch('/api/cart/items', {
                method: 'POST',
                body: JSON.stringify({ productId: String(productId), productName, price: Number(price), imageUrl, quantity: Number(quantity) })
            });
            showToast(productName, imageUrl);
            window.syncCartWithServer();
        } catch (err) {
            alert(err.message);
        }
    } else {
        let localCart = JSON.parse(localStorage.getItem('ceekay_cart') || '[]');
        const existingIndex = localCart.findIndex(item => item.id === productId);

        if (existingIndex > -1) {
            localCart[existingIndex].quantity += Number(quantity);
        } else {
            localCart.push({ id: productId, name: productName, price: Number(price), image: imageUrl, quantity: Number(quantity) });
        }

        localStorage.setItem('ceekay_cart', JSON.stringify(localCart));
        showToast(productName, imageUrl);
        window.syncCartWithServer();
    }
}

function updateCartBadge(items) {
    const badge = document.getElementById('cart-count');
    if (!badge) return;
    const totalQty = (items || []).reduce((sum, item) => sum + Number(item.quantity || 1), 0);
    badge.innerText = totalQty;
    badge.style.display = totalQty > 0 ? 'inline-block' : 'none';
}

function renderCartTable(items, coupon) {
    const tableBody = document.querySelector('#cart tbody');
    const subtotalEl = document.getElementById('cart-subtotal');
    const totalEl = document.getElementById('cart-total');

    if (!tableBody) return;
    tableBody.innerHTML = '';
    let subtotal = 0;

    if (!items || items.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Your cart is empty.</td></tr>';
        if (subtotalEl) subtotalEl.innerText = '$0.00';
        if (totalEl) totalEl.innerText = '$0.00';
        return;
    }

    items.forEach((item, index) => {
        const id = item.product_id || item.id;
        const productName = item.product_name || item.productName || item.title || item.name || 'Product';
        const itemPrice = parseFloat(item.price || item.base_retail_price || 0);
        const itemQty = parseInt(item.quantity || item.qty || 1, 10);
        const image = item.image_url || item.image || 'img/p1.jpg';
        
        const itemSubtotal = itemPrice * itemQty;
        subtotal += itemSubtotal;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><a href="#" onclick="removeItem('${id}', ${index}); return false;"><i class="far fa-times-circle"></i></a></td>
            <td><img src="${image}" width="70px" alt="${productName}"></td>
            <td>${productName}</td>
            <td>$${itemPrice.toFixed(2)}</td>
            <td><input type="number" value="${itemQty}" min="1" onchange="updateItemQuantity('${id}', ${index}, this.value)"></td>
            <td>$${itemSubtotal.toFixed(2)}</td>
        `;
        tableBody.appendChild(row);
    });

    let discount = 0;
    if (coupon) {
        discount = coupon.discount_percent ? subtotal * (Number(coupon.discount_percent) / 100) : Number(coupon.discount_amount || 0);
        discount = Math.min(discount, subtotal);
    }
    const total = subtotal - discount;

    if (subtotalEl) subtotalEl.innerText = `$${subtotal.toFixed(2)}`;
    if (totalEl) totalEl.innerText = discount > 0 ? `$${total.toFixed(2)} (−$${discount.toFixed(2)} applied)` : `$${total.toFixed(2)}`;
}

async function removeItem(productId, index) {
    if (window.currentUser) {
        await apiFetch(`/api/cart/items/${productId}`, { method: 'DELETE' });
    } else {
        let localCart = JSON.parse(localStorage.getItem('ceekay_cart') || '[]');
        localCart.splice(index, 1);
        localStorage.setItem('ceekay_cart', JSON.stringify(localCart));
    }
    window.syncCartWithServer();
}

async function updateItemQuantity(productId, index, newQty) {
    const quantity = parseInt(newQty);
    if (quantity < 1) return;

    if (window.currentUser) {
        await apiFetch(`/api/cart/items/${productId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });
    } else {
        let localCart = JSON.parse(localStorage.getItem('ceekay_cart') || '[]');
        if (localCart[index]) localCart[index].quantity = quantity;
        localStorage.setItem('ceekay_cart', JSON.stringify(localCart));
    }
    window.syncCartWithServer();
}

function showToast(title, image) {
    let toast = document.getElementById('cart-toast');
    if (!toast) return;

    const toastImg = document.getElementById('toast-img');
    const toastDesc = document.getElementById('toast-desc');

    if (toastImg) toastImg.src = image || 'img/p1.jpg';
    if (toastDesc) toastDesc.innerText = title || "Product";

    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
}

// -------------------------------------------------------------
// 6. Global DOM Initialization & Event Listeners
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initHeroSlideshow();
    loadProducts();
    window.syncCartWithServer();

    if (new URLSearchParams(location.search).get('checkout') === 'cancelled') {
        alert('Payment cancelled — your cart is still here whenever you\'re ready.');
    }

    // Checkout Button — goes straight to Stripe's hosted checkout.
    const checkoutBtn = document.getElementById('checkout-btn');
    checkoutBtn?.addEventListener('click', async () => {
        if (!window.currentUser) {
            alert('Please log in to proceed with checkout.');
            window.openAuthModal('login');
            return;
        }

        const original = checkoutBtn.innerText;
        checkoutBtn.disabled = true;
        checkoutBtn.innerText = 'Redirecting…';
        try {
            const res = await apiFetch('/api/orders/checkout', {
                method: 'POST',
                body: JSON.stringify({ paymentMethod: 'card' })
            });
            if (res.redirectUrl) {
                window.location.href = res.redirectUrl;
                return;
            }
            alert(res.error || 'Could not start checkout.');
        } catch (err) {
            alert(err.message);
        } finally {
            checkoutBtn.disabled = false;
            checkoutBtn.innerText = original;
        }
    });

    // Newsletter Button Modal Trigger
    document.querySelector('.newsletter button, #newsletter-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        const newsletterInput = document.querySelector('.newsletter input');
        const regEmailInput = document.getElementById('reg-email');

        if (newsletterInput && regEmailInput) {
            regEmailInput.value = newsletterInput.value;
        }

        window.openAuthModal('register');
    });

    // NOTE: the auth modal (open/close, view toggle) and the register/login
    // form submissions are all handled in auth.js via apiFetch(). They used to
    // be duplicated here with raw fetch('/api/...') calls, which broke when the
    // page is served from a static dev server (Live Server) instead of the API.
});