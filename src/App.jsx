import { lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, useParams, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import RoleGuard from './components/RoleGuard';

// ─── Lazy Loaded Components ─────────────────────────────────────────────────
const Dashboard = lazy(() => import('./components/Dashboard'));
const AgendaViewer = lazy(() => import('./components/AgendaViewer'));
const EventBuilder = lazy(() => import('./components/EventBuilder'));
const CompaniesPage = lazy(() => import('./components/CompaniesPage'));
const EventDashboard = lazy(() => import('./components/EventDashboard'));
const ExpertManager = lazy(() => import('./components/ExpertManager'));
const StartupManager = lazy(() => import('./components/StartupManager'));
const StartupViewer = lazy(() => import('./components/StartupViewer'));
const ExpertViewer = lazy(() => import('./components/ExpertViewer'));
const CompanyPortal = lazy(() => import('./components/CompanyPortal'));
const ExpertPortal = lazy(() => import('./components/ExpertPortal'));
const FormEditor = lazy(() => import('./components/FormEditor'));
const LoginPage = lazy(() => import('./components/LoginPage'));
const EventVisualManager = lazy(() => import('./components/EventVisualManager'));
const SelectionProcessManager = lazy(() => import('./components/SelectionProcessManager'));
const GenericFormPortal = lazy(() => import('./components/GenericFormPortal'));
const MarketingAnalytics = lazy(() => import('./components/MarketingAnalytics'));
const MasterExpertsList = lazy(() => import('./components/MasterExpertsList'));
const ListsManager = lazy(() => import('./components/ListsManager'));
const LibraryManager = lazy(() => import('./components/LibraryManager'));
const LibraryViewer = lazy(() => import('./components/LibraryViewer'));
const MentorBookingAdmin = lazy(() => import('./components/MentorBookingAdmin'));
const MentorBookingPage = lazy(() => import('./components/MentorBookingPage'));
const MentorDetails = lazy(() => import('./components/MentorDetails'));
const AtherTeamBookingAdmin = lazy(() => import('./components/AtherTeamBookingAdmin'));
const AtherTeamBookingPage = lazy(() => import('./components/AtherTeamBookingPage'));
const MentoringDistributionAdmin = lazy(() => import('./components/MentoringDistributionAdmin'));
const MentoringLiveView = lazy(() => import('./components/MentoringLiveView'));
const MentoringMatrixView = lazy(() => import('./components/MentoringMatrixView'));
const FormLibraryManager = lazy(() => import('./components/FormLibraryManager'));
const JoinAtharDashboard = lazy(() => import('./components/JoinAtharDashboard'));
const JoinAtharView = lazy(() => import('./components/JoinAtharView'));
const AlumniDirectory = lazy(() => import('./components/alumni/AlumniDirectory'));
const CompanyProfilePage = lazy(() => import('./components/alumni/CompanyProfilePage'));
const FounderDashboard = lazy(() => import('./components/alumni/FounderDashboard'));
const OpportunitiesHub = lazy(() => import('./components/alumni/OpportunitiesHub'));
const ImpactDashboard = lazy(() => import('./components/alumni/ImpactDashboard'));
const MEWorkspace = lazy(() => import('./components/alumni/MEWorkspace'));
const CertificateVerifier = lazy(() => import('./components/alumni/CertificateVerifier'));
const AlumniLoginPage = lazy(() => import('./components/alumni/AlumniLoginPage'));
const AlumniSignupPage = lazy(() => import('./components/alumni/AlumniSignupPage'));
const AlumniRouteGuard = lazy(() => import('./components/alumni/AlumniRouteGuard'));
const FounderProfilePage = lazy(() => import('./components/alumni/FounderProfilePage'));
const UserProfile = lazy(() => import('./components/UserProfile'));
const FounderLayout = lazy(() => import('./components/alumni/FounderLayout'));
const FounderProgramsPage = lazy(() => import('./components/alumni/FounderProgramsPage'));
const FounderOpportunitiesPage = lazy(() => import('./components/alumni/FounderOpportunitiesPage'));
const FounderNotificationsPage = lazy(() => import('./components/alumni/FounderNotificationsPage'));
const AlumniManagerLayout = lazy(() => import('./components/alumni/AlumniManagerLayout'));
const AlumniManagerDashboard = lazy(() => import('./components/alumni/AlumniManagerDashboard'));
const AlumniInvitationsPage = lazy(() => import('./components/alumni/AlumniInvitationsPage'));
const AlumniNotificationsPage = lazy(() => import('./components/alumni/AlumniNotificationsPage'));
const AlumniAnalyticsPage = lazy(() => import('./components/alumni/AlumniAnalyticsPage'));
const FounderProgressPage = lazy(() => import('./components/alumni/FounderProgressPage'));

// ─── Prefetch helpers (call on hover to warm up JS chunks) ──────────────────
// Each function triggers a dynamic import which caches the chunk immediately.
export const prefetch = {
  dashboard: () => import('./components/Dashboard'),
  eventDashboard: () => import('./components/EventDashboard'),
  agenda: () => import('./components/EventBuilder'),
  experts: () => import('./components/ExpertManager'),
  startups: () => import('./components/StartupManager'),
  forms: () => import('./components/FormEditor'),
  visuals: () => import('./components/EventVisualManager'),
  selection: () => import('./components/SelectionProcessManager'),
  analytics: () => import('./components/MarketingAnalytics'),
  masterExperts: () => import('./components/MasterExpertsList'),
  lists: () => import('./components/ListsManager'),
  library: () => import('./components/LibraryManager'),
  joinAthar: () => import('./components/JoinAtharDashboard'),
  alumni: () => import('./components/alumni/AlumniDirectory'),
};

import PublicLayout from './components/PublicLayout';
import { AuthProvider } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';

// Modern Loading Fallback
const LoadingFallback = () => (
  <div className="min-h-screen bg-gray-200 flex flex-col items-center justify-center p-6 font-manrope">
    <div className="relative">
      <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
      <Loader2 className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-600 animate-pulse" size={24} />
    </div>
    <div className="mt-6 text-center">
      <p className="text-lg font-black text-slate-800 tracking-tight">Loading Portal</p>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mt-1">Please wait a moment</p>
    </div>
  </div>
);

// Global URL parameter interception for social sharing links (replaces # with ?)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('agenda')) {
  const eventId = urlParams.get('agenda');
  const hashParams = new URLSearchParams();
  for (const [key, value] of urlParams.entries()) {
    if (key !== 'agenda') {
      hashParams.append(key, value);
    }
  }
  // Default to Arabic if no lang specified
  if (!hashParams.has('lang')) {
    hashParams.append('lang', 'ar');
  }
  
  // Replace the URL to use Hash Router to load the app State properly
  window.history.replaceState(null, '', window.location.pathname + `#/agenda/${eventId}?${hashParams.toString()}`);
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* User Profile – available to all authenticated users */}
            <Route path="/profile" element={
              <RoleGuard>
                <UserProfile />
              </RoleGuard>
            } />

            {/* Main Dashboard – blocked for alumni_manager & founder (redirected by RoleGuard) */}
            <Route path="/" element={
              <RoleGuard>
                <Dashboard />
              </RoleGuard>
            } />

            <Route path="/companies" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <CompaniesPage />
              </RoleGuard>
            } />

            <Route path="/experts" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <MasterExpertsList />
              </RoleGuard>
            } />

            <Route path="/library" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <LibraryManager />
              </RoleGuard>
            } />

            {/* Event Hub */}
            <Route path="/event/:eventId" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <EventDashboard />
              </RoleGuard>
            } />
            <Route path="/events/:eventId" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <EventDashboard />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/forms" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <FormEditor />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/forms" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <FormEditor />
              </RoleGuard>
            } />

            {/* Form Library – super_admin only */}
            <Route path="/form-library" element={
              <RoleGuard allowedRoles={['super_admin']}>
                <FormLibraryManager />
              </RoleGuard>
            } />
            <Route path="/forms-library" element={
              <RoleGuard allowedRoles={['super_admin']}>
                <FormLibraryManager />
              </RoleGuard>
            } />

            {/* Alumni Auth & Public Routes */}
            <Route path="/alumni/login" element={<AlumniLoginPage />} />
            <Route path="/alumni/signin" element={<AlumniLoginPage />} />
            <Route path="/alumni/signup" element={<AlumniSignupPage />} />
            <Route path="/verify-certificate/:code" element={<CertificateVerifier />} />

            {/* Root /alumni redirect based on role */}
            <Route path="/alumni" element={<AlumniRouteGuard><div /></AlumniRouteGuard>} />

            {/* ── Alumni Admin Portal Routes (/alumni/admin/*) ── */}
            <Route path="/alumni/admin" element={<Navigate to="/alumni/admin/dashboard" replace />} />
            <Route path="/alumni/admin/dashboard" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <AlumniManagerDashboard />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/invitations" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <AlumniInvitationsPage />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/notifications" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <AlumniNotificationsPage />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/analytics" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <AlumniAnalyticsPage />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/opportunities" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <OpportunitiesHub />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/impact" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <ImpactDashboard />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/workspace" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <MEWorkspace />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/directory" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <AlumniDirectory />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/admin/company/:id" element={
              <AlumniRouteGuard requireAdmin={true}>
                <AlumniManagerLayout>
                  <CompanyProfilePage />
                </AlumniManagerLayout>
              </AlumniRouteGuard>
            } />

            {/* ── Founder Portal Routes (/alumni/founder/*) ── */}
            <Route path="/alumni/founder" element={<Navigate to="/alumni/founder/dashboard" replace />} />
            <Route path="/alumni/founder/dashboard" element={
              <AlumniRouteGuard>
                <FounderLayout>
                  <FounderDashboard />
                </FounderLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/founder/programs" element={
              <AlumniRouteGuard>
                <FounderLayout>
                  <FounderProgramsPage />
                </FounderLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/founder/opportunities" element={
              <AlumniRouteGuard>
                <FounderLayout>
                  <FounderOpportunitiesPage />
                </FounderLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/founder/notifications" element={
              <AlumniRouteGuard>
                <FounderLayout>
                  <FounderNotificationsPage />
                </FounderLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/founder/profile" element={
              <AlumniRouteGuard>
                <FounderLayout>
                  <FounderProfilePage />
                </FounderLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/founder/progress" element={
              <AlumniRouteGuard>
                <FounderLayout>
                  <FounderProgressPage />
                </FounderLayout>
              </AlumniRouteGuard>
            } />
            <Route path="/alumni/founder/company/:id" element={
              <AlumniRouteGuard>
                <FounderLayout>
                  <CompanyProfilePage />
                </FounderLayout>
              </AlumniRouteGuard>
            } />

            <Route path="/event/:eventId/visuals" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <EventVisualManager />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/visuals" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <EventVisualManager />
              </RoleGuard>
            } />

            {/* Modules */}
            <Route path="/event/:eventId/agenda" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <BuilderWrapper />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/agenda" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <BuilderWrapper />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/experts" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <ExpertManager />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/experts" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <ExpertManager />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/startups" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <StartupManager />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/startups" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <StartupManager />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/lists" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <ListsManager />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/lists" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <ListsManager />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/library" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <LibraryManager />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/library" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <LibraryManager />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/selection" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <SelectionProcessManager />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/selection" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <SelectionProcessManager />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/analytics" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <MarketingAnalytics />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/analytics" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <MarketingAnalytics />
              </RoleGuard>
            } />

            <Route path="/event/:eventId/join-athar" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <JoinAtharDashboard />
              </RoleGuard>
            } />
            <Route path="/events/:eventId/join-athar" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <JoinAtharDashboard />
              </RoleGuard>
            } />

            {/* Public Portal */}
            <Route element={<PublicLayout />}>
              <Route path="/agenda/:eventId" element={<ViewerWrapper />} />
              <Route path="/view/:eventId/experts" element={<ExpertViewer />} />
              <Route path="/view/:eventId/startups" element={<StartupViewer />} />
              <Route path="/view/:eventId/library" element={<LibraryViewer />} />
              <Route path="/view/:eventId/join-athar" element={<JoinAtharView />} />
            </Route>

            {/* Registration & Forms Portals (public) */}
            <Route path="/events/:eventId/register/company" element={<CompanyPortal />} />
            <Route path="/events/:eventId/register/expert" element={<ExpertPortal />} />
            <Route path="/events/:eventId/register/form/:formId" element={<GenericFormPortal />} />
            <Route path="/events/:eventId/form/:formId" element={<GenericFormPortal />} />
            <Route path="/forms/:eventId/:formId" element={<GenericFormPortal />} />
            <Route path="/forms/:formId" element={<GenericFormPortal />} />

            {/* Public Certificate Verification */}
            <Route path="/verify-certificate/:code" element={<CertificateVerifier />} />
            <Route path="/verify-certificate" element={<CertificateVerifier />} />

            {/* Mentor Booking Routes */}
            <Route path="/event/:eventId/mentor-booking" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <MentorBookingAdmin />
              </RoleGuard>
            } />
            <Route path="/event/:eventId/mentor-booking/:mentorId" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <MentorDetails />
              </RoleGuard>
            } />
            <Route path="/book/:mentorId" element={<MentorBookingPage />} />

            {/* Ather Team Booking Routes */}
            <Route path="/event/:eventId/ather-team-booking" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <AtherTeamBookingAdmin />
              </RoleGuard>
            } />
            <Route path="/ather-team-book/:memberId" element={<AtherTeamBookingPage />} />

            {/* Mentoring Distribution Routes */}
            <Route path="/event/:eventId/mentoring-distribution" element={
              <RoleGuard allowedRoles={['super_admin', 'project_manager']}>
                <MentoringDistributionAdmin />
              </RoleGuard>
            } />
            <Route path="/view/:eventId/mentoring/live" element={<MentoringLiveView />} />
            <Route path="/view/:eventId/mentoring/matrix" element={<MentoringMatrixView />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  </ErrorBoundary>
  );
}

// Wrappers to handle params
function BuilderWrapper() {
  const { eventId } = useParams();
  return <EventBuilder event={{ event_id: eventId }} onBack={() => window.history.back()} />;
}

function ViewerWrapper() {
  const { eventId } = useParams();
  return <AgendaViewer eventId={eventId} />;
}


export default App;