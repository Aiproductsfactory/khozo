import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom';
import './index.css';
import { AuthProvider, RequireAuth, RequireRole } from './auth.jsx';
import { LanguageProvider, languageReady } from './i18n.jsx';
import { CrashNotice, ErrorBoundary, PageLoading } from './components.jsx';
import { DASHBOARD_ROUTE_ROLES } from './dashboard/routes.js';
import { registerServiceWorker } from './pwa.js';

/*
 * Every page is its own download. A citizen opening /report on a slow phone
 * fetches the sighting form and nothing else: not the officer console, not the
 * charts library, not the bulk importer.
 *
 * A tab left open across a deploy asks for chunk names the server no longer
 * has. That is answered by reloading once, which picks up the new build,
 * rather than by a blank section.
 */
const RELOAD_KEY = 'khozo.chunkReload';
function page(load) {
  return lazy(() =>
    load()
      .then((module) => {
        try { sessionStorage.removeItem(RELOAD_KEY); } catch {}
        return module;
      })
      .catch((err) => {
        let already = true;
        try {
          already = sessionStorage.getItem(RELOAD_KEY) === '1';
          if (!already) sessionStorage.setItem(RELOAD_KEY, '1');
        } catch {}
        if (!already && navigator.onLine !== false) {
          window.location.reload();
          return new Promise(() => {});
        }
        throw err;
      })
  );
}

const Landing = page(() => import('./pages/Landing.jsx'));
const Login = page(() => import('./pages/Login.jsx'));
const Register = page(() => import('./pages/Register.jsx'));
const Capture = page(() => import('./pages/Capture.jsx'));
const ChangePassword = page(() => import('./pages/ChangePassword.jsx'));
const Bulletins = page(() => import('./pages/Bulletins.jsx'));
const ChildCase = page(() => import('./pages/ChildCase.jsx'));
const Services = page(() => import('./pages/Services.jsx'));
const TrackSighting = page(() => import('./pages/TrackSighting.jsx'));
const TrackCase = page(() => import('./pages/TrackCase.jsx'));
const Grievance = page(() => import('./pages/Grievance.jsx'));

const DashboardLayout = page(() => import('./dashboard/DashboardLayout.jsx'));
const Overview = page(() => import('./dashboard/Overview.jsx'));
const Cases = page(() => import('./dashboard/Cases.jsx'));
const RegisterChild = page(() => import('./dashboard/RegisterChild.jsx'));
const BulkImport = page(() => import('./dashboard/BulkImport.jsx'));
const FoundReports = page(() => import('./dashboard/FoundReports.jsx'));
const Network = page(() => import('./dashboard/Network.jsx'));
const AuditLog = page(() => import('./dashboard/AuditLog.jsx'));
const FraudQueue = page(() => import('./dashboard/FraudQueue.jsx'));
const PrivacyReview = page(() => import('./dashboard/PrivacyReview.jsx'));
const MisReport = page(() => import('./dashboard/MisReport.jsx'));
const Grievances = page(() => import('./dashboard/Grievances.jsx'));
const CciRegister = page(() => import('./dashboard/CciRegister.jsx'));
const SimulationResults = page(() => import('./dashboard/SimulationResults.jsx'));

const gated = (route, element) => (
  <RequireRole roles={DASHBOARD_ROUTE_ROLES[route]}>
    {element}
  </RequireRole>
);

/*
 * Every page renders inside one crash guard, so a malformed record on a public
 * page shows a notice with a Reload button instead of a blank screen. It
 * resets on navigation: leaving the page that failed brings the app back. The
 * console has its own guard around its content (DashboardLayout), which keeps
 * the sidebar and header on screen when one section fails.
 */
function GuardedRoot() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary page resetKey={pathname}>
      <Suspense fallback={<PageLoading page />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );
}

const router = createBrowserRouter([
  {
    element: <GuardedRoot />,
    // Only reached if the guard itself cannot render.
    errorElement: <CrashNotice page />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/login', element: <Login /> },
      { path: '/change-password', element: <ChangePassword /> },
      { path: '/register', element: <Register /> },
      { path: '/report', element: <Capture /> },
      { path: '/bulletins', element: <Bulletins /> },
      // The shareable unit of this product. Kept short and human because it is
      // typed, pasted and read aloud far more often than it is clicked.
      { path: '/child/:id', element: <ChildCase /> },
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
          { path: 'bulk-import', element: gated('bulk-import', <BulkImport />) },
          { path: 'matches', element: gated('matches', <FoundReports view="matches" />) },
          { path: 'sightings', element: gated('sightings', <FoundReports view="sightings" />) },
          { path: 'cci-register', element: gated('cci-register', <CciRegister />) },
          { path: 'privacy', element: gated('privacy', <PrivacyReview />) },
          { path: 'audit', element: gated('audit', <AuditLog />) },
          { path: 'fraud', element: gated('fraud', <FraudQueue />) },
          { path: 'mis', element: gated('mis', <MisReport />) },
          { path: 'grievances', element: gated('grievances', <Grievances />) },
          { path: 'network', element: gated('network', <Network />) },
          { path: 'simulations', element: <RequireRole roles={['super_admin', 'admin']}><SimulationResults /></RequireRole> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

// The first paint waits for the reader's dictionary (English needs none), so a
// Gujarati reader never sees the page flash in English first.
languageReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <LanguageProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </LanguageProvider>
    </React.StrictMode>
  );
});

registerServiceWorker();
