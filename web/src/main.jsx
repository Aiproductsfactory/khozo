import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import './index.css';
import { AuthProvider, RequireAuth, RequireRole } from './auth.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Capture from './pages/Capture.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Bulletins from './pages/Bulletins.jsx';
import Services from './pages/Services.jsx';
import TrackSighting from './pages/TrackSighting.jsx';
import TrackCase from './pages/TrackCase.jsx';
import Grievance from './pages/Grievance.jsx';

import DashboardLayout from './dashboard/DashboardLayout.jsx';
import Overview from './dashboard/Overview.jsx';
import Cases from './dashboard/Cases.jsx';
import RegisterChild from './dashboard/RegisterChild.jsx';
import FoundReports from './dashboard/FoundReports.jsx';
import Network from './dashboard/Network.jsx';
import AuditLog from './dashboard/AuditLog.jsx';
import FraudQueue from './dashboard/FraudQueue.jsx';
import PrivacyReview from './dashboard/PrivacyReview.jsx';
import MisReport from './dashboard/MisReport.jsx';
import Grievances from './dashboard/Grievances.jsx';
import CciRegister from './dashboard/CciRegister.jsx';
import { DASHBOARD_ROUTE_ROLES } from './dashboard/routes.js';

const gated = (route, element) => (
  <RequireRole roles={DASHBOARD_ROUTE_ROLES[route]}>
    {element}
  </RequireRole>
);

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/login', element: <Login /> },
  { path: '/change-password', element: <ChangePassword /> },
  { path: '/register', element: <Register /> },
  { path: '/report', element: <Capture /> },
  { path: '/bulletins', element: <Bulletins /> },
  { path: '/services', element: <Services /> },
  { path: '/track-sighting', element: <TrackSighting /> },
  { path: '/track-case', element: <TrackCase /> },
  { path: '/grievance', element: <Grievance /> },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <DashboardLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Overview /> },
      { path: 'cases', element: gated('cases', <Cases />) },
      { path: 'register', element: gated('register', <RegisterChild />) },
      { path: 'matches', element: gated('matches', <FoundReports />) },
      { path: 'cci-register', element: gated('cci-register', <CciRegister />) },
      { path: 'privacy', element: gated('privacy', <PrivacyReview />) },
      { path: 'audit', element: gated('audit', <AuditLog />) },
      { path: 'fraud', element: gated('fraud', <FraudQueue />) },
      { path: 'mis', element: gated('mis', <MisReport />) },
      { path: 'grievances', element: gated('grievances', <Grievances />) },
      { path: 'network', element: gated('network', <Network />) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
