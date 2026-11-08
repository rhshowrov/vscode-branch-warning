# Branch Warning

A private VS Code extension that warns you about forbidden branch ancestry and view-only branches in the bottom-left status bar.

## Default behavior

| Current branch or observed activity | Indicator |
| --- | --- |
| Ordinary feature branch | Extra indicator hidden; built-in Git indicator remains |
| `dev` or `main` | Amber view-only reminder |
| `staging` itself | Red forbidden-base reminder |
| New branch created from `staging` | Permanently red |
| Feature branch merges `staging` | Permanently red after the merge completes |
| Feature branch rebases onto `staging` | Permanently red after the rebase completes |
| New branch created from a permanently red branch | Inherits the permanent warning |
| Cherry-pick from `staging` | No new warning |

The extra indicator appears only for a forbidden branch, a permanently flagged branch, or a view-only branch. It stays hidden for ordinary feature branches, detached HEAD, and unavailable monitoring. Keep the built-in Git indicator enabled so the branch name is always visible.

Hover over a warning indicator to see the reason. Click it to open the normal Git branch selector. These are visual reminders: commits, merges and other Git actions remain available.

Warnings survive branch switches, resetting/rebasing the branch, renaming it, and restarting VS Code. They are stored locally in this VS Code profile, keyed by repository. They do not sync to teammates or modify Git history. Deleting a branch removes its saved warning when deletion is observed. There is deliberately no command to clear a warning on an existing branch.

## Install privately

1. Open VS Code Extensions (`Ctrl+Shift+X`).
2. Open the `…` menu and choose **Install from VSIX…**.
3. Select `branch-warning-0.1.2.vsix` from this project.
4. Reload VS Code if prompted and open one trusted local Git repository.
5. Keep the built-in Git branch/Source Control entry and **Branch Warning** enabled in the status bar menu. If you previously hid the built-in entry, right-click the status bar and re-enable it. The extra colored indicator will appear beside it only when a warning condition matches.

Alternatively, open a terminal in the folder containing the VSIX file and run:

```sh
code --install-extension ./branch-warning-0.1.2.vsix
```

If you installed an earlier build, install this build first and open each repository that has saved warnings so they are imported into the same VS Code profile. Then uninstall the earlier build to avoid duplicate indicators. The publisher identifier is now generic.

Nothing is published to the Marketplace. The extension does not change your editor settings automatically.

## Configure each project

Use **Branch Warning: Open Project Settings** from the Command Palette. Or add these settings to the project's `.vscode/settings.json`:

```json
{
  "branchWarning.enabled": true,
  "branchWarning.forbiddenBranches": ["staging"],
  "branchWarning.viewOnlyBranches": ["dev", "main"],
  "branchWarning.pollIntervalMs": 1000
}
```

Names are exact and case-sensitive. Wildcards are not supported. Named remote refs, such as `origin/staging`, are recognized using the repository's configured remotes. View-only styling takes precedence if a branch appears in both lists or has a saved warning. Changing the forbidden list does not clear existing permanent warnings.

### Colors

The warning fills use VS Code's native error and warning status-bar colors. To match the red/amber colors in the dark-theme mockup, or choose your own colors per project, set:

```json
{
  "workbench.colorCustomizations": {
    "statusBarItem.errorBackground": "#A12632",
    "statusBarItem.errorForeground": "#FFFFFF",
    "statusBarItem.warningBackground": "#895503",
    "statusBarItem.warningForeground": "#FFFFFF"
  }
}
```

VS Code only permits its error/warning theme tokens as item backgrounds. These optional customizations also affect other status-bar items using those same tokens; they do not recolor the whole bar. The extension itself does not write or replace your theme settings. See the [StatusBarItem API](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem).

## Tracking scope and limits

- Version 0.1 supports one repository per window. Multi-root workspaces and monitoring multiple worktrees at once are outside this version's scope.
- Only activity observed while the extension is active is tracked. On first activation and each editor restart, current Git logs become the baseline. Existing branch history and operations performed while closed or disabled are not replayed. Previously saved red warnings remain.
- The monitor reads bounded, cached tails of local branch and HEAD reflogs. It uses read-only Git commands. It does not install hooks, wrap Git, run network operations, modify repository files, or block actions.
- Git records reference changes, not a guaranteed named-parent property. Normal `git switch -c`, `git checkout -b`, `git branch`, named merges and named rebases are supported. Git apps must write standard local reflogs. Repositories with disabled/unsupported reflogs, hash-only operations, overwritten reflogs or custom reflog messages may not provide enough evidence. Uncertain origins are left unmarked rather than guessed.
- A non-checkout `git branch new-name` using implicit `HEAD` is detected when the current branch has remained stable during that check interval. If several checkouts occur around that command between polls and no checkout of the new branch identifies its parent, the origin can be ambiguous.
- No-op merges/rebases that leave no reflog entry cannot be detected. Aborted merges/rebases do not create a new permanent warning.
- Conflicted merges with custom final messages are tracked if the in-progress merge is observed. If the entire conflict/resolution happens between checks and all source-name evidence is removed, detection may be incomplete.
- Absence of the extra indicator means **no active recorded warning**, not a certification that the branch has never touched staging. Monitoring errors are available through the activity log.

Use **Branch Warning: Show Activity Log** to inspect monitoring errors. **Branch Warning: Refresh Indicator** checks immediately.

## Develop and verify

Requires Node.js 20+ for development; runtime has no third-party dependencies.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run package
```

`npm test` uses real temporary Git repositories to exercise provenance, inheritance, merges, rebases, restarts, configurable rules, renames, cherry-picks and aborts.

On Linux with an installed VS Code, Xvfb and ImageMagick:

```sh
npm run test:host
```

The host test launches a separate VS Code profile, runs the actual extension and captures its three indicator states. It does not install the extension into your normal profile. Set `VSCODE_EXECUTABLE` if VS Code is installed elsewhere. Test artifacts are written to a temporary directory printed by the command.

Open this project and press **F5** to launch an Extension Development Host for manual testing.
