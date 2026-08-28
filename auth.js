// Base URL pointing to your Express backend API
const API_BASE_URL = 'https://api.ceekaystore.com'; // Change to your server URL or 'http://localhost:3000' during local testing

// State tracker
window.currentUser = null;

// Helper function for sending authenticated requests with cookies enabled
async function apiFetch(endpoint, options = {}) {
    options.credentials = 'include'; // Required to send httpOnly cookies across origins
    options.headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'API Request failed');
    }

    return data;
}

// Check current user session on page load
async function checkAuthStatus() {
    try {
        const data = await apiFetch('/api/me');
        window.currentUser = data.user;
        updateAuthUI(data.user);
        
        // Sync API cart to frontend
        if (typeof window.syncCartWithServer === 'function') {
            window.syncCartWithServer();
        }
    } catch (err) {
        window.currentUser = null;
        updateAuthUI(null);
    }
}

// Update Navigation / Auth UI depending on login state
function updateAuthUI(user) {
    const loginBtn = document.getElementById('login-modal-btn');
    const userDisplay = document.getElementById('user-display-name');

    if (user) {
        if (loginBtn) loginBtn.innerText = 'Logout';
        if (userDisplay) userDisplay.innerText = `Hello, ${user.name || user.email}`;
    } else {
        if (loginBtn) loginBtn.innerText = 'Sign In';
        if (userDisplay) userDisplay.innerText = '';
    }
}

// Handle Customer Registration Form Submission
document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const name = document.getElementById('reg-name').value;

    try {
        const data = await apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password, name })
        });

        window.currentUser = data.user;
        alert('Account created successfully!');
        
        // Merge guest localStorage cart to newly created account database
        await mergeGuestCartToServer();

        document.getElementById('auth-modal').style.display = 'none';
        checkAuthStatus();
    } catch (error) {
        alert(error.message);
    }
});

// Handle Customer Login Form Submission
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const data = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        window.currentUser = data.user;
        alert('Logged in successfully!');

        // Merge guest localStorage cart items to backend database
        await mergeGuestCartToServer();

        document.getElementById('auth-modal').style.display = 'none';
        checkAuthStatus();
    } catch (error) {
        alert(error.message);
    }
});

// Handle Logout
async function logoutUser() {
    try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.currentUser = null;
        localStorage.removeItem('ceekay_cart');
        alert('Logged out successfully.');
        window.location.reload();
    } catch (err) {
        alert('Logout failed');
    }
}

// Helper: Merge guest local storage items to server upon login
async function mergeGuestCartToServer() {
    const localCart = JSON.parse(localStorage.getItem('ceekay_cart') || '[]');
    if (localCart.length === 0) return;

    try {
        const formattedItems = localCart.map(item => ({
            productId: String(item.id),
            productName: item.name,
            price: Number(item.price),
            imageUrl: item.image,
            quantity: Number(item.quantity)
        }));

        await apiFetch('/api/cart/merge', {
            method: 'POST',
            body: JSON.stringify({ items: formattedItems })
        });

        // Clear local storage cart once merged into user database
        localStorage.removeItem('ceekay_cart');
    } catch (err) {
        console.error('Failed to merge guest cart:', err);
    }
}

// Run auth check when DOM is ready
document.addEventListener('DOMContentLoaded', checkAuthStatus);     