import { createBrowserRouter, createMemoryRouter, Navigate } from 'react-router-dom'
import RootLayout, { RouteError } from './RootLayout.jsx'
import RequireAccess from './guards/RequireAccess.jsx'
import ProjectAccess from './guards/ProjectAccess.jsx'
import RoleHome from './guards/RoleHome.jsx'
import AppShell from './shells/AppShell.jsx'
import AuthShell from './shells/AuthShell.jsx'
import FullBleedShell from './shells/FullBleedShell.jsx'
import FounderShell from './shells/FounderShell.jsx'
import NetworkShell from './shells/NetworkShell.jsx'
import PublicShell from './shells/PublicShell.jsx'
import PublicWideShell from './shells/PublicWideShell.jsx'
import PublicLandingShell from './shells/PublicLandingShell.jsx'
import ComingSoon from './pages/ComingSoon.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import { legacyRules } from './legacy/legacyRedirects.js'
import { LegacyRedirect, LegacyModuleRedirect } from './legacy/LegacyRedirect.jsx'
import { routerBasename } from '../lib/env.js'

/** React Router `lazy` helper: `page(() => import('./pages/X.jsx'))` -> chunk per route (named export optional). */
const page = (importer, name = 'default') => ({
  lazy: async () => ({ Component: (await importer())[name] }),
})
/** The two distribution views share one lazy page; the view key is closed over (a static route cannot pass props through `page`). */
const distributionView = (viewKey) => ({
  lazy: async () => {
    const { default: Page } = await import('./pages/DistributionViewPage.jsx')
    return { Component: () => <Page viewKey={viewKey} /> }
  },
})
const soon = (step, what) => ({ element: <ComingSoon step={step} what={what} /> })

/**
 * THE route table (design 06 section 2). Guards are layout routes (one per area), shells are layout routes.
 * Placeholder pages are clearly marked "coming in step N" (numbers follow design 06 section 14).
 */
export const routes = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <div className="min-h-dvh" aria-busy="true" />,
    children: [
      { index: true, element: <RoleHome /> },

      // 2.1 auth and utility
      {
        element: <AuthShell />,
        children: [
          { path: 'login', ...page(() => import('./pages/LoginPage.jsx')) },
          { path: 'signup', ...soon(8, 'open founder sign-up') },
          { path: 'invite/staff/:token', ...page(() => import('./pages/StaffInvitePage.jsx')) },
          { path: 'invite/:token', ...soon(8, 'invitation accept') },
          { path: 'forgot-password', ...soon('2b', 'password recovery') },
          { path: 'reset-password', ...soon('2b', 'password reset') },
        ],
      },
      { path: 'no-access', ...page(() => import('./pages/NoAccessPage.jsx')) },
      {
        element: <RequireAccess />, // any signed-in user with at least one role
        children: [{ element: <PublicShell />, children: [{ path: 'profile', ...page(() => import('./pages/ProfilePage.jsx')) }] }],
      },

      // 2.2 staff app (PM / super_admin)
      {
        element: <RequireAccess area="staff" />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: 'programs', ...page(() => import('./pages/ProgramsPage.jsx')) },
              { path: 'programs/:programId', ...page(() => import('./pages/ProgramPage.jsx')) },
              { path: 'programs/:programId/settings', ...page(() => import('./pages/ProgramSettingsPage.jsx')) },
              { path: 'network/experts', ...soon(7, 'Athar Network: experts registry') },
              { path: 'network/companies', ...soon(7, 'companies registry') },
              { path: 'network/companies/:companyId', ...soon(7, 'company record (registry)') },
              { path: 'library', ...soon(7, 'central resource library') },
              { element: <RequireAccess permission="form-library:manage" />, children: [{ path: 'form-library', ...soon(7, 'central form library') }] },
              // 08 section 14: staff management (super_admin). `/team` from the design table redirects here.
              { element: <RequireAccess permission="staff:manage" />, children: [{ path: 'admin/staff', ...page(() => import('./pages/staff/StaffPage.jsx')) }] },
              { path: 'team', element: <Navigate to="/admin/staff" replace /> },
              ...(import.meta.env.DEV ? [{ path: 'dev/nodes', ...page(() => import('./pages/DevNodesPage.jsx')) }] : []),
            ],
          },
          // 2.3 project canvas and nodes
          {
            path: 'projects/:projectId',
            element: <ProjectAccess />,
            children: [
              {
                element: <FullBleedShell />,
                children: [
                  { index: true, ...page(() => import('./pages/ProjectPage.jsx')) },
                  { path: 'details', ...page(() => import('./pages/ProjectDetailsPage.jsx')) },
                  { path: 'participants', ...page(() => import('./pages/ParticipantsPage.jsx')) },
                  { path: 'nodes/:nodeId', ...page(() => import('./pages/NodeRoutes.jsx'), 'NodeViewPage') },
                  { path: 'nodes/:nodeId/edit/*', ...page(() => import('./pages/NodeRoutes.jsx'), 'NodeEditPage') },
                  { path: 'nodes/:nodeId/settings', ...page(() => import('./pages/NodeRoutes.jsx'), 'NodeSettingsPage') },
                ],
              },
            ],
          },
        ],
      },

      // 2.4 public content
      {
        element: <PublicShell />,
        children: [
          { path: 'agenda/:ref/:tab?', ...page(() => import('./pages/AgendaPage.jsx')) },
          { path: 'forms/:ref', ...page(() => import('./pages/PublicFormPage.jsx')) },
          // the interview invitation link is /book/:ref?invite=<token> (no host): the host segment is optional
          { path: 'book/:nodeRef/:hostRef?', ...page(() => import('./pages/PublicBookingPage.jsx')) },
          { path: 'view/:nodeRef/:viewKey', ...page(() => import('./pages/NodeViewPage.jsx')) },
          { path: 'verify/:code?', ...page(() => import('./pages/VerifyCertificatePage.jsx')) },
        ],
      },

      // 2.4b the two public surfaces of a Mentoring Distribution node (wide container; static segments outrank /view/:nodeRef/:viewKey)
      {
        element: <PublicWideShell />,
        children: [
          { path: 'view/:nodeRef/matrix', ...distributionView('matrix') },
          { path: 'view/:nodeRef/live', ...distributionView('live') },
        ],
      },

      // 2.4c the landing page on its own link (full-width shell; `join/:ref` = a link of kind `landing`)
      {
        element: <PublicLandingShell />,
        children: [
          { path: 'view/:nodeRef/landing', ...page(() => import('./pages/PublicLandingPage.jsx')) },
          { path: 'join/:nodeRef', ...page(() => import('./pages/PublicLandingPage.jsx')) },
        ],
      },

      // 2.5 founder platform
      {
        element: <RequireAccess area="founder" />,
        children: [
          {
            element: <FounderShell />,
            children: [
              { path: 'alumni/founder', element: <Navigate to="dashboard" replace /> },
              // step 8: the lean Home + Programs + the Program page; the old app's dashboard (company progress, opportunities) is step 10
              { path: 'alumni/founder/dashboard', ...page(() => import('./pages/founder/FounderHomePage.jsx')) },
              { path: 'alumni/founder/programs', ...page(() => import('./pages/founder/FounderProgramsPage.jsx')) },
              { path: 'alumni/founder/programs/:projectId', ...page(() => import('./pages/founder/FounderProgramPage.jsx')) },
              { path: 'alumni/founder/programs/:projectId/agenda/:tab?', ...page(() => import('./pages/founder/FounderAgendaPage.jsx')) },
              // the old placeholder of 06 section 2.5: the Library is a block of the Program page (its button opens the library page)
              { path: 'alumni/founder/programs/:projectId/library', ...page(() => import('./pages/founder/FounderProgramRedirect.jsx')) },
              { path: 'alumni/founder/opportunities', ...soon(10, 'opportunities') },
              { path: 'alumni/founder/notifications', ...soon(10, 'notifications') },
              { path: 'alumni/founder/profile', ...soon(10, 'founder profile') },
              { path: 'alumni/founder/progress', ...soon(10, 'progress') },
              { path: 'alumni/founder/company/:id', ...soon(10, 'company profile') },
            ],
          },
        ],
      },

      // 2.6 alumni manager / network
      {
        element: <RequireAccess area="network" />,
        children: [
          {
            element: <NetworkShell />,
            children: [
              { path: 'alumni/admin', element: <Navigate to="dashboard" replace /> },
              ...['dashboard', 'invitations', 'notifications', 'analytics', 'opportunities', 'impact', 'workspace', 'directory', 'company/:id'].map((p) => ({
                path: `alumni/admin/${p}`,
                ...soon(10, `alumni admin: ${p}`),
              })),
            ],
          },
        ],
      },

      // 2.7 legacy redirects (generated from the one table in app/legacy)
      ...legacyRules.map((rule) => ({
        path: rule.pattern.slice(1),
        element: rule.to ? <LegacyRedirect to={rule.to} /> : <LegacyModuleRedirect module={rule.module} moduleParam={rule.moduleParam} />,
      })),

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const createAppRouter = (basename = routerBasename(import.meta.env.BASE_URL)) => createBrowserRouter(routes, { basename })
export const createTestRouter = (initialEntries) => createMemoryRouter(routes, { initialEntries })
