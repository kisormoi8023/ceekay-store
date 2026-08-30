// Global User State Tracker
window.currentUser = null;

// Global Auth Modal Helper Functions
window.openAuthModal = function(view = 'login') {
    const modal = document.getElementById('auth-modal');
    const signupForm = document.getElementById('signup-form') || document.getElementById('register-view');
    const loginForm = document.getElementById('login-form') || document.getElementById('login-view');
    if (!modal) return;

    modal.style.display = 'flex';
    if (view === 'login') {
        if (signupForm) signupForm.style.display = 'none';
        if (loginForm) loginForm.style.display = 'flex';
    } else {
        if (signupForm) signupForm.style.display = 'flex';
        if (loginForm) loginForm.style.display = 'none';
    }
};

window.closeAuthModal = function() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
};

// Check active user session state on page load
async function checkAuthStatus() {
    try {
        const data = await apiFetch('/api/me');
        window.currentUser = data.user;
        updateAuthUI(data.user);

        if (typeof window.syncCartWithServer === 'function') {
            window.syncCartWithServer();
        }
    } catch (err) {
        window.currentUser = null;
        updateAuthUI(null);
    }
}

// Dynamically update Header Navigation & Footer links based on login status
function updateAuthUI(user) {
    const displayName = document.getElementById('user-display-name');
    const statusDot = document.getElementById('user-logged-in-dot');
    const footerBtn = document.getElementById('footer-login-btn');

    if (user) {
        if (displayName) displayName.innerText = user.name || 'Account';
        if (statusDot) statusDot.style.display = 'inline-block';
        if (footerBtn) footerBtn.innerText = 'Log Out';
    } else {
        if (displayName) displayName.innerText = 'Log In';
        if (statusDot) statusDot.style.display = 'none';
        if (footerBtn) footerBtn.innerText = 'Log In / Sign Up';
    }
}

// Handle Customer Logout
async function logoutUser() {
    try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.currentUser = null;
        localStorage.removeItem('ceekay_cart');
        localStorage.removeItem('cart');
        alert('Logged out successfully.');
        window.location.reload();
    } catch (err) {
        alert('Logout failed');
    }
}

// Helper: Sync offline LocalStorage cart items to MySQL database upon login
async function mergeGuestCartToServer() {
    const rawLocalCart = localStorage.getItem('ceekay_cart') || localStorage.getItem('cart') || '[]';
    const localCart = JSON.parse(rawLocalCart);
    if (!Array.isArray(localCart) || localCart.length === 0) return;

    try {
        const formattedItems = localCart.map(item => ({
            productId: String(item.id || item.productId || item.product_id),
            productName: item.name || item.title || item.productName || item.product_name,
            price: Number(item.price),
            imageUrl: item.image || item.imageUrl || item.image_url,
            quantity: Number(item.quantity || item.qty || 1)
        }));

        await apiFetch('/api/cart/merge', {
            method: 'POST',
            body: JSON.stringify({ items: formattedItems })
        });

        localStorage.removeItem('ceekay_cart');
        localStorage.removeItem('cart');
    } catch (err) {
        console.error('Failed to merge guest cart:', err);
    }
}

// Main Initialization & DOM Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();

    // Toggle Modal Views
    document.getElementById('show-login-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.openAuthModal('login');
    });

    document.getElementById('show-signup-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.openAuthModal('register');
    });

    document.getElementById('show-register-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.openAuthModal('register');
    });

    // Close Button Event
    document.getElementById('close-auth-modal')?.addEventListener('click', window.closeAuthModal);

    // Header & Footer Login/Logout Triggers
    const loginTriggerBtns = ['login-modal-btn', 'footer-login-btn', 'login-header-btn'];
    loginTriggerBtns.forEach(id => {
        document.getElementById(id)?.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.currentUser) {
                logoutUser();
            } else {
                window.openAuthModal('login');
            }
        });
    });

    // Handle Registration Form Submission
    const signupForm = document.getElementById('signup-form') || document.getElementById('register-form');
    signupForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reg-email')?.value.trim() || '';
        const password = document.getElementById('reg-password')?.value || '';
        const name = document.getElementById('reg-name')?.value.trim() || '';

        const street = document.getElementById('reg-street')?.value.trim() || '';
        const city = document.getElementById('reg-city')?.value.trim() || '';
        const state = document.getElementById('reg-state')?.value.trim() || '';
        const postcode = document.getElementById('reg-postcode')?.value.trim() || '';

        if (!email || !password || !name) {
            alert('Please fill in your name, email, and password.');
            return;
        }

        try {
            // Explicitly stringify the body object so apiFetch sends valid JSON
            const data = await apiFetch('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    email,
                    password,
                    name,
                    street,
                    city,
                    state,
                    postcode,
                    address: { street, city, state, postcode }
                })
            });

            window.currentUser = data.user;
            alert('Account created successfully!');
            await mergeGuestCartToServer();
            if (typeof window.closeAuthModal === 'function') window.closeAuthModal();
            window.location.reload();
        } catch (error) {
            alert(error.message || 'Registration failed');
        }
    });

    // Handle Login Form Submission
    const loginForm = document.getElementById('login-form');
    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email')?.value.trim() || '';
        const password = document.getElementById('login-password')?.value || '';

        if (!email || !password) {
            alert('Please enter both email and password.');
            return;
        }

        try {
            // Explicitly stringify the body object so apiFetch sends valid JSON
            const data = await apiFetch('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });

            window.currentUser = data.user;
            alert('Logged in successfully!');
            await mergeGuestCartToServer();
            if (typeof window.closeAuthModal === 'function') window.closeAuthModal();
            window.location.reload();
        } catch (error) {
            alert(error.message || 'Login failed. Please check your credentials.');
        }
    });

    // Handle Proceed to Checkout Button (Guest Gatekeeper)
    const checkoutBtn = document.getElementById('proceed-to-checkout-btn');
    checkoutBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/me', { credentials: 'include' });
            if (res.ok) {
                window.location.href = '/checkout.html';
            } else {
                alert('Please log in or create an account to complete your order.');
                window.openAuthModal('login');
            }
        } catch (err) {
            console.error('Auth verification error:', err);
        }
    });
});