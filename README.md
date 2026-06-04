# Pave App

A full-stack monorepo starter created with Pave Studio.

## Stack

- **Frontend**: React 19 + TypeScript + Vite + Zustand
- **Backend**: Hono + TypeScript + Drizzle ORM
- **Database**: SQLite
- **Package Manager**: pnpm

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up database
pnpm db:push

# Start development servers (frontend + backend)
pnpm dev
```

The app will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Project Structure

```
.
├── frontend/          # React frontend
│   └── src/
├── backend/           # Hono API server
│   ├── src/
│   └── drizzle/      # Database migrations
└── package.json      # Root package.json
```

## Available Scripts

- `pnpm dev` - Start both frontend and backend
- `pnpm dev:frontend` - Start only frontend
- `pnpm dev:backend` - Start only backend
- `pnpm build` - Build both apps
- `pnpm db:generate` - Generate database migrations
- `pnpm db:push` - Push schema changes to database

## Features

✅ Hot reload for frontend and backend
✅ API proxy configured (frontend `/api` → backend)
✅ TypeScript everywhere
✅ Type-safe database with Drizzle ORM
✅ State management with Zustand
✅ Modern, fast dev experience

Happy coding! 🚀
