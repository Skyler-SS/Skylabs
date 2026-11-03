# Publish SkyLabs

## Push the prepared source

The public source branch is `main`. Local simulation files, output executables,
dependencies, credentials and one-off scripts are ignored. A local `master` branch
may retain the earlier working history; push **only `main`** when sharing this
prepared repository.

Create an empty repository on your Git hosting service, then use its actual URL:

```powershell
git switch main
npm run check:repo
git remote add origin https://github.com/YOUR-ACCOUNT/SkyLabs.git
git push -u origin main
```

Replace `YOUR-ACCOUNT` with your account or organization. If `origin` already
exists, inspect `git remote -v` and update it deliberately. Do not use `--all` or
`--mirror` to publish the local historical branch. Choose visibility on the host.

GitHub Actions checks the source, installs the lockfile, runs tests and builds on
pushes and pull requests to `main`. No account keys or CFD runtime are required.

## Produce a Windows release

Locally, on Windows x64 with Node.js 24:

```powershell
npm run setup
npm test
npm run dist
```

Share the complete `outputs/releases/SkyLabs-0.14.0-win32-x64.zip`, including the
corresponding source inside it. `SHA256SUMS.txt` records the archive checksum.
Internet access is needed for dependencies and the pinned upstream source archives.
OpenFOAM and GPU runtimes are installed separately; include that limitation in
release descriptions. The EXE is unsigned and there is no automatic updater.

## GitHub release workflow

The **Windows release** workflow can be run manually to build a downloadable
Actions artifact without creating a public release. A version tag builds the ZIP
and creates a **draft release** with the ZIP and checksum attached:

```powershell
git tag v0.14.0
git push origin v0.14.0
```

Run these only after pushing and reviewing `main`. The tag must match
`work/aerodesk/package.json`. Review the draft and its attachments on GitHub before
publishing. The workflow uses GitHub's scoped token, not a personal token in source.
Repository/organization policy must allow Actions to write releases.

For the next release, update the application version and lockfile, the root
package version and `docs/RELEASE_NOTES.md`, commit the change, then tag that commit.
Never reuse a published version tag. CI tests do not certify physical accuracy;
record new benchmark evidence separately.

Both packages have `private: true` because this is a desktop application, not an
npm library. Publishing the Git repository and Windows release does not use
`npm publish`.
