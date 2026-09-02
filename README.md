# JoharHaat API

## Neon development setup

Use Node 22 (`nvm use`). Copy `.env.example` to `.env`, then add the Neon pooled `DATABASE_URL`, direct `DIRECT_URL` and strong local secrets.

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:validate
pnpm prisma:migrate:deploy
pnpm prisma:seed
pnpm dev
```

The API runs at `http://localhost:4000`, readiness is available at `/api/v1/health/ready`, and Swagger UI is at `/api/docs`.

## Quality checks

```bash
pnpm prisma:validate
pnpm test
pnpm typecheck
pnpm build
```

Use `prisma migrate deploy` for shared/production databases. `migrate dev` is only for an isolated Neon development branch.
