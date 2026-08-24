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