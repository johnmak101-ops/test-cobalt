import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './hooks/use-auth'
import { AppShell } from './components/layout/AppShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ShipmentTrackerPage from './pages/ShipmentTrackerPage'
import ShipmentDetailPage from './pages/ShipmentDetailPage'
import InboxPage from './pages/InboxPage'
import AlertsPage from './pages/AlertsPage'
import AlertRulesPage from './pages/AlertRulesPage'
import SettingsPage from './pages/SettingsPage'
import ReviewQueuePage from './pages/ReviewQueuePage'
import ReviewShipmentPage from './pages/ReviewShipmentPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import PurchaseOrderDetailPage from './pages/PurchaseOrderDetailPage'
import UnlinkedDocumentsPage from './pages/UnlinkedDocumentsPage'
import EmailWindowPage from './pages/EmailWindowPage'
import { Toaster } from './components/ui/Toast'
import type { ReactNode } from 'react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
})

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cobalt-primary border-t-transparent" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

/** Settings (and alert-rules config) are superadmin-only; everyone else lands back on the dashboard. */
function SuperadminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && user.role !== 'SUPERADMIN') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cobalt-primary border-t-transparent" />
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      {/* Chrome-less pop-up window for reading a single email — auth-gated but outside the sidebar layout. */}
      <Route
        path="/email/:id"
        element={
          <ProtectedRoute>
            <EmailWindowPage />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/shipments" element={<ShipmentTrackerPage />} />
        <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="/documents" element={<UnlinkedDocumentsPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/review-queue" element={<ReviewQueuePage />} />
        <Route path="/review-queue/:id" element={<ReviewShipmentPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/alerts/rules" element={<SuperadminRoute><AlertRulesPage /></SuperadminRoute>} />
        <Route path="/settings" element={<SuperadminRoute><SettingsPage /></SuperadminRoute>} />
        <Route path="/settings/email" element={<SuperadminRoute><SettingsPage /></SuperadminRoute>} />
        <Route path="/settings/alerts" element={<SuperadminRoute><SettingsPage /></SuperadminRoute>} />
        <Route path="/settings/vendors" element={<SuperadminRoute><SettingsPage /></SuperadminRoute>} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
