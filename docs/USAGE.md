# Handoff Hub — Usage

Short guide for daily use of the handoff app.

---

## 1. Sign in

1. Open the app URL in your browser.
2. Enter your **User ID** and **password**.
3. After login you land on **Workspaces** (`/workspaces`).

---

## 2. Choose a workspace

Workspaces are separate handoff sheets (e.g. **FE Production**, **OMS DEV**, **Testing**).

- Click a workspace to open today’s handoff sheet.
- If you only have access to one workspace, the app opens it automatically.

---

## 3. Handoff sheet (daily work)

Each day is a dated page. The **left sidebar** lists past days grouped by month.

| Action | How |
|--------|-----|
| **Start today** | Click **Add HO** — copies open items from the previous handoff day (updates + attachments). Only works if today does not exist yet. |
| **Add a topic** | Use **Add row** at the bottom. Fill **Summary**, **Owner**, **Priority**, and optional **Sheet** data. |
| **Post an update** | Pick **On-shore**, **Off-shore**, or **None** in the header, type in the update box, click **Post update**. The date/team prefix is added automatically. |
| **Edit** | Summary, owner, priority, and the **latest update** on a topic can be edited on the **latest handoff day only**. |
| **Close an item** | Toggle the status control on the row when the issue is done. |
| **Attach a file** | Upload from the latest update on a topic (latest day only). |
| **View history** | Click any older date in the sidebar — read-only. |
| **Remove today** | **Delete HO** removes the **latest** day in this workspace only (all rows, updates, and files for that day). |

Dates display as **DD-MM-YYYY**. **Add HO** uses your browser’s local calendar for “today”.

---

## 4. Search and copy

- **Search** (top bar): enter at least 2 characters to find topics across the workspace; click a result to jump to that day and row.
- **Copy**: use copy actions on the table or a row to paste formatted content into email or documents.

---

## 5. Profile

Open **Profile** (`/profile`) to:

- Change your password
- Set or update your contact email

---

## 6. Admin (workspace administrators)

Admins see extra options on **Workspaces**:

- **Add / rename / remove** workspace tabs
- **Create users** with full admin access or access to specific workspaces
- **Bulk import** users from the Excel template
- **All users** (`/workspaces/all-users`) — search and review user access

---

## Quick rules

| You can edit… | When… |
|---------------|--------|
| Topics, updates, attachments | The selected date is the **latest** handoff day in that workspace |
| A comment | It is the **latest** update on its topic (plus team/author rules) |
| **Add HO** | Today’s handoff does **not** exist yet |
| **Delete HO** | You are on the **latest** handoff day |

For flow diagrams and technical detail, see [`APPLICATION-FLOW.md`](APPLICATION-FLOW.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).
