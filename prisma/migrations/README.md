# Prisma Migrations

This directory contains database migrations managed by Prisma.

## Usage

```bash
# Create a new migration after changing schema.prisma
npm run db:migrate

# Apply migrations to database
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset

# View database with Prisma Studio
npm run db:studio
```

## Migration Files

Migrations are created automatically when you run `prisma migrate dev`.
Each migration is a SQL file that can be version controlled.

## Production

In production, use `prisma migrate deploy` to apply pending migrations.
Never run `migrate dev` in production.
