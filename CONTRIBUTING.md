# Contributing

Thank you for your interest in contributing to EnerPlanET.

Contributions are welcome in the form of bug reports, feature requests, documentation improvements, and code changes.

## Before You Start

- Read the [README](README.md) for project setup and architecture overview
- Check existing [issues](https://github.com/THD-Spatial/enerplanet/issues) to avoid duplicates
- For significant changes, open an issue first to discuss the approach

## Development Workflow

### 1. Fork and Clone

If you do not have direct write access:

```bash
git clone https://github.com/THD-Spatial/enerplanet.git
cd enerplanet
```

### 2. Create a Branch

```bash
git checkout -b fix/short-description    # Bug fix
git checkout -b feat/short-description   # New feature
git checkout -b docs/short-description   # Documentation
```

### 3. Make Your Changes

Follow the conventions of the file you are editing:

- **Backend (Go):** `gofmt` formatting, standard Go idioms
- **Frontend (TypeScript/React):** ESLint + Prettier (config in `.eslintrc` and `.prettierrc`)
- **Database:** Add a migration file in `enerplanet/backend/migrations/`

### 4. Test Your Changes

```bash
# Backend tests
cd enerplanet/backend && go test ./...

# Frontend type check
cd enerplanet/frontend && npm run type-check

# Frontend lint
cd enerplanet/frontend && npm run lint
```

### 5. Commit and Push

```bash
git add <specific-files>
git commit -m "Short summary of the change"
git push -u origin <your-branch>
```

### 6. Open a Pull Request

Target the `main` branch. Include:

- What changed and why
- Steps to test the change
- Screenshots for UI changes
- Reference to related issues (e.g. `Closes #123`)

## Pull Request Checklist

- [ ] Change is scoped and focused
- [ ] Tests pass locally
- [ ] Documentation updated if behaviour changed
- [ ] No secrets or credentials committed
- [ ] No unrelated formatting changes

## Reporting Bugs

Open an issue at [github.com/THD-Spatial/enerplanet/issues](https://github.com/THD-Spatial/enerplanet/issues) with:

- Expected vs. actual behaviour
- Steps to reproduce
- Environment details (OS, browser, Docker version if relevant)
- Error messages or logs

## Code of Conduct

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
