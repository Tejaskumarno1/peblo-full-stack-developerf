# Peblo Notes — Full Stack Developer Challenge

Welcome to **Peblo Notes**, a collaborative AI-powered notes workspace. This project was built to demonstrate a full-stack application with a modern React frontend and a Node.js/Express backend.

## Features

- **Authentication**: Secure signup and login with JWT and refresh tokens.
- **Notes Workspace**: Create, edit, tag, categorize, and archive notes with auto-saving.
- **AI Integration**: Summaries, action items, title suggestions, and a **Dashboard AI chat** that creates or updates notes from natural language (Google Gemini).
- **Search & Filtering**: Quickly find notes using keyword search, tag filtering, and sorting.
- **Public Share**: Generate secure links to share your notes publicly.
- **Productivity Dashboard**: View insights, activity charts, top tags, and AI usage statistics.

## Tech Stack

- **Frontend**: React 18, Vite, React Router, Vanilla CSS (with CSS Variables for theming).
- **Backend**: Node.js, Express.js.
- **Database**: SQLite (via Prisma ORM), easily migratable to PostgreSQL.
- **AI**: Google Gemini API (`@google/generative-ai`).
- **Security**: bcryptjs, jsonwebtoken, express-rate-limit.

## Setup Instructions

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

Make sure to populate `GEMINI_API_KEY` in the `.env` file if you want real AI functionality. If no key is provided, the application will fall back to mocked AI responses for testing purposes.

### 4. Database Setup
The app uses SQLite for local development. Push the schema and seed the database:

```bash
npm run db:push
npm run db:seed
```

This will create a demo user with sample notes and tags.
- **Email**: demo@peblo.dev
- **Password**: demo123

### 5. Running the Application
From the root directory, start both the client and server concurrently:

```bash
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001

## Architecture

This project is structured as a monorepo:
- `/client`: Vite + React application.
- `/server`: Express + Prisma backend.

### Database Schema Highlights
- `User`: Handles authentication and ownership.
- `Note`: Core entity storing content, metadata, and sharing status.
- `Tag` and `NoteTag`: Enables a many-to-many relationship for flexible categorization.
- `AiGeneration`: Persists AI-generated summaries and actions to avoid repeated API calls.

## Design System

The application features a dark-mode first design with a glassmorphic aesthetic and vibrant purple/violet accents (Peblo's brand identity). The CSS uses custom properties to maintain consistency across the app without the overhead of utility libraries.

## Testing

A demo seed is provided. Log in with `demo@peblo.dev` / `demo123` to immediately view a populated dashboard and start interacting with notes.
