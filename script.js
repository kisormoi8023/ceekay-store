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

// DEFAULT FALLBACK INVENTORY
const defaultProducts = [
    {
        id: "p1",
        brand: "Masaba-Fahari",
        name: "Striped Slim Fit Long Sleeved Long Pants Men's Suit",
        title: "Striped Slim Fit Long Sleeved Long Pants Men's Suit",
        price: 98.99,
        image: "img/p1.avif",
        featured_image: "img/p1.avif"
    },
    {
        id: "p2",
        brand: "Masaba-Fahari",
        name: "Fashion Women's Casual High Waist Overlap Asymmetric Elegant Solid Color Wide Leg Pants",
        title: "Fashion Women's Casual High Waist Overlap Asymmetric Elegant Solid Color Wide Leg Pants",
        price: 37.99,
        image: "img/p2black.webp",
        featured_image: "img/p2black.webp"
    }
];

// LOAD PRODUCTS FROM DASHBOARD STORAGE
const products = JSON.parse(localStorage.getItem("storeProducts")) || defaultProducts;

// CARD RENDERER
function generateProductHTML(product) {
    const imgSrc = product.featured_image || product.image || 'img/p1.avif';
    const productTitle = product.title || product.name || 'Untitled Product';
    const productPrice = Number(product.price) || 0;

    return `
        <div class="pro" onclick="window.location.href='sproduct.html?id=${product.id}';">
            <img src="${imgSrc}" alt="${productTitle}">
            <div class="des">
                <span>${product.brand || 'Masaba-Fahari'}</span>
                <h5>${productTitle}</h5>
                <h4>$${productPrice.toFixed(2)}</h4>
            </div>
            <a href="cart.html"><i class="fal fa-shopping-cart cart"></i></a>
        </div>
    `;
}
document.addEventListener("DOMContentLoaded", () => {
    fetch("products.json")
        .then(response => response.json())
        .then(products => {
            window.allProducts = products;

            // Helper to generate a single product card HTML
            const createProductCard = (product, index) => {
                const imgUrl = product.default_image || (product.images && product.images[0]) || 'img/products/f1.jpg';
                const price = product.base_retail_price || product.retail_price;

                return `
                    <div class="pro" onclick="window.location.href='sproduct.html?title=${encodeURIComponent(product.title)}'">
                        <img src="${imgUrl}" alt="${product.title}">
                        <div class="des">
                            <span>CeeKay</span>
                            <h5>${product.title}</h5>
                            <div class="star">
                                <i class="fas fa-star"></i>
                                <i class="fas fa-star"></i>
                                <i class="fas fa-star"></i>
                                <i class="fas fa-star"></i>
                                <i class="fas fa-star"></i>
                            </div>
                            <h4>A$${price}</h4>
                        </div>
                        <a href="javascript:void(0);" onclick="addToCart(event, ${index})">
                            <i class="fal fa-shopping-cart cart"></i>
                        </a>
                    </div>
                `;
            };

            // Targets all .pro-container sections (Featured Products and New Arrivals)
            const containers = document.querySelectorAll(".pro-container");

            containers.forEach(container => {
                container.innerHTML = products.map((product, index) => createProductCard(product, index)).join("");
            });
        })
        .catch(error => console.error("Error displaying products:", error));
});

