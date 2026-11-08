'use strict';

/** Pure presentation model; the VS Code adapter supplies ThemeColor and MarkdownString. */
function present(status) {
  const branch = status.branch || 'Detached HEAD';
  const footer = '\n\nVisual warning only. Git actions remain available.';
  if (status.kind === 'viewOnly') return {
    visible: true,
    text: `$(eye) $(git-branch) ${branch}`, background: 'statusBarItem.warningBackground',
    label: `${branch}: view-only branch. No coding, commits or merges.`,
    tooltip: `**View-only branch**\n\n\`${branch}\` is for viewing only.\n\nAvoid coding, commits and merges on this branch.${footer}`,
  };
  if (status.kind === 'flagged') return {
    visible: true,
    text: `$(warning) $(git-branch) ${branch}`, background: 'statusBarItem.errorBackground',
    label: `${branch}: permanently flagged. ${status.reason}. Source: ${status.source}.`,
    tooltip: `**Branch warning**\n\n${status.reason}: \`${status.source}\`.\n\nThis branch stays flagged permanently.\n\nSwitch to a correctly based branch.${footer}`,
  };
  if (status.kind === 'forbidden') return {
    visible: true,
    text: `$(warning) $(git-branch) ${branch}`, background: 'statusBarItem.errorBackground',
    label: `${branch}: forbidden base branch. Do not create feature branches from here.`,
    tooltip: `**Forbidden base branch**\n\nDo not create feature branches from \`${branch}\`.${footer}`,
  };
  if (status.kind === 'detached') return {
    visible: false,
    text: '$(git-branch) Detached HEAD', label: 'Detached HEAD: no current branch.',
    tooltip: '**Detached HEAD**\n\nNo current branch. A rebase may be in progress.',
  };
  return {
    visible: false,
    text: `$(git-branch) ${branch}`, label: `${branch}: no recorded branch warning.`,
    tooltip: `**Branch Warning**\n\nNo recorded warning for \`${branch}\`.\n\nOnly activity observed while monitoring is active is tracked. Existing history is not scanned.`,
  };
}

module.exports = { present };
