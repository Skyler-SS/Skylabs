# Contributing

Use Node.js 24 on Windows x64. Run `npm run setup` once from the repository root.
Before submitting changes, run:

```powershell
npm run check:repo
npm test
npm run build
```

The automated tests use synthetic geometry, fixtures and mocked services; they
do not require CAD accounts, credentials or an OpenFOAM installation. Passing
them verifies application behavior, not CFD accuracy against experiments.

- `work/aerodesk/src/`: renderer, model processing and bundled manual.
- `work/aerodesk/*.cjs`: Electron services, solver integration and packaging.
- `work/aerodesk/tests/`: unit and regression tests.
- `work/aerodesk/fusion/`, `gpu-runtime/`: optional integration assets.
- `scripts/`, `.github/workflows/`: repository checks and release tooling.

Keep projects, CAD exports, simulation cases, credentials and generated binaries
out of Git. Use fictional document IDs and `C:/Users/example/` in fixtures.
The repository scanner is a useful check, not a substitute for reviewing a diff.

For solver changes, include the numerical reason, test geometry and reference
conditions. Distinguish implementation tests, mesh convergence and experimental
validation. Do not improve a score by hiding unconverged or invalid results.

Keep dependency versions locked. If updating the CAD importer, update its license
texts, corresponding-source manifest and checksums together.
