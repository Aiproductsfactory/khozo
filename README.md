# Project Khozo

> **Your 1 click — "A missing child can return home"**
> An initiative by Aegis School of Data Science, Mumbai — *Data Science for Social Good*.

A full-stack platform that helps **citizens, NGOs, police, and government** reunite missing
children (and women / persons) with their families using photo reporting and face-match search.

This repository implements the system described in the Khozo deck & proposal:

- **Public landing / intro site** — pitched at prospective customers, the Police department,
  the Government of India, and State Governments.
- **Multi-stakeholder dashboards** with a role hierarchy:
  - **Super Admin** — Govt of India / State Govt / Police Commissioner (nationwide overview)
  - **Admin** — Asst. Commissioner of Police (jurisdiction overview)
  - **User (Police)** — Police Station (registers FIRs, confirms matches, alerts parents)
  - **Parent / Public** — reports a missing child, or uploads a photo of a child they spotted
  - **NGO** — assists like the public
- **Register FIR**, **Police Register**, and a **Capture → Detect → Locate → Match** report flow.

## Tech stack

| Layer    | Choice                                              |
|----------|-----------------------------------------------------|
| Frontend | Vite + React + React Router + Tailwind CSS + Recharts |
| Backend  | Node.js + Express (ES modules), JWT auth, RBAC      |
| Storage  | File-backed JSON store (zero-config), seeded with demo data |
| Matching | Pluggable scorer (placeholder for a face-recognition model) |

> The data store and the face-match scorer are deliberately swappable. The store is a single
> repository module (`server/src/store.js`) and matching lives in `server/src/match.js`, so a real
> database (Postgres) and a real model (face-api / InsightFace) can drop in without touching routes.

## Run it

```bash
# 1. install
npm install            # root: installs both workspaces

# 2. start backend + frontend together
npm run dev
```

- Web app: http://localhost:5173
- API:     http://localhost:4000

### Demo logins (seeded)

| Role        | Email                   | Password   |
|-------------|-------------------------|------------|
| Super Admin | superadmin@khozo.org    | khozo123   |
| Admin       | admin@khozo.org         | khozo123   |
| Police User | police@khozo.org        | khozo123   |
| Parent      | parent@khozo.org        | khozo123   |
| NGO         | ngo@khozo.org           | khozo123   |

## Structure

```
khozo/
  server/   Express API + JSON store + seed
  web/      Vite + React single-page app
```
