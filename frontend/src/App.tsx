import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './hooks/use-auth'
import { AppShell } from './components/layout/AppShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ShipmentTrackerPage from './pages/ShipmentTrackerPage'
import ShipmentDetailPage from './pages/ShipmentDetailPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import PurchaseOrderDetailPage from './pages/PurchaseOrderDetailPage'
import BookingDetailPage from './pages/BookingDetailPage'
import AlertsPage from './pages/AlertsPage'
import ReviewPage from './pages/ReviewPage'
import ReviewDetailPage from './pages/ReviewDetailPage'
import SettingsPage from './pages/SettingsPage'
import MastersPage from './pages/MastersPage'
import UsersPage from './pages/UsersPage'
import EmailViewPage from './pages/EmailViewPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
})

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cobalt-primary border-t-transparent" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="page-title">Page not found</h1>
      <p className="muted">
        That page doesn’t exist. Head back to the{' '}
        <Link to="/shipments" className="link">Shipments</Link> tracker.
      </p>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* standalone email window (new tab) — authed, but no app chrome */}
            <Route
              path="/emails/view"
              element={
                <Protected>
                  <EmailViewPage />
                </Protected>
              }
            />
            <Route
              element={
                <Protected>
                  <AppShell />
                </Protected>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/shipments" element={<ShipmentTrackerPage />} />
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
              <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
              <Route path="/review-queue" element={<ReviewPage />} />
              <Route path="/review-queue/:id" element={<ReviewDetailPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/masters" element={<MastersPage />} />
              <Route path="/users" element={<UsersPage />} />
              {/* alert deep-links + back-compat */}
              <Route path="/bookings/:id" element={<BookingDetailPage />} />
              {/* no bookings LIST page (shipment-centric) — a bare /bookings lands on the tracker */}
              <Route path="/bookings" element={<Navigate to="/shipments" replace />} />
              {/* anything else renders inside the app chrome instead of a blank page */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
