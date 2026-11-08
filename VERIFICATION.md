# Verification

- `npm run check`: passed for all five runtime JavaScript files.
- `npm test`: 34 passed, 0 failed, using real temporary Git repositories and durable storage files.
- `npm run test:host`: passed inside VS Code 1.144.0, using an isolated profile on Xvfb.
- Actual VS Code checks: activation, native amber/red status-bar rendering, the extra indicator hidden on normal branches and detached HEAD, warning permanence after reset, child inheritance, disabled-activity exclusion, command registration, saved warnings across a full process restart, and exclusion of closed-editor activity.
- Screenshots were visually inspected. On ordinary feature branches only the built-in Git indicator is visible; a colored extra indicator appears beside it for matching warning conditions. Keep the built-in Git indicator enabled.
- The private VSIX was packaged with the official `@vscode/vsce` tool. Its runtime files were compared with the tested source. There are no runtime third-party dependencies.
- Tests used temporary repositories and an isolated editor profile. The extension has not been installed into the normal VS Code profile.

See `verification/result.json` and the three captured PNGs for the real extension-host evidence. `mockup.png` is the original visual target for the warning colors; version 0.1.2 replaces its normal-state indicator with conditional visibility.

Detection is based on observed standard Git reflogs. Hash-only, no-op, ambiguous or unlogged actions may not be detected; see the README for the exact supported scope.

## Portable installation update

- Installation commands use a relative VSIX filename.
- The private publisher identifier is generic.
- Project text files and every unpacked VSIX entry were checked for personal usernames and home-directory paths.
- Upgrade coverage verifies that saved warnings are imported without changing the previous profile records.

## Conditional visibility update (0.1.2)

- The extra indicator appears only for view-only, forbidden and permanently flagged branches.
- Normal branches, detached HEAD, disabled monitoring and unavailable monitoring keep it hidden.
- Tracking continues while the extra indicator is hidden.
- The original Git branch indicator should remain enabled.
