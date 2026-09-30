# Two-step login

After the password, the hub asks for a second proof.

| Way | How it works |
|---|---|
| **Approve on phone** (main way) | The laptop shows a 2-digit number. The phone gets a notification; the person taps it, picks the same number out of 3 and confirms with Face ID / fingerprint / phone PIN. The laptop shows a green tick and opens. Signing in on the phone itself: "This is my phone — confirm with Face ID". |
| **Authenticator app** | 6-digit code from Microsoft / Google Authenticator or Authy. Setup: QR code (laptop) or "Add to authenticator app" button + "Copy setup key" (phone). |
| **Backup codes** | 8 one-time codes shown once at setup (Profile → New codes to replace them). |

- Wrong number picked or "This wasn't me" → the sign-in is blocked and the administrators get a notification.
- Requests expire after 2 minutes. 5 wrong codes → the account's second step is locked for 15 minutes.
- "Trust this device for 30 days" skips the second step on that device (Profile → Forget them to undo).
- **Admin → People & roles → Two-step login**: tick the roles that must use it. People not set up are asked to set it up before the hub opens. Each person shows "2-step on"; **Reset 2-step** when a phone is lost or changed.
- Approve on phone needs: the hub on the phone's Home Screen (iPhone, iOS 16.4+) with alerts on, and Face ID / fingerprint / a PIN on the phone.

Security: the authenticator secret is stored encrypted (AES-GCM, key derived from SESSION_SECRET); backup codes are stored hashed; phone approvals are verified with WebAuthn (public key only on the server, user verification required).

Tables `user_2fa`, `login_challenges`, `trusted_devices` (+ `users.twofa_fail`, `users.twofa_lock`), policy in `meta` (`twofa:required`). Files: `modules/twofa.js`, `tools/qrcode.js` (MIT), hooks in `worker.js` and `index.html` marked "Two-step login feature".
