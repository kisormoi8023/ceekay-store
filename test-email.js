// Quick check that your SMTP settings in .env actually work.
//
//   node test-email.js you@example.com
//
// Sends one test message to the address you pass (defaults to SMTP_USER).

require('dotenv').config();
const nodemailer = require('nodemailer');

const to = process.argv[2] || process.env.SMTP_USER || process.env.MAIL_FROM;
if (!to) {
    console.error('Pass a recipient:  node test-email.js you@example.com');
    process.exit(1);
}

const configured = process.env.SMTP_URL || (process.env.SMTP_HOST && process.env.SMTP_USER);
if (!configured) {
    console.error('No SMTP settings found in .env (need SMTP_URL, or SMTP_HOST + SMTP_USER + SMTP_PASS).');
    process.exit(1);
}

const transport = process.env.SMTP_URL
    ? nodemailer.createTransport(process.env.SMTP_URL)
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

(async () => {
    try {
        await transport.verify();
        console.log('✓ SMTP connection + auth OK');
        const info = await transport.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER,
            to,
            subject: 'Ceekay SMTP test',
            text: 'If you are reading this, password-reset emails will work.'
        });
        console.log(`✓ Test email sent to ${to}  (${info.messageId})`);
    } catch (err) {
        console.error('✗ Failed:', err.message);
        process.exit(1);
    }
})();