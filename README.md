# LumeX Fud

Next.js/Supabase food ordering for customers, vendors, riders and operators.
Use Node 22 or newer.

## Start here

- [Repository map](docs/launch/REPOSITORY_MAP.md)
- [Actual MVP scope](docs/launch/MVP_SCOPE.md)
- [Traceability matrix](docs/launch/MVP_TRACEABILITY_MATRIX.md)
- [Developer handoff](docs/launch/DEVELOPER_HANDOFF.md)
- [Certification and launch gates](docs/launch/MVP_CERTIFICATION.md)
- [Operations runbook](docs/operations.md)

Copy `.env.example` to an untracked local environment file and provide only the
providers you are exercising. Never commit secrets.

```powershell
npm.cmd ci
npm.cmd run dev
```

Before a change is handed off:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
git diff --check
```

Ordering is operationally controlled. DVA and customer stored value are not part
of the launch MVP and must remain disabled.
