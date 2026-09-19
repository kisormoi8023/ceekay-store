// Global User State Tracker
window.currentUser = null;

// Global Auth Modal Helper Functions
// Some pages wrap each form in a *-view <div>; older pages only have the bare
// <form> elements. Toggle whichever exists.
window.setAuthView = function (view) {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    const panels = {
        register: document.getElementById('register-view') || document.getElementById('signup-form'),
        login: document.getElementById('login-view') || document.getElementById('login-form'),
        forgot: document.getElementById('forgot-view')
    };
    Object.keys(panels).forEach((name) => {
        if (panels[name]) panels[name].style.display = name === view ? 'block' : 'none';
    });
};

window.openAuthModal = function (view = 'login') {
    window.setAuthView(view === 'register' ? 'register' : (view === 'forgot' ? 'forgot' : 'login'));
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

// "Joan Limo" -> "Joan L." — keep the greeting personal without printing a
// customer's full legal name across the storefront header.
function formatDisplayName(fullName) {
    if (!fullName) return 'Account';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${first} ${lastInitial}.`;
}

// Dynamically update Header Navigation & Footer links based on login status
function updateAuthUI(user) {
    const displayName = document.getElementById('user-display-name');
    const statusDot = document.getElementById('user-logged-in-dot');
    const footerBtn = document.getElementById('footer-login-btn');

    if (user) {
        if (displayName) displayName.innerText = formatDisplayName(user.name);
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

// Wrap every password field on the page with a show/hide eye-toggle button.
// Works regardless of surrounding markup (bare <form> or the pill .input-box
// layout) since it only touches the input itself, not its container.
function initPasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
        if (input.parentElement?.classList.contains('pw-wrap')) return; // already wrapped

        const wrap = document.createElement('div');
        wrap.className = 'pw-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pw-toggle-btn';
        btn.setAttribute('aria-label', 'Show password');
        btn.innerHTML = '<i class="fas fa-eye"></i>';
        btn.addEventListener('click', () => {
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            btn.innerHTML = showing ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
            btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        });
        wrap.appendChild(btn);
    });
}

// Main Initialization & DOM Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    initPasswordToggles();

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

    // Forgot-password view toggles
    document.getElementById('show-forgot-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.openAuthModal('forgot');
    });
    document.getElementById('show-login-from-forgot')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.openAuthModal('login');
    });

    // Forgot-password request
    const forgotForm = document.getElementById('forgot-form');
    forgotForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email')?.value.trim() || '';
        const msgEl = document.getElementById('forgot-msg');
        if (!email) return;
        if (msgEl) { msgEl.style.color = ''; msgEl.textContent = 'Sending…'; }

        try {
            const data = await apiFetch('/api/auth/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ email })
            });
            if (msgEl) {
                msgEl.style.color = '#cdeecb';
                msgEl.textContent = data.message || "If an account exists for that email, we've sent a reset link.";
                // Dev builds return the link directly (no email service configured).
                if (data.resetUrl) {
                    const a = document.createElement('a');
                    a.href = data.resetUrl;
                    a.textContent = 'Open reset link';
                    msgEl.appendChild(document.createElement('br'));
                    msgEl.appendChild(a);
                }
            }
        } catch (err) {
            if (msgEl) { msgEl.style.color = '#ffb4a3'; msgEl.textContent = err.message || 'Request failed.'; }
        }
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
        const newsletterOptIn = document.getElementById('reg-newsletter')?.checked || false;

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
                    newsletterOptIn,
                    address: { street, city, state, postcode }
                })
            });

            window.currentUser = data.user;
            alert('Account created successfully!');
            await mergeGuestCartToServer();
            if (typeof window.closeAuthModal === 'function') window.closeAuthModal();
            window.location.reload();
        } catch (error) {
            if (error.code === 'EMAIL_EXISTS') {
                const goLogin = confirm('An account with this email already exists. Log in instead?');
                if (goLogin) {
                    window.openAuthModal('login');
                    const loginEmailInput = document.getElementById('login-email');
                    if (loginEmailInput) loginEmailInput.value = email;
                }
                return;
            }
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