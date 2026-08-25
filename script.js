// Navigation Bar Controls
const bar = document.getElementById('bar');
const close = document.getElementById('close');
const nav = document.getElementById('navbar');

if (bar) {
    bar.addEventListener('click', () => {
        nav.classList.add('active');
    });
}

if (close) {
    close.addEventListener('click', () => {
        nav.classList.remove('active');
    });
}

// Hero Slideshow Controls
document.addEventListener("DOMContentLoaded", function () {
    const hero = document.getElementById("hero");
    const dots = document.querySelectorAll(".hero-dot");
    const prevBtn = document.getElementById("heroPrev");
    const nextBtn = document.getElementById("heroNext");

    let currentSlide = 1;
    const totalSlides = 2;
    let slideInterval;

    function setSlide(index) {
        currentSlide = index;
        if (currentSlide > totalSlides) currentSlide = 1;
        if (currentSlide < 1) currentSlide = totalSlides;

        if (hero) hero.className = `bg-${currentSlide}`;

        dots.forEach((dot, i) => {
            dot.classList.toggle("active", i + 1 === currentSlide);
        });
    }

    function startSlideshow() {
        if (hero) {
            slideInterval = setInterval(() => {
                setSlide(currentSlide + 1);
            }, 50000);
        }
    }

    function resetTimer() {
        clearInterval(slideInterval);
        startSlideshow();
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            setSlide(currentSlide - 1);
            resetTimer();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            setSlide(currentSlide + 1);
            resetTimer();
        });
    }

    dots.forEach((dot) => {
        dot.addEventListener("click", (e) => {
            const index = parseInt(e.target.getAttribute("data-index"));
            setSlide(index);
            resetTimer();
        });
    });

    startSlideshow();
});

// Render products on shop grid (index.html / shop.html)
function renderProducts(products) {
    const productContainer = document.querySelector('.pro-container');
    if (!productContainer) return;

    productContainer.innerHTML = products.map(product => `
        <div class="pro">
            <img src="${product.image}" alt="${product.name}" onclick="window.location.href='sproduct.html?id=${product.id}'">
            <div class="des" onclick="window.location.href='sproduct.html?id=${product.id}'">
                <span>${product.brand || 'Ceekay'}</span>
                <h5>${product.name}</h5>
                <h4>$${product.price}</h4>
            </div>
            <button class="add-to-cart-btn" onclick="addToCart('${product.id}')" aria-label="Add to Cart">
                <i class="fas fa-shopping-bag"></i>
            </button>
        </div>
    `).join('');
}
    productContainer.innerHTML = products.map(product => {
        const detailUrl = `sproduct.html?id=${encodeURIComponent(product.id)}`;
        const displayPrice = product.base_retail_price ? parseFloat(product.base_retail_price).toFixed(2) : "0.00";

        return `
            <div class="pro" data-id="${product.id}">
                <img src="${product.default_image}" alt="${product.title}" onclick="window.location.href='${detailUrl}'">
                <div class="des" onclick="window.location.href='${detailUrl}'">
                    <span>CeeKay</span>
                    <h5>${product.title}</h5>
                    <h4>$${displayPrice}</h4>
                </div>
                <a href="#" class="add-to-cart-btn" data-id="${product.id}">
                    <i class="fal fa-shopping-cart cart" data-id="${product.id}"></i>
                </a>
            </div>
        `;
    }).join('');

    attachCartEventListeners(products);
}

// Single Product Page (sproduct.html) Dynamic Loader
function loadSingleProductPage(products) {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) return;

    const product = products.find(p => p.id === productId);
    if (!product) return;

    // UI Elements
    const mainImg = document.getElementById('MainImg');
    const titleEl = document.getElementById('product-title') || document.querySelector('.single-pro-details h4');
    const priceEl = document.getElementById('product-price') || document.querySelector('.single-pro-details h2');
    const descEl = document.getElementById('product-description');
    const sizeSelect = document.getElementById('size-select');
    const colorSelect = document.getElementById('color-select');
    const addToCartBtn = document.getElementById('add-to-cart-detail');

    // Set Text Content
    if (titleEl) titleEl.innerText = product.title;
    if (descEl && product.description) descEl.innerText = product.description;
    if (mainImg && product.default_image) mainImg.src = product.default_image;

    const variants = product.variants || [];

    // 1. Populate Color Dropdown
    const uniqueColors = [...new Set(variants.map(v => v.color))].filter(Boolean);
    if (colorSelect && uniqueColors.length > 0) {
        colorSelect.innerHTML = uniqueColors.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    // 2. Filter available sizes when Color changes
    function updateSizeOptions() {
        if (!colorSelect || !sizeSelect) return;
        const selectedColor = colorSelect.value;

        const colorVariants = variants.filter(v => v.color === selectedColor);
        const availableSizes = [...new Set(colorVariants.map(v => v.size))].filter(Boolean);

        sizeSelect.innerHTML = availableSizes.map(s => `<option value="${s}">${s}</option>`).join('');
        updateVariantView();
    }

    // 3. Update Image & Price for matched Variant
    function updateVariantView() {
        const selectedColor = colorSelect ? colorSelect.value : "Default";
        const selectedSize = sizeSelect ? sizeSelect.value : "Default";

        const matchedVariant = variants.find(v => v.color === selectedColor && v.size === selectedSize) 
            || variants.find(v => v.color === selectedColor) 
            || variants[0];

        if (matchedVariant) {
            if (mainImg && matchedVariant.image) mainImg.src = matchedVariant.image;
            if (priceEl && matchedVariant.retail_price) {
                priceEl.innerText = `$${parseFloat(matchedVariant.retail_price).toFixed(2)}`;
            }
        }
    }

    if (colorSelect) colorSelect.addEventListener('change', updateSizeOptions);
    if (sizeSelect) sizeSelect.addEventListener('change', updateVariantView);

    // Initial View Sync
    if (variants.length > 0) {
        updateSizeOptions();
    } else if (priceEl && product.base_retail_price) {
        priceEl.innerText = `$${parseFloat(product.base_retail_price).toFixed(2)}`;
    }

    // 4. Detail Page Add to Cart Listener
    if (addToCartBtn) {
        addToCartBtn.onclick = function(e) {
            e.preventDefault();
            const selectedColor = colorSelect ? colorSelect.value : "Default";
            const selectedSize = sizeSelect ? sizeSelect.value : "Default";
            const qtyInput = document.getElementById('product-quantity');
            const qty = qtyInput ? parseInt(qtyInput.value) : 1;

            const exactVariant = variants.find(v => v.color === selectedColor && v.size === selectedSize) 
                || variants.find(v => v.color === selectedColor) 
                || variants[0];

            addToCartWithVariant(product, exactVariant, qty);
        };
    }
}

// Show Visual Toast Notification (Auto-creates element if missing)
function showCartToast(product, variant) {
    let toast = document.getElementById('cart-toast');

    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cart-toast';
        toast.className = 'cart-toast';
        toast.innerHTML = `
            <div class="toast-content">
                <img id="toast-img" src="" alt="Product" class="toast-thumb">
                <div class="toast-message">
                    <div class="toast-header-row">
                        <i class="fas fa-check-circle toast-icon"></i>
                        <strong id="toast-title">Added to Cart!</strong>
                    </div>
                    <p id="toast-desc">Product title</p>
                    <span id="toast-variant">Variant info</span>
                </div>
            </div>
        `;
        document.body.appendChild(toast);
    }

    const toastImg = document.getElementById('toast-img');
    const toastDesc = document.getElementById('toast-desc');
    const toastVariant = document.getElementById('toast-variant');

    const selectedColor = (variant && variant.color) ? variant.color : "Default";
    const selectedSize = (variant && variant.size) ? variant.size : "Default";
    const itemImage = (variant && variant.image) ? variant.image : (product.default_image || 'img/p1.avif');

    if (toastImg) toastImg.src = itemImage;
    if (toastDesc) toastDesc.innerText = product.title || product.name || "Product";
    if (toastVariant) toastVariant.innerText = `Color: ${selectedColor} | Size: ${selectedSize}`;

    toast.classList.add('show');
    updateCartCountBadge();

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}
// Safely update navbar cart count badge (Hides when 0)
function updateCartCountBadge() {
    const badge = document.getElementById('cart-count');
    if (!badge) return;

    let cart = JSON.parse(localStorage.getItem('ceekay_cart')) || [];
    const totalQty = cart.reduce((sum, item) => sum + (parseInt(item.quantity) || 1), 0);

    if (totalQty > 0) {
        badge.innerText = totalQty;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}
// Global Add to Cart Logic (Ensures numbers are stored as primitive numbers)
function addToCartWithVariant(product, variant, quantity = 1) {
    let cart = JSON.parse(localStorage.getItem('ceekay_cart')) || [];

    const selectedColor = (variant && variant.color) ? variant.color : "Default";
    const selectedSize = (variant && variant.size) ? variant.size : "Default";
    const itemPrice = (variant && variant.retail_price) ? parseFloat(variant.retail_price) : parseFloat(product.base_retail_price || product.price || 0);
    const itemImage = (variant && variant.image) ? variant.image : (product.default_image || product.image);
    const itemSku = (variant && variant.sku) ? variant.sku : product.id;

    const existingIndex = cart.findIndex(item => 
        item.id === product.id && item.color === selectedColor && item.size === selectedSize
    );

    if (existingIndex > -1) {
        cart[existingIndex].quantity += parseInt(quantity);
    } else {
        cart.push({
            id: product.id,
            sku: itemSku,
            title: product.title || product.name,
            price: itemPrice,
            image: itemImage,
            color: selectedColor,
            size: selectedSize,
            quantity: parseInt(quantity)
        });
    }

    localStorage.setItem('ceekay_cart', JSON.stringify(cart));
    showCartToast(product, variant);
}

// Quick Add Handler for Grid Cards (Circular Green Icon)
function attachCartEventListeners(products) {
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();

            const productId = this.getAttribute('data-id');
            const product = products.find(p => p.id === productId);

            if (product) {
                const defaultVariant = (product.variants && product.variants.length > 0) ? product.variants[0] : null;
                addToCartWithVariant(product, defaultVariant, 1);
            }
        };
    });
}

