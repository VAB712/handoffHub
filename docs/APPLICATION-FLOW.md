# Handoff Hub — Application flow

End-to-end flow from opening the app through workspace selection to handoff sheet actions.  
For component architecture and API data flows, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 1. Full application flow

```mermaid
flowchart TB
  subgraph ENTRY["Entry"]
    START(["Open app / deep link"])
    START --> MW{Middleware:<br/>page has JWT?}
    MW -- No --> LOGIN["/login<br/>User ID + password"]
    LOGIN --> CREDS{Valid bcrypt<br/>credentials?}
    CREDS -- No --> LOGIN
    CREDS -- Yes --> JWT["Set JWT session cookie<br/>14 days · isAdmin · team"]
    MW -- Yes --> WS_PAGE
    JWT --> WS_PAGE
  end

  subgraph WS_HUB["Workspace hub — /workspaces"]
    WS_PAGE["/workspaces"]
    WS_PAGE --> ROLE{isAdmin?}
    ROLE -- Yes --> ADMIN_OPS["All workspaces<br/>Create / rename tabs<br/>Create users · bulk CSV<br/>/workspaces/all-users"]
    ROLE -- No --> USER_OPS["Mapped workspaces only<br/>user_workspace_access"]
    ADMIN_OPS --> PICK["Select workspace tab"]
    USER_OPS --> PICK
  end

  subgraph HANDOFF["Handoff sheet — /w/{id}/handoff/{date}"]
    PICK --> SHEET["Handoff page<br/>Header = workspace name<br/>Sidebar = dates by month"]
    SHEET --> ACTION{What do you do?}
  end

  subgraph READ["View (any date)"]
    ACTION --> VIEW["Open date from sidebar"]
    VIEW --> RO{Latest day<br/>in workspace?}
    RO -- Yes --> RW["Read + write allowed<br/>on topics / updates"]
    RO -- No --> RR["Read-only history"]
  end

  subgraph WRITE["Changes (latest day only)"]
    ACTION --> TEAM["Header Team selector<br/>On-shore · Off-shore · None"]
    TEAM --> POST["Post update<br/>prefix by team + colour"]
    ACTION --> TOPIC["Add topic · edit summary<br/>priority · sheet · close item"]
    ACTION --> EDIT["Edit latest update only<br/>team edit rules apply"]
    ACTION --> FILE["Upload attachment<br/>to latest comment"]
  end

  subgraph HO_OPS["Handoff day operations"]
    ACTION --> ADD_HO["Add HO"]
    ADD_HO --> ADD_CHK{Today exists?}
    ADD_CHK -- Yes --> ADD_409["409 — already exists"]
    ADD_CHK -- No --> ADD_OK["Copy open items from<br/>previous day + files"]
    ACTION --> DEL_HO["Delete HO"]
    DEL_HO --> DEL_CHK{Is latest day?}
    DEL_CHK -- No --> DEL_403["403 — not allowed"]
    DEL_CHK -- Yes --> DEL_OK["Remove day + topics<br/>+ attachment folders"]
  end

  subgraph TOOLS["Tools & account"]
    ACTION --> SEARCH["Search workspace<br/>min 2 chars → jump to topic"]
    ACTION --> COPY["Copy table / row<br/>rich HTML clipboard"]
    ACTION --> PROFILE["/profile<br/>change password"]
    ADMIN_OPS --> PROFILE
    USER_OPS --> PROFILE
  end

  RW --> STORE[(PostgreSQL)]
  RR --> STORE
  POST --> STORE
  TOPIC --> STORE
  EDIT --> STORE
  FILE --> DISK[(Attachments disk)]
  FILE --> STORE
  ADD_OK --> STORE
  ADD_OK --> DISK
  DEL_OK --> STORE
  DEL_OK --> DISK
  SEARCH --> STORE
  PROFILE --> STORE
```

---

## 2. Comment prefix by team (when posting an update)

```mermaid
flowchart LR
  subgraph SELECT["Team in header"]
    T1[On-shore]
    T2[Off-shore]
    T3[None]
  end

  T1 --> P1["12/05 (on-shore) -<br/>bold blue prefix"]
  T2 --> P2["12/05 (off-shore) -<br/>bold orange prefix"]
  T3 --> P3["12/05 -<br/>bold green prefix"]

  P1 --> BODY["Comment body<br/>normal black text"]
  P2 --> BODY
  P3 --> BODY
```

---

## 3. Route map (main screens)

| Step | Route | Who |
|------|-------|-----|
| Login | `/login` | Everyone |
| Home redirect | `/` → `/workspaces` | Everyone |
| Workspace picker | `/workspaces` | Everyone |
| All users (admin) | `/workspaces/all-users` | Admin |
| Handoff sheet | `/w/{workspaceId}/handoff/{YYYY-MM-DD}` | Everyone with access |
| Profile | `/profile` | Everyone |

---

## 4. Decision rules (quick reference)

| Action | Allowed when |
|--------|----------------|
| Edit topic / post update / upload file | Selected date is the **latest** handoff day in that workspace |
| Edit a comment | That comment is the **latest** on its topic, plus team/author rules |
| Add HO | No handoff row yet for **today** in that workspace |
| Delete HO | Selected date **is** the latest handoff day in that workspace |
| View older dates | Always (read-only for mutations) |

---

## How to view these diagrams

- **GitHub / GitLab** — Mermaid renders in the markdown preview.
- **VS Code / Cursor** — Markdown preview with Mermaid support.
- **Export** — Paste the `mermaid` block into [mermaid.live](https://mermaid.live) to export PNG or SVG.
