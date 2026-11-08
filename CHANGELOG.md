# Changelog

## 0.1.2

- Shows the extra status-bar indicator only for view-only, forbidden, or permanently flagged branches.
- Hides the extra indicator on ordinary feature branches, detached HEAD, and unavailable monitoring.
- Keeps the built-in Git indicator visible; branch tracking continues while the extra indicator is hidden.

## 0.1.1

- Uses portable installation examples and a generic private publisher identifier.
- Imports existing saved warnings when upgrading from an earlier publisher identifier.

## 0.1.0

- Adds permanent warnings for observed branch creation, merges and rebases involving configured forbidden branches.
- Inherits warnings when branching from a flagged branch and retains them across renames and editor restarts.
- Adds amber view-only reminders for configured branches, with per-project rules and native theme colors.
- Supports private VSIX installation and one repository per window.