function addToCart(event, productIndex) {
    event.stopPropagation(); // Prevents navigating to sproduct.html

    const product = window.allProducts[productIndex];
    let cart = JSON.parse(localStorage.getItem("cart")) || [];

    const existingIndex = cart.findIndex(item => item.title === product.title);

    const price = product.base_retail_price || product.retail_price;
    const imgUrl = product.default_image || (product.images && product.images[0]) || 'img/products/f1.jpg';
    const defaultSize = (product.variants && product.variants[0] && product.variants[0].size) || (product.sizes && product.sizes[0]) || 'Default';

    if (existingIndex > -1) {
        cart[existingIndex].quantity += 1;
    } else {
        cart.push({
            title: product.title,
            price: price,
            image: imgUrl,
            quantity: 1,
            size: defaultSize
        });
    }

    localStorage.setItem("cart", JSON.stringify(cart));
    alert("Item added to cart!");
}
// Function to render products dynamically onto shop grids
function renderProducts(products) {
    const productContainer = document.querySelector('.pro-container');
    if (!productContainer) return;

    productContainer.innerHTML = products.map(product => {
        // Encode title or ID safely for URL parameters
        const detailUrl = `sproduct.html?id=${encodeURIComponent(product.id)}`;

        return `
            <div class="pro" data-id="${product.id}">
                <img src="${product.default_image}" alt="${product.title}" onclick="window.location.href='${detailUrl}'">
                <div class="des" onclick="window.location.href='${detailUrl}'">
                    <span>Ceekay</span>
                    <h5>${product.title}</h5>
                    <h4>$${product.base_retail_price.toFixed(2)}</h4>
                </div>
                <a href="#" class="add-to-cart-btn" data-id="${product.id}">
                    <i class="fal fa-shopping-cart cart"></i>
                </a>
            </div>
        `;
    }).join('');

    attachCartEventListeners(products);
}
// Handle sproduct.html dynamic details loading
function loadSingleProductPage(products) {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) return;

    // Find selected product
    const product = products.find(p => p.id === productId);
    if (!product) return;

    // Populate main visual elements
    const mainImg = document.getElementById('MainImg');
    const titleEl = document.querySelector('.single-pro-details h4');
    const priceEl = document.querySelector('.single-pro-details h2');
    const sizeSelect = document.getElementById('size-select');
    const addToCartBtn = document.getElementById('add-to-cart-detail');

    if (mainImg) mainImg.src = product.default_image;
    if (titleEl) titleEl.innerText = product.title;
    if (priceEl) priceEl.innerText = `$${product.base_retail_price.toFixed(2)}`;

    // Populate size dropdown options from variants
    if (sizeSelect && product.variants) {
        sizeSelect.innerHTML = product.variants.map(v => 
            `<option value="${v.size}" data-image="${v.image}" data-price="${v.retail_price}">${v.size}</option>`
        ).join('');

        // Switch main photo when size/variant selection changes
        sizeSelect.addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const variantImage = selectedOption.getAttribute('data-image');
            const variantPrice = selectedOption.getAttribute('data-price');
            
            if (variantImage && mainImg) mainImg.src = variantImage;
            if (variantPrice && priceEl) priceEl.innerText = `$${parseFloat(variantPrice).toFixed(2)}`;
        });
    }

    // Detail page "Add to Cart" listener
    if (addToCartBtn) {
        addToCartBtn.onclick = function(e) {
            e.preventDefault();
            const quantityInput = document.getElementById('product-quantity');
            const qty = quantityInput ? parseInt(quantityInput.value) : 1;
            const selectedSize = sizeSelect ? sizeSelect.value : "Default";

            addToCart(product, selectedSize, qty);
        };
    }
}
// Cart handling helper
function addToCart(product, selectedSize = "Default", quantity = 1) {
    let cart = JSON.parse(localStorage.getItem('ceekay_cart')) || [];

    // Find existing variant match in cart
    const existingIndex = cart.findIndex(item => item.id === product.id && item.size === selectedSize);

    if (existingIndex > -1) {
        cart[existingIndex].quantity += quantity;
    } else {
        cart.push({
            id: product.id,
            title: product.title,
            price: product.base_retail_price,
            image: product.default_image,
            size: selectedSize,
            quantity: quantity
        });
    }

    localStorage.setItem('ceekay_cart', JSON.stringify(cart));
    alert(`${product.title} has been added to your cart!`);
}

// Attach listeners for shop grid quick-add buttons
function attachCartEventListeners(products) {
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevents navigating to product detail page

            const productId = btn.getAttribute('data-id');
            const product = products.find(p => p.id === productId);

            if (product) {
                addToCart(product, "Default", 1);
            }
        });
    });
}

// Master Initialization on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    fetch('products.json')
        .then(response => response.json())
        .then(products => {
            renderProducts(products);
            loadSingleProductPage(products);
        })
        .catch(err => console.error('Error loading product catalog:', err));
});