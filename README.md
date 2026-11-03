# SkyLabs

A Windows desktop application for importing CAD, preparing external-flow studies,
running OpenFOAM RANS, and viewing results locally. Version 0.14.0 supports air,
fully submerged water, and optional ground/seabed boundaries.

## Get started

Use Windows 10/11 x64, Git, and **Node.js 24 LTS**. In the repository root:

```powershell
npm run setup
npm test
npm start
```

`setup` installs the locked application dependencies. `start` builds and opens the
desktop app. The **?** button opens the included user manual.

**OpenFOAM is a separate installation.** Importing models and viewing saved
results work without it; running CFD requires the compatible solver described in
[runtime setup](docs/RUNTIME.md). GPU support also requires a separate runtime.

## Features

- STL, OBJ, STEP and 3MF import, model cleanup, Onshape import, and a local Fusion bridge.
- Steady incompressible k–omega SST RANS; four mesh/quality levels and convergence checks.
- Multiple angle-of-attack/yaw conditions saved in one project.
- Pressure, friction, velocity, slices, streamlines, Q-criterion vortices and force plots.
- Lift location, estimated uniform-solid CG, comparison scores and optional AI review.
- Local `.aero` projects with companion `.aero.results` folders for sampled fields.

Accounts and API keys are configured by each user inside the app. None are
included in this repository or the portable application.

## Accuracy and scope

This is experimental engineering software. A low residual or high plane score is
not evidence of agreement with experiments. Check geometry repair, real dimensions,
reference area, wall layers, y+, force convergence and mesh sensitivity. Scores are
comparison heuristics, not flight-safety or stability certification.

The solver is fully turbulent and steady. It does not model transition, transient
stall, rotating propulsion or dynamic flight. Water mode is single-phase and fully
submerged: no free surface, waves, hydrostatic buoyancy or cavitation. Ground and
water studies need their own validation against appropriate reference data.

## Build and distribute

```powershell
npm run check:repo
npm run build
npm run dist
```

The Windows ZIP and its SHA-256 checksum are written to `outputs/releases/`.
The ZIP includes the app, manual, notices and corresponding CAD-library source;
it does **not** include OpenFOAM, MPI, CUDA or user data. The app is unsigned.
`npm run package` creates just the app folder for local testing.

[Publishing instructions](docs/PUBLISHING.md) cover GitHub, CI, version tags and
draft releases. [Contributing](CONTRIBUTING.md) describes the source layout.

## License

SkyLabs code is MIT-licensed; see [LICENSE](LICENSE). Dependencies retain their
own licenses, including LGPL CAD libraries. See
[third-party notices](work/aerodesk/THIRD-PARTY-NOTICES.txt) and
[corresponding-source instructions](docs/THIRD_PARTY_SOURCE.md).
SkyLabs is an independent project, not affiliated with AirShaper, Onshape or Autodesk.
