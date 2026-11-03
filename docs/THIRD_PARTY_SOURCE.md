# Corresponding CAD-library source

The release archive includes `Third-party-source/` next to the application folder.
It contains unmodified upstream source archives for the bundled STEP importer:

| Archive | Upstream revision |
| --- | --- |
| `occt-import-js-0.0.23-source.zip` | [occt-import-js c2148e5](https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2) |
| `OCCT-corresponding-source.zip` | [OCCT d2abb6d](https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5) |

The download URLs and SHA-256 checksums are pinned in
`scripts/third-party-sources.json`. Release creation checks them before packaging.
The wrapper is LGPL-2.1; OCCT is LGPL-2.1 with the OCCT exception. Full license
texts ship in `vendor/licenses` and are tracked under `work/aerodesk/licenses`.

## Rebuild or replace the importer

Extract the wrapper and put the OCCT source at its `occt` submodule location.
Follow the wrapper revision's README and build scripts, including its Emscripten
setup and CMake build instructions. Its Windows scripts include
`tools/setup_emscripten_win.bat` and `tools/build_wasm_win_release.bat`.
Use compatible build tools as documented by that upstream revision.

The JavaScript loader is renamed from `occt-import-js.js` to
`occt-import-js.cjs`; no upstream library logic is changed. For a source build,
replace the importer's files in `node_modules/occt-import-js/dist` and rebuild
SkyLabs, or adjust `build.cjs` to copy your modified library output.

In the portable app, the loader and WASM are outside the ASAR archive under
`SkyLabs-win32-x64/resources/app.asar.unpacked/vendor/`. Replace
`occt-import-js.cjs` and `occt-import-js.wasm` there with compatible modified
versions, preserving the filenames and API. Reverse engineering needed to debug
modifications to these libraries is permitted. Keep notices and corresponding
source with redistributed copies.

Other dependencies and separately installed solver components have their own
licenses; see `THIRD-PARTY-NOTICES.txt` in the app source. Electron/Chromium license
files are included beside the executable. OpenFOAM and the optional GPU runtime
are not part of this Windows ZIP.
