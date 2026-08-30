// Handle Registration Form Submission
const signupForm = document.getElementById('signup-form') || document.getElementById('register-form');
signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('reg-name')?.value.trim() || '';
    const email = document.getElementById('reg-email')?.value.trim() || '';
    const password = document.getElementById('reg-password')?.value || '';

    const street = document.getElementById('reg-street')?.value.trim() || '';
    const city = document.getElementById('reg-city')?.value.trim() || '';
    const state = document.getElementById('reg-state')?.value.trim() || '';
    const postcode = document.getElementById('reg-postcode')?.value.trim() || '';

    if (!name || !email || !password) {
        alert('Please fill in your name, email, and password.');
        return;
    }

    try {
        // Pass plain object (config.js will stringify it automatically)
        const data = await apiFetch('/api/auth/register', {
            method: 'POST',
            body: {
                name,
                email,
                password,
                street,
                city,
                state,
                postcode,
                address: { street, city, state, postcode }
            }
        });

        window.currentUser = data.user;
        alert('Account created successfully!');
        if (typeof mergeGuestCartToServer === 'function') await mergeGuestCartToServer();
        if (typeof window.closeAuthModal === 'function') window.closeAuthModal();
        window.location.reload();
    } catch (error) {
        alert(error.message || 'Registration failed');
    }
});