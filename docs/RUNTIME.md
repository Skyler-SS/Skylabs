# Solver runtime setup

## Windows application

Extract the complete release ZIP and run `SkyLabs-win32-x64/SkyLabs.exe`.
The application imports CAD and displays saved results without OpenFOAM. Connect
your own Onshape credentials or optional AI key through the app. Projects do not
carry account credentials.

## CPU CFD

The current launcher expects **OpenFOAM.com v2512**, built for native Windows x64,
with executables under:

```text
<OpenFOAM root>/platforms/win64MingwDPInt32Opt/bin/simpleFoam.exe
```

That root must also contain its matching `etc` configuration and runtime files.
This is a specific native build layout: an arbitrary Linux/WSL install or another
OpenFOAM distribution is not a drop-in CPU replacement. OpenFOAM is GPL-licensed
and is distributed separately. Its upstream source is available from
[OpenCFD](https://dl.openfoam.com/source/v2512/).

Set `AERODESK_OPENFOAM_ROOT` to a compatible installation before starting the app.
For example, with your real paths in PowerShell:

```powershell
$env:AERODESK_OPENFOAM_ROOT = 'D:\CFD\OpenFOAM-v2512'
& 'D:\Apps\SkyLabs\SkyLabs-win32-x64\SkyLabs.exe'
```

Either the distribution root (as above) or the build root inside it
(`…\msys64\home\ofuser\OpenFOAM\OpenFOAM-v2512`) works — the app descends into the
nested layout when the root it is given has no `platforms` directory. The platform
build directory is discovered by looking, so `win64MingwDPInt32Opt` is not assumed.

For a source checkout, set the same variable and run `npm start`. The launcher also
recognizes the original `OpenFOAM-runtime/msys64/home/ofuser/OpenFOAM/OpenFOAM-v2512`
layout beside local version folders. The environment variable avoids relying on
that folder arrangement.

## Multi-core solving

Multi-core needs two things, and official OpenFOAM.com Windows builds already supply
the second:

1. **Microsoft MPI** (`mpiexec.exe`). Found via `MSMPI_BIN`, then Program Files, then
   `PATH`.
2. **An MPI-linked OpenFOAM build.** Official builds ship `libPstream.dll` alongside
   `libPstream.dll-dummy` and `libPstream.dll-msmpi`, and activate one by copying it
   over `libPstream.dll`. When the live file matches the `-msmpi` variant, the ordinary
   `bin/simpleFoam.exe` runs in parallel under `mpiexec` — the same binary used
   serially. No separate parallel build is required.

Earlier versions of this app looked for custom binaries in a
`platforms/win64MingwDPInt32Opt/aerodesk-mpi` directory. **That requirement was a
mistake**: no official distribution has such a folder, so working multi-core hardware
was reported as unavailable. The app now detects capability from the standard `bin`.

If the live `libPstream.dll` matches the `-dummy` variant instead, the build is serial
only; copy the `-msmpi` variant over it to switch. Serial solving never needs MPI.

The worker picker offers up to half the machine's logical cores, and keeps at least
50,000 cells per worker so decomposition overhead does not dominate. Counts the
installed runtime cannot deliver are disabled with the reason shown, before a run
starts rather than after meshing.

## Optional GPU pressure solver

The GPU backend is an advanced, separately provisioned **WSL2 Ubuntu-24.04**
environment with OpenFOAM v2512, PETSc CUDA and its OpenFOAM adapter under
`/opt/aerodesk`. The included scripts document the expected layout in
`work/aerodesk/gpu-runtime/README.txt` (inside the packaged app's resources as well).
They are launch/probe helpers, not a complete runtime installer.

Pressure linear algebra can use the GPU. Momentum, turbulence, meshing and export
still use the CPU. Hardware support, runtime compatibility and problem size affect
speed; selecting GPU does not improve the physical model or guarantee acceleration.
The app probes availability and reports missing components.

## Results and reliability

Save both a `.aero` file and its adjacent `.aero.results` folder to move a project
with sampled result fields. Original OpenFOAM cases remain separate. Runtime paths
from another PC might need reconfiguration before rerunning.

Read the integrated manual's quality section. Steady SST, approximate model
repair, reference-area choices and near-wall mesh quality can materially affect
loads. A successful software build is not an experimental CFD validation.
