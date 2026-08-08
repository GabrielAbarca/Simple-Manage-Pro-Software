<div align="center">
  <img width="715" height="206" alt="SMP-dashboard-logo" src="https://github.com/user-attachments/assets/f16f1a37-397e-4341-ae79-e2bc69ba6c7a" />
  <h1>SMP Dashboard</h1>
  <p><strong>A full-featured school management dashboard for Costa Rican schools —<br/>built on a 27-table PostgreSQL schema with real-time data via Supabase.</strong></p>

  <br/>

  <a href="https://smp-web-page-hylqkoh2o-gabrielabarcas-projects.vercel.app/" target="_blank">
    <img src="https://img.shields.io/badge/Live%20Demo-Open%20App-7c3aed?style=for-the-badge&logo=vercel&logoColor=white" alt="Live Demo"/>
  </a>
  &nbsp;
  <img src="https://img.shields.io/badge/Status-In%20Progress-f59e0b?style=for-the-badge" alt="Status"/>
  &nbsp;
  <img src="https://img.shields.io/github/actions/workflow/status/GabrielAbarca/SMP-Web-Page/ci.yml?style=for-the-badge&label=CI&logo=github&logoColor=white" alt="CI"/>
  &nbsp;
  <img src="https://img.shields.io/badge/Database-PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
  &nbsp;
  <img src="https://img.shields.io/badge/Backend-Supabase-3ecf8e?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase"/>
</div>

---

## 📸 Preview

<div align="center">
  <img width="1440" height="900" alt="Dashboard-Preview" src="https://github.com/user-attachments/assets/b3edce7f-c4f9-41f3-927e-f573df4a5770" />

</div>

---

## 🧩 What is SMP?

SMP Dashboard is a web-based school management platform designed around the operational structure of Costa Rican secondary schools (colegios). It gives administrators and staff a centralized view of everything happening across an institution. From class schedules and teacher assignments to student grades, attendance records, and upcoming events.

The project targets real data complexity: the underlying PostgreSQL schema spans **27 tables** to model grading periods, course sections and enrollment. All served in real time through Supabase.

---

## ✨ Features

| Module                     | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| 📊 **Grades & Attendance** | Track student academic performance and daily attendance             |
| 📅 **Schedules**           | View weekly class schedules per course and teacher                  |
| 👨‍🏫 **Teacher Assignments** | View teachers assigned to the student                               |
| 🏫 **Class Information**   | Detailed view of each class — enrolled year, class number, status   |
| 📆 **Upcoming Events**     | Institution events board for academic and administrative activities |
| 📈 **Reports & Analytics** | Data views for attendance rates and grade distributions             |

---

## 🛠 Tech Stack

<div align="center">
  <img src="https://skillicons.dev/icons?i=js,html,css,vite,postgres,supabase,vercel&theme=dark" />
</div>

<br/>

| Layer              | Technology                                                                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**       | ![JS](https://img.shields.io/badge/JavaScript-f7df1e?style=flat-square&logo=javascript&logoColor=black) ![HTML](https://img.shields.io/badge/HTML5-e34f26?style=flat-square&logo=html5&logoColor=white) ![CSS](https://img.shields.io/badge/CSS3-1572b6?style=flat-square&logo=css3&logoColor=white) |
| **Build Tool**     | ![Vite](https://img.shields.io/badge/Vite-646cff?style=flat-square&logo=vite&logoColor=white)                                                                                                                                                                                                        |
| **Database**       | ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=flat-square&logo=postgresql&logoColor=white) hosted on Supabase                                                                                                                                                                   |
| **Backend / Auth** | ![Supabase](https://img.shields.io/badge/Supabase-3ecf8e?style=flat-square&logo=supabase&logoColor=white) RLS · Auth · Realtime                                                                                                                                                                      |
| **Deployment**     | ![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)                                                                                                                                                                                                  |

---

## 🗄️ Database Architecture

The schema is designed around the structure of the Costa Rican school system — a February-to-December _curso lectivo_ split into two _periodos_ — separating concerns across academic, administrative, and scheduling domains.

```
Core entities (partial):
├── school_years           ← the curso lectivo
├── grading_periods        ← two periodos per year
├── grade_levels
├── classes                ← a grade level's sections
├── subjects
├── students               ← enrolled into a class
├── class_subject_teachers ← teachers ↔ subjects ↔ classes
├── attendance
├── student_grades
├── events
└── ... (27 tables total)
```

> 💡 **Design decision:** Row Level Security (RLS) policies are enforced at the database level — not just the application layer — so each role (admin, teacher, student) can only read and write the rows they own, regardless of how the frontend queries Supabase.

---

## ⚙️ Local Setup

### Prerequisites

- Node.js 22+
- A [Supabase](https://supabase.com) project with the schema applied

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/GabrielAbarca/SMP-Web-Page.git
cd SMP-Web-Page

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Fill in your Supabase URL and anon key

# 4. Start the dev server
npm run dev
```

### Environment Variables

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Scripts

| Command             | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `npm run dev`       | Start the Vite dev server                                    |
| `npm run build`     | Production build to `dist/`                                  |
| `npm run preview`   | Preview the production build locally                         |
| `npm run lint`      | Lint the codebase with ESLint                                |
| `npm run format`    | Format with Prettier (`npm run format:check` to verify only) |
| `npm run typecheck` | Type-check the JS via JSDoc + TypeScript `checkJs`           |
| `npm test`          | Run the Vitest unit suite                                    |
| `npm run test:e2e`  | Run the Playwright end-to-end suite                          |

---

## 🧪 Quality & Testing

Quality gates run automatically in **CI** (GitHub Actions) on every push and pull request to `main` / `development`, and locally through a **husky** pre-commit hook (`lint-staged`).

| Gate            | Tooling                                                           |
| --------------- | ----------------------------------------------------------------- |
| **Formatting**  | Prettier                                                          |
| **Linting**     | ESLint (flat config)                                              |
| **Type safety** | JSDoc + TypeScript `checkJs` — no compile step                    |
| **Unit tests**  | Vitest — query/aggregation, i18n and demo-sandbox logic (`test/`) |
| **End-to-end**  | Playwright — login, student, teacher and admin portals (`e2e/`)   |

The end-to-end suite is fully self-contained: it boots the app with placeholder environment variables and mocks Supabase at the network layer, so it needs no real backend or credentials — and it verifies the demo sandbox's **zero-write** guarantee.

---

## 🧱 Challenges Solved

- **RLS policy conflicts** — early schema versions had overlapping policies causing silent read failures; resolved by auditing policy targets per role and table combination
- **IPv6 connection errors on Vercel** — Supabase's direct connection doesn't support IPv6; fixed by switching to the Session Mode pooler URL
- **27-table relational schema** — modeling Costa Rican school structures (multi-period, multi-section, multi-role) without redundant data required several rounds of table-structuring before the schema stabilized

---

## 🗺️ Roadmap

- [x] Role-based login (admin · teacher · student views)
- [x] Admin console — academic structure CRUD (years, periods, grade levels,
      sections, subjects, teacher assignments, schedules)
- [x] Admin console — student records, section enrollment & CSV roster import
- [x] Admin console — user accounts (create/reset/deactivate) via Edge Function
- [x] Admin console — school-wide overview (enrollment · attendance · at-risk)
- [ ] PDF report export
- [ ] Mobile-responsive layout
- [ ] Notification system for events and grade updates

---

## 👤 Author

**Gabriel Zelaya** · [gzelaya.com](https://gzelaya.com) · [GitHub @GabrielAbarca](https://github.com/GabrielAbarca)

---

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f0c29,50:302b63,100:24243e&height=100&section=footer" width="100%"/>
</div>
