# Welcoming email (Oct 2026)

**Adding a person.** In Admin Control Center → People & roles → Add a person, choose **Send welcoming email** (the default) or **Don't send welcoming email**. **👁 Preview the email** shows the email built from what is typed in the form; nothing is saved.

**Sending again.** Each active person in the list has a **✉ Welcome** button that sends the email again. Each send is recorded in Change history.

**Existing people.** The **✉ Welcoming email to existing people** button opens a list of the active people of the selected flagship tab, or of everyone. People who have not received the email yet are ticked; it shows when the others last received it. Press **Send** (`admin/users/welcome-bulk`).

**What the email contains**
- the ABC header and "Welcome to the hub, [first name]";
- the person's sign-in email, position and flagship(s);
- an **Open the ABC Operations Hub** button;
- "Your first 5 minutes": sign in, choose your own password, install on the phone, allow notifications / Face ID;
- the tools of their role and flagship;
- a help contact, signed by the admin who sends it.

**Password in the email (28 Oct 2026, asked by Sultan).** The first password of new accounts is **Abc@2026**. It is pre-filled in the form and can be changed there. The email shows the password only when the hub knows it:
- a new person: the password typed in the form;
- an existing person who never signed in: their password is set again to Abc@2026.

People who already chose their own password keep it; the email says "Your current hub password". Everyone must change the first password at their first sign-in.

**How it is sent:** from the sending admin's Outlook when it is connected, otherwise through the mail relay. Replies go to that admin. If the email cannot be sent, the person is still added and the message says why.

**Code:** `worker.js` → `welcomeMail`, `sendWelcome`, routes `admin/users/welcome` and `admin/users/welcome-preview`; option `welcome` on `admin/users`. Page: `tools/admin.html`.
