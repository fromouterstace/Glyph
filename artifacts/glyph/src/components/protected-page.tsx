import { Suspense, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { AuthGate } from './auth-gate';
import { Shell } from './shell';
import { ErrorBoundary } from './error-boundary';

function PageFailure() {
  return (
    <div role="alert" className="space-y-3 p-6">
      <h1 className="text-lg font-semibold">This page is unavailable</h1>
      <p className="text-sm text-muted-foreground">
        Check your connection and reload the page. If Glyph was recently
        updated, reloading will fetch the latest version.
      </p>
      <button
        type="button"
        className="rounded-sm border border-border px-3 py-2 text-sm font-medium"
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}

export function ProtectedPage({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <AuthGate>
      <Shell>
        <ErrorBoundary resetKey={location} FallbackComponent={PageFailure}>
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                className="p-6 text-sm text-muted-foreground"
              >
                Loading page…
              </div>
            }
          >
            {children}
          </Suspense>
        </ErrorBoundary>
      </Shell>
    </AuthGate>
  );
}
