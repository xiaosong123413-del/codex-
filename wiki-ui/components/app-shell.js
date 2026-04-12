import React from 'react';

export function AppShell({ selectedWorkspace, leftSidebar, mainPanel, rightPanel }) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'grid',
        gridTemplateColumns: '280px 1fr 360px',
        minHeight: '100vh',
        background: '#f8f9fa',
        color: '#202122',
      },
    },
    React.createElement(
      'aside',
      {
        'aria-label': 'left-sidebar',
        style: { borderRight: '1px solid #a2a9b1', background: '#fff', padding: '16px' },
      },
      leftSidebar
    ),
    React.createElement(
      'main',
      {
        'aria-label': `workspace-${selectedWorkspace}`,
        style: { minWidth: 0, padding: '16px' },
      },
      mainPanel
    ),
    React.createElement(
      'section',
      {
        'aria-label': 'right-panel',
        style: { borderLeft: '1px solid #a2a9b1', background: '#fff', padding: '16px' },
      },
      rightPanel
    )
  );
}
