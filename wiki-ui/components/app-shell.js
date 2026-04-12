import React from 'react';

export function AppShell({ selectedWorkspace, leftSidebar, mainPanel, rightPanel }) {
  return React.createElement(
    'div',
    { className: 'workspace-shell' },
    React.createElement(
      'aside',
      {
        'aria-label': 'left-sidebar',
        className: 'workspace-sidebar',
      },
      leftSidebar
    ),
    React.createElement(
      'main',
      {
        'aria-label': `workspace-${selectedWorkspace}`,
        className: 'workspace-main',
      },
      mainPanel
    ),
    React.createElement(
      'section',
      {
        'aria-label': 'right-panel',
        className: 'workspace-context',
      },
      rightPanel
    )
  );
}
