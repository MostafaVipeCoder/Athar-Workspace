import { lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

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
};

import PublicLayout from './components/PublicLayout';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

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
    <AuthProvider>
      <Router>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route path="/" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />

            <Route path="/companies" element={
              <ProtectedRoute>
                <CompaniesPage />
              </ProtectedRoute>
            } />

            <Route path="/experts" element={
              <ProtectedRoute>
                <MasterExpertsList />
              </ProtectedRoute>
            } />

            <Route path="/library" element={
              <ProtectedRoute>
                <LibraryManager />
              </ProtectedRoute>
            } />

            {/* Event Hub */}
            <Route path="/event/:eventId" element={
              <ProtectedRoute>
                <EventDashboard />
              </ProtectedRoute>
            } />

            <Route path="/event/:eventId/forms" element={
              <ProtectedRoute>
                <FormEditor />
              </ProtectedRoute>
            } />

            <Route path="/event/:eventId/visuals" element={
              <ProtectedRoute>
                <EventVisualManager />
              </ProtectedRoute>
            } />



            {/* Modules */}
            <Route path="/event/:eventId/agenda" element={
              <ProtectedRoute>
                <BuilderWrapper />
              </ProtectedRoute>
            } />

            <Route path="/event/:eventId/experts" element={
              <ProtectedRoute>
                <ExpertManager />
              </ProtectedRoute>
            } />

            <Route path="/event/:eventId/startups" element={
              <ProtectedRoute>
                <StartupManager />
              </ProtectedRoute>
            } />

            <Route path="/event/:eventId/lists" element={
              <ProtectedRoute>
                <ListsManager />
              </ProtectedRoute>
            } />

            <Route path="/event/:eventId/library" element={
              <ProtectedRoute>
                <LibraryManager />
              </ProtectedRoute>
            } />


            <Route path="/event/:eventId/selection" element={
              <ProtectedRoute>
                <SelectionProcessManager />
              </ProtectedRoute>
            } />

            <Route path="/event/:eventId/analytics" element={
              <ProtectedRoute>
                <MarketingAnalytics />
              </ProtectedRoute>
            } />

            {/* Public Portal */}
            <Route element={<PublicLayout />}>
              <Route path="/agenda/:eventId" element={<ViewerWrapper />} />
              <Route path="/view/:eventId/experts" element={<ExpertViewer />} />
              <Route path="/view/:eventId/startups" element={<StartupViewer />} />
              <Route path="/view/:eventId/library" element={<LibraryViewer />} />
            </Route>

            {/* Registration Portals (No Authentication Required, No Layout/Nav) */}
            <Route path="/events/:eventId/register/company" element={<CompanyPortal />} />
            <Route path="/events/:eventId/register/expert" element={<ExpertPortal />} />
            <Route path="/events/:eventId/register/form/:formId" element={<GenericFormPortal />} />

            {/* Mentor Booking Routes */}
            <Route path="/event/:eventId/mentor-booking" element={
              <ProtectedRoute>
                <MentorBookingAdmin />
              </ProtectedRoute>
            } />
            <Route path="/event/:eventId/mentor-booking/:mentorId" element={
              <ProtectedRoute>
                <MentorDetails />
              </ProtectedRoute>
            } />
            <Route path="/book/:mentorId" element={<MentorBookingPage />} />

            {/* Ather Team Booking Routes */}
            <Route path="/event/:eventId/ather-team-booking" element={
              <ProtectedRoute>
                <AtherTeamBookingAdmin />
              </ProtectedRoute>
            } />
            <Route path="/ather-team-book/:memberId" element={<AtherTeamBookingPage />} />

            {/* Mentoring Distribution Routes */}
            <Route path="/event/:eventId/mentoring-distribution" element={
              <ProtectedRoute>
                <MentoringDistributionAdmin />
              </ProtectedRoute>
            } />
            <Route path="/view/:eventId/mentoring/live" element={<MentoringLiveView />} />
            <Route path="/view/:eventId/mentoring/matrix" element={<MentoringMatrixView />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
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