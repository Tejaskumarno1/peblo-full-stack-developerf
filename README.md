# Peblo Productivity Hub

Welcome to **Peblo**, an advanced, AI-powered productivity ecosystem. Peblo transitions beyond a standard note-taking app into a holistic workspace featuring a unified To-Do system, intelligent data intake, and an ever-present, context-aware AI assistant.

This project demonstrates a production-grade full-stack application with a modern React frontend and a Node.js/Express backend.

---

## 🚀 Key Features

### 🧠 Intelligent AI Assistant
- **Context-Aware Chat Panel:** A draggable, glassmorphic AI chat window that stays with you across the app. It auto-detects the current note you are reading to provide context-aware insights.
- **Smart Intake Engine:** Paste raw meeting notes, sprawling emails, or braindumps. The AI automatically categorizes the data, creates organized notes, and extracts actionable To-Dos with deadlines.
- **Slash Commands:** Type `/` in the AI chat to instantly access commands like `/summarize`, `/actions`, `/rewrite`, and `/fix`.
- **Live Streaming & Persistence:** Cancel AI requests mid-generation with a stop button. Chat history is persisted locally so you never lose your context.

### 📊 Productivity Dashboard
- **Daily Briefing & Weekly Insights:** Your dashboard dynamically aggregates overdue tasks, today's focus, and provides a weekly AI-generated velocity report measuring task completion rates.
- **Analytics Heatmap:** Visualize your productivity streak and note creation patterns over the year.

### 📝 Workspace & To-Do System
- **Unified Task Management:** A centralized To-Do list with prioritization, deadlines, and direct linking back to source notes.
- **Global Command Palette:** Hit `Cmd + K` (or `Ctrl + K`) anywhere in the app to instantly search through your notes, navigate the workspace, or trigger the AI assistant without touching your mouse.
- **Public Share:** Generate secure links to share your notes publicly.

---

## 💻 Tech Stack

- **Frontend**: React 18, Vite, React Router, Vanilla CSS (Custom Design System).
- **Backend**: Node.js, Express.js.
- **Database**: PostgreSQL (Supabase) via Prisma ORM.
- **AI**: Multi-provider cascade — OpenAI (primary) → Google Gemini (fallback) → Mock responses (safety net).
- **Security**: `bcryptjs`, `jsonwebtoken`, `express-rate-limit`.

---

## ⚙️ Setup Instructions

### 1. Prerequisites
- Node.js (v18+)
- npm (v9+)

### 2. Installation
Run the following command from the root directory to install all dependencies for the server, client, and root:

```bash
npm run install:all
```

### 3. Environment Variables
In the `server` directory, create a `.env` file (or copy `.env.example` to `.env`):

```bash
cp .env.example server/.env
```

Required environment variables:
- `DATABASE_URL` — PostgreSQL connection string (Supabase)
- `OPENAI_API_KEY` — OpenAI API key (Primary)
- `GEMINI_API_KEYS` — Comma-separated Google Gemini API keys (Fallback)
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — JWT signing secrets

### 4. Database Setup
Push the Prisma schema and seed the database with initial demo data:

```bash
npm run db:push
npm run db:seed
```

This will create a demo user with sample notes, tags, and tasks.
- **Email**: demo@peblo.dev
- **Password**: demo123

### 5. Running the Application
From the root directory, start both the client and server concurrently:

```bash
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001

---

## 🏛 Architecture Highlights

- **Monorepo Structure**: Separate `/client` and `/server` directories with unified root commands.
- **Atomic Transactions**: The dashboard and Smart Intake rely on `Prisma.$transaction` to guarantee data integrity across complex, multi-entity AI insertions (e.g., creating a note and 5 tasks simultaneously).
- **Design System**: A dark-mode first design utilizing glassmorphism, floating shadows, and vibrant purple/violet accents without relying on heavy utility CSS frameworks. 

## 🧪 Testing

Log in with `demo@peblo.dev` / `demo123` to immediately view the populated Daily Briefing dashboard, interact with the Command Palette (`Cmd+K`), and test the Smart Intake AI Chat (`Ctrl+Shift+A`).
