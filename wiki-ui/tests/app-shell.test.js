import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppShell } from '../components/app-shell.js';

test('AppShell renders three-column workspace chrome', () => {
  const html = renderToStaticMarkup(
    React.createElement(AppShell, {
      selectedWorkspace: 'wiki',
      leftSidebar: React.createElement('div', null, 'left'),
      mainPanel: React.createElement('div', null, 'center'),
      rightPanel: React.createElement('div', null, 'right'),
    })
  );

  assert.match(html, /left/);
  assert.match(html, /center/);
  assert.match(html, /right/);
});
