# Hub Chat (Oct 2026)

Group and one-to-one chats. They live inside **Hub Phone** as tabs: **Chats · Calls · Contacts · Keypad**. The **Phone** folder holds two tiles:
- **Hub Phone** opens the page on Calls;
- **Hub Chat** opens the same page on Chats.

## Groups
- **Ready-made groups**, kept in step with People & roles every minute and whenever a person is saved:
  - **"<Flagship> · Team"** (×5): everyone at that flagship, plus the Property Advisor, Mall Directors and CDSO who cover it;
  - **"Flagship Managers"**: all managers, leadership and administrators;
  - **"All flagships · Announcements"**: everyone. Only leadership and administrators post here.
- A new person joins their groups automatically; a switched-off person leaves every chat. People added to a ready-made group by hand stay until they are removed. Nobody can leave a ready-made group, but they can mute it.
- **Leadership and administrators** create groups (＋ → New group). They can also add people to any group and change its settings: the name, "Only admins can send" and "Members can add people".
- **Group admins** (the creator, and anyone they make admin) manage their own groups.
- **Everyone** chats one-to-one: ＋ → a person, or 💬 next to a person in Contacts.

## Messages
- **Content:**
  - text and emoji;
  - photos from the camera or gallery, made smaller to 1,600 px before sending;
  - files up to 15 MB (PDF, Excel, Word, CSV and more);
  - voice notes (tap the microphone, then ✕ to cancel or ➤ to send; up to 5 minutes).
- **Tapping a message** opens a menu with:
  - reactions (👍 ❤️ 😂 😮 🙏 ✅);
  - Reply;
  - Copy;
  - **Seen by**;
  - Delete for everyone (your own messages; group admins can delete any message).
- **@mentions:** type @ in a group and pick a member.
- **Ticks:** ✓ means sent. ✓✓ in blue means everyone in the chat has read it.
- **Kept for 1 month:** a daily clean-up deletes older messages and their files from storage.

## Notifications
- There is a push notification for every message, unless the person has the chat open on screen.
- **🔕 Mute** is set per chat in Chat info. A muted chat still notifies the person when they are @mentioned.
- The floating Hub Phone button counts missed calls plus unread messages. Quick dial shows "💬 N unread messages · Open chats".
- Tapping a chat notification opens the hub on that chat.

## How it works
- **Live updates** use the Hub Phone connection (Durable Object **PhoneHub**):
  - the worker saves the message and then sends the event to everyone in the chat (`/chat-fan`);
  - each open page tells the Durable Object which chat it shows (`viewing`), so those people are not pushed.
- **Tables:**
  - `chat_convs`: kind dm/group, name, pair, auto_key, announce, members_add, last message;
  - `chat_members`: role admin/member, src auto/hand, muted, last_read;
  - `chat_msgs`: kind text/photo/file/voice/system, file in R2 `FILES` at `chat/<conv>/<uuid>`, reply_to, mentions, reactions, deleted.
- **Routes** (`/api/chat/`):
  - `list` · `dm` · `msgs` (`?c=&before=&after=`) · `send` · `file` · `read` · `react` · `delete`
  - `mute` · `group` (create / rename / settings / add / remove / admins) · `leave` · `seen` · `unread`
- **Cron:** `chatRun`, once a day, removes messages and files older than 30 days.
