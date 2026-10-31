# AeroDesk 0.14.0

Windows x64 desktop application with CAD import, local OpenFOAM RANS studies and
interactive result viewing.

- Fully submerged water presets and configurable fluid properties.
- Optional moving-ground or stationary tunnel-floor conditions with clearance.
- Multiple angle-of-attack/yaw runs per project, saved sampled fields and comparisons.
- Four quality levels, wall/force/convergence checks and a three-mesh Reference mode.
- STEP/3MF/STL/OBJ import, Onshape connection and local Autodesk Fusion bridge.
- Portable distribution with manual, dependency notices and CAD-library source.

Extract the ZIP and open `AeroDesk-win32-x64/AeroDesk.exe`. Read `RUNTIME.md`:
**OpenFOAM, MPI and optional GPU runtimes are installed separately.** No user
projects, CAD accounts or API keys are bundled. This build is unsigned.

Results remain dependent on geometry repair, mesh and model assumptions. Steady
fully turbulent SST does not capture transition or transient aircraft dynamics.
Water mode excludes free surfaces, waves, buoyancy and cavitation. Plane scores
are comparative heuristics, not certification. Automated tests verify software
behavior and do not establish experimental accuracy.
