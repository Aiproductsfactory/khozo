import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function user(role) {
  return {
    id: `render_${role}`,
    name: `Render ${role}`,
    email: `${role}@render.test`,
    role,
    org: 'Render smoke',
    jurisdiction: { state: 'Maharashtra', district: 'Mumbai' },
  };
}

function authValue(role) {
  return {
    user: user(role),
    loading: false,
    login: async () => {},
    startOtp: async () => {},
    register: async () => {},
    changePassword: async () => {},
    logout: () => {},
  };
}

function assertIncludes(html, needle, label) {
  assert(html.includes(needle), `${label}: expected rendered HTML to include ${needle}`);
}

function assertExcludes(html, needle, label) {
  assert(!html.includes(needle), `${label}: expected rendered HTML not to include ${needle}`);
}

const vite = await createServer({
  root: path.join(root, 'web'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { MemoryRouter, Routes, Route } = await vite.ssrLoadModule('/node_modules/react-router-dom/dist/index.js');
  const { AuthTestProvider, RequireRole } = await vite.ssrLoadModule('/src/auth.jsx');
  const DashboardLayout = (await vite.ssrLoadModule('/src/dashboard/DashboardLayout.jsx')).default;
  const FraudQueue = (await vite.ssrLoadModule('/src/dashboard/FraudQueue.jsx')).default;
  const PrivacyReview = (await vite.ssrLoadModule('/src/dashboard/PrivacyReview.jsx')).default;
  const { DASHBOARD_ROUTE_ROLES } = await vite.ssrLoadModule('/src/dashboard/routes.js');

  const render = (role, route, element) => renderToString(
    React.createElement(AuthTestProvider, { value: authValue(role) },
      React.createElement(MemoryRouter, { initialEntries: [route] },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/app', element: React.createElement(DashboardLayout) },
            React.createElement(Route, {
              path: 'fraud',
              element: React.createElement(RequireRole, { roles: DASHBOARD_ROUTE_ROLES.fraud }, element),
            }),
            React.createElement(Route, {
              path: 'privacy',
              element: React.createElement(RequireRole, { roles: DASHBOARD_ROUTE_ROLES.privacy }, element),
            }),
          ),
        ),
      ),
    ),
  );

  const parentFraud = render('parent', '/app/fraud', React.createElement(FraudQueue));
  assertIncludes(parentFraud, 'Access restricted', 'parent fraud route');
  assertExcludes(parentFraud, 'Public abuse queue', 'parent fraud route');

  const adminFraud = render('admin', '/app/fraud', React.createElement(FraudQueue));
  assertIncludes(adminFraud, 'Public abuse queue', 'admin fraud route');
  assertIncludes(adminFraud, 'Export report', 'admin fraud route');
  assertExcludes(adminFraud, 'Access restricted', 'admin fraud route');

  const parentPrivacy = render('parent', '/app/privacy', React.createElement(PrivacyReview));
  assertIncludes(parentPrivacy, 'Access restricted', 'parent privacy route');
  assertExcludes(parentPrivacy, 'Privacy review', 'parent privacy route');

  const adminPrivacy = render('admin', '/app/privacy', React.createElement(PrivacyReview));
  assertIncludes(adminPrivacy, 'Privacy review', 'admin privacy route');
  assertIncludes(adminPrivacy, 'Approval/order reference', 'admin privacy route');
  assertExcludes(adminPrivacy, 'Access restricted', 'admin privacy route');

  console.log('Web render smoke checks passed.');
} finally {
  await vite.close();
}
