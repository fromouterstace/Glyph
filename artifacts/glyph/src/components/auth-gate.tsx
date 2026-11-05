import type { ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { Redirect } from 'wouter';

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded)
    return (
      <div className="p-6 text-sm text-muted-foreground" role="status">
        Checking sign-in…
      </div>
    );

  if (!isSignedIn) return <Redirect to="/sign-in" />;

  return children;
}
