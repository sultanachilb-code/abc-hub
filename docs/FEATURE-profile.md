# Profile

Tap your picture (top right): an animated menu with **Profile settings** and **Log out** (+ Hub administration for admins).

Profile settings: flagship cover (set by the admin) · profile picture (you change it; cropped square and resized on the device) · Name · Email · Flagship · Flagships access (read-only, set by the admin) · Change password · Appearance · Daily brief · Alerts on this device · Clear the Recent line.

Admin → **Flagship covers**: upload / replace / remove one wide picture per flagship (about 1600 × 500). It is resized before upload.

Tables `user_photos`, `site_covers`, column `users.photo_at` (created automatically; not included in the weekly backup). Routes `/api/profile`, `/api/profile/photo`, `/api/profile/cover`, `/api/admin/covers`. Files: `modules/profile.js`, hooks in `worker.js` and `index.html` (marked "Profile feature").
