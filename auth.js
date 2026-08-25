// Initialize Firebase Configuration (Replace with your Firebase Console credentials)
const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "ceekay-store.firebaseapp.com",
    projectId: "ceekay-store",
    storageBucket: "ceekay-store.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Handle Account Registration & Address Logging
document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const fullName = document.getElementById('reg-name').value;
    
    const address = {
        street: document.getElementById('reg-street').value,
        city: document.getElementById('reg-city').value,
        state: document.getElementById('reg-state').value,
        postcode: document.getElementById('reg-postcode').value
    };

    try {
        // 1. Create User Account
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // 2. Save Customer Profile & Address in Firestore
        await db.collection('users').doc(user.uid).set({
            fullName: fullName,
            email: email,
            shippingAddress: address,
            createdAt: new Date().toISOString()
        });

        alert("Account created successfully!");
        document.getElementById('auth-modal').style.display = 'none';
    } catch (error) {
        alert(error.message);
    }
});

// Sync Auth State with Cart Checkout Address Auto-fill
auth.onAuthStateChanged(async (user) => {
    if (user) {
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            // Store customer info locally for instant checkout auto-fill
            localStorage.setItem('ceekay_customer', JSON.stringify(userData));
        }
    } else {
        localStorage.removeItem('ceekay_customer');
    }
});