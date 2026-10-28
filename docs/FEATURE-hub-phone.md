# Hub Phone (Oct 2026)

Hub users can call each other by voice or video inside the hub. There are no real phone numbers and no phone credit. The tile is **Hub Phone** in Hub Applications, and everyone with a hub account can use it.

## Extensions
- Every active person gets an extension automatically. The first digit shows where they work:
  - **1xx** Verdun Mall
  - **2xx** Achrafieh Mall
  - **3xx** Dbayeh
  - **4xx** Verdun DS
  - **5xx** Achrafieh DS
  - **9xx** leadership and administrators
- Within a flagship, management get the first numbers, then the operations team, then security.
- Administrators with a real role (for example Mall Supervisor) take the extension of that role's flagship.
- To change an extension: Admin Control Center → People & roles → Edit → **Hub Phone extension**. An extension is 3–4 digits and must be unique. Leave the field empty to keep the current extension.

## The page (`/tools/phone`)
- **Keypad:** type an extension. The matching person appears under the number; then press call or video.
- **Contacts:** everyone, grouped by flagship and Leadership. Search by name, extension or position, or filter to "Online now". The green dot means the hub is open on one of their devices.
- **Recent:** incoming and outgoing calls with their duration. Missed calls are shown in red, and a badge shows the number not seen yet.
- **Favourites:** tap ☆ next to a person. Favourites are kept on each device.

## A call
- The hub keeps a live connection while it is open (`tools/phone-core.js`, loaded by `index.html`).
- **Incoming call:** a full-screen call screen opens over the whole hub on every device where the hub is open. The screen offers Answer, Voice only (for a video call) and Decline. The hub also plays a ringtone and vibrates the phone.
- **Hub closed or hidden:** after 3.5 s the person gets a push notification with **Answer** and **Decline**. Answer opens the hub on the call.
- **Missed call:** when nobody answers within 40 s, the call counts as missed. The person gets a "Missed call" notification and the call appears in red in Recent.
- **During the call:** Mute, Camera (on and off, also during a voice call), Flip (front and back camera), Minimise and End. Minimise shrinks the call to a green bar, so the hub can be used during the call.
- **Busy:** a person already on a call is not rung. The call is logged as missed for them.

## How it works
- Calls are WebRTC, browser to browser. **Voice and video never pass through the hub or get recorded.**
- The Durable Object **PhoneHub** (binding `PHONE`, migration `v2-hub-phone`) passes the small signalling messages between the two devices over WebSockets: ring, accept, the connection details and end. It hibernates when nobody is talking.
- **Cloudflare TURN** relays the call when the two devices cannot reach each other directly, for example on mobile data or behind a company firewall.
  - It needs the secrets `TURN_KEY_ID` and `TURN_KEY_TOKEN`, created under Cloudflare → Realtime → TURN.
  - Without them the hub uses public STUN only. Calls then work on most Wi-Fi but may fail between mobile networks.

## Table and routes
- `phone_calls`: id, from/to, video, status (`ringing`, `answered`, `declined` or `missed`), started_at, answered_at, ended_at, seen.
- `users.ext`: the extension.
- Routes:
  - `GET /api/phone/ws`: WebSocket.
  - `GET phone/book`: people, extensions and who is online.
  - `GET phone/ice`: ICE servers.
  - `GET phone/recent`
  - `POST phone/seen`
  - `POST phone/decline`: the Decline button on the push notification.

## Later (not built)
- WhatsApp-style groups (chat and group calls), adding a third person to a call, call transfer and group extensions.
