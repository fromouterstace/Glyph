import type { ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { Redirect, useLocation } from 'wouter';

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [location] = useLocation();

  if (!isLoaded)
    return (
      <div className="p-6 text-sm text-muted-foreground" role="status">
        Checking sign-in…
      </div>
    );

  if (!isSignedIn)
    return (
      <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(location)}`} />
    );

  return children;
}
