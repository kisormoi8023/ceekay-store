// Render products on shop grid (index.html / shop.html)
function renderProducts(products) {
    const productContainer = document.querySelector('.pro-container');
    if (!productContainer) return;

    productContainer.innerHTML = products.map(product => {
        const detailUrl = `sproduct.html?id=${encodeURIComponent(product.id)}`;
        const displayPrice = product.base_retail_price ? product.base_retail_price.toFixed(2) : "0.00";

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