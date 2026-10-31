AeroDesk 0.14.0

OPEN
Extract the complete release ZIP, then open AeroDesk-win32-x64/AeroDesk.exe.
The ? button opens the user manual. For source setup, read the root README.md.
OpenFOAM is installed separately: see RUNTIME.md in the release ZIP.

PROJECTS
Import STL, OBJ, STEP or 3MF, or connect your own Onshape account.
Check the actual model size and compare repaired geometry to your original CAD.
Save both your .aero file and its adjacent .aero.results folder to reopen fields.
Native OpenFOAM cases are separate. Save after running and before closing.

SOLVING AND QUALITY
Choose Draft, Standard, Detailed or Reference quality. Duration is an estimate,
not a cutoff. Inspect mesh, wall layers, y+, residuals and forces before trusting
results. Reference compares three meshes; this is not experimental validation.
Steady fully turbulent SST does not model transition, transient stall, rotating
propellers, dynamic flight or adjoint optimization. Plane scores are heuristics.

WATER AND GROUND
Water mode is fully submerged, single-phase flow. It excludes hydrostatic
buoyancy, waves, free surfaces and cavitation. Ground/seabed can move with flow
or be a stationary tunnel floor. Clearance is from the lowest rotated point.
Ground and water results do not contribute to the free-flight plane score.

COMPUTE AND CONNECTIONS
CPU parallel solving needs a matching MPI runtime. Optional GPU pressure solving
needs a separately installed WSL/OpenFOAM/PETSc CUDA runtime; it is not bundled.
Momentum, turbulence, meshing and export still use CPU. Speedup is not guaranteed.
Each user connects their own CAD accounts and optional AI API key in the app.
No credentials are bundled. AI review sends the shown numerical evidence when
requested and can incur API charges.
See the manual, RUNTIME.md and THIRD-PARTY-NOTICES.txt for details.