// Render Cart Table & Calculate Totals accurately on cart.html
function renderCartPage() {
    const cartTableContainer = document.querySelector('#cart tbody');
    const subtotalEl = document.getElementById('cart-subtotal');
    const totalEl = document.getElementById('cart-total');

    if (!cartTableContainer) return;

    let cart = JSON.parse(localStorage.getItem('ceekay_cart')) || [];
    cartTableContainer.innerHTML = '';
    let subtotal = 0;

    if (cart.length === 0) {
        cartTableContainer.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Your cart is empty.</td></tr>';
        if (subtotalEl) subtotalEl.innerText = '$0.00';
        if (totalEl) totalEl.innerText = '$0.00';
        return;
    }

    cart.forEach((item, index) => {
        const price = parseFloat(item.price) || 0;
        const qty = parseInt(item.quantity) || 1;
        const itemTotal = price * qty;
        
        subtotal += itemTotal;

        cartTableContainer.innerHTML += `
            <tr>
                <td><a href="#" onclick="removeCartItem(${index}); return false;"><i class="far fa-times-circle"></i></a></td>
                <td><img src="${item.image}" width="70px" alt="${item.title}"></td>
                <td>${item.title} <br><small>(${item.color} / ${item.size})</small></td>
                <td>$${price.toFixed(2)}</td>
                <td><input type="number" value="${qty}" min="1" onchange="updateCartQuantity(${index}, this.value)"></td>
                <td>$${itemTotal.toFixed(2)}</td>
            </tr>
        `;
    });

    const formattedTotal = `$${subtotal.toFixed(2)}`;
    if (subtotalEl) subtotalEl.innerText = formattedTotal;
    if (totalEl) totalEl.innerText = formattedTotal;
}

// Remove item from cart
function removeCartItem(index) {
    let cart = JSON.parse(localStorage.getItem('ceekay_cart')) || [];
    cart.splice(index, 1);
    localStorage.setItem('ceekay_cart', JSON.stringify(cart));
    renderCartPage();
    updateCartCountBadge();
}

// Update quantity from input
function updateCartQuantity(index, newQty) {
    let cart = JSON.parse(localStorage.getItem('ceekay_cart')) || [];
    cart[index].quantity = parseInt(newQty) || 1;
    localStorage.setItem('ceekay_cart', JSON.stringify(cart));
    renderCartPage();
    updateCartCountBadge();
}

// Global Handler for sproduct.html Add To Cart Button
function handleAddToCart() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    
    fetch('products.json')
        .then(res => res.json())
        .then(products => {
            const product = products.find(p => p.id === productId) || products[0];
            
            const colorSelect = document.getElementById('color-select');
            const sizeSelect = document.getElementById('size-select');
            const qtyInput = document.getElementById('product-quantity');
            
            const selectedColor = colorSelect ? colorSelect.value : "Default";
            const selectedSize = sizeSelect ? sizeSelect.value : "Default";
            const qty = qtyInput ? parseInt(qtyInput.value) : 1;

            const variants = product.variants || [];
            const exactVariant = variants.find(v => v.color === selectedColor && v.size === selectedSize) 
                || variants.find(v => v.color === selectedColor) 
                || variants[0];

            addToCartWithVariant(product, exactVariant, qty);
        })
        .catch(err => console.error("Error adding item to cart:", err));
}

// Master Initialization Entry Point
document.addEventListener('DOMContentLoaded', () => {
    fetch('products.json')
        .then(response => response.json())
        .then(products => {
            renderProducts(products);
            loadSingleProductPage(products);
            renderCartPage();
            updateCartCountBadge();
        })
        .catch(err => console.error('Error loading product catalog:', err));
});