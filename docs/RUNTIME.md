# Solver runtime setup

## Windows application

Extract the complete release ZIP and run `AeroDesk-win32-x64/AeroDesk.exe`.
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
& 'D:\Apps\AeroDesk\AeroDesk-win32-x64\AeroDesk.exe'
```

For a source checkout, set the same variable and run `npm start`. The launcher also
recognizes the original `OpenFOAM-runtime/msys64/home/ofuser/OpenFOAM/OpenFOAM-v2512`
layout beside local version folders. The environment variable avoids relying on
that folder arrangement.

Automatic CPU worker selection requires Microsoft MPI and matching parallel
OpenFOAM binaries in the runtime's
`platforms/win64MingwDPInt32Opt/aerodesk-mpi` directory. Serial solving does not
require MPI. The repository does not include these custom binaries or install them.
Check the app's solver status before submitting a run. If no compatible runtime is
present, the app cannot run RANS merely by installing the desktop ZIP.

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
