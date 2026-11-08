import { SignIn, SignUp } from '@clerk/react';

/** Managed Clerk uses the app proxy, not hosted accounts-domain popups. */
export function AuthForm({
  mode,
  basePath,
}: {
  mode: 'sign-in' | 'sign-up';
  basePath: string;
}) {
  const common = {
    routing: 'path' as const,
    oauthFlow: 'redirect' as const,
    forceRedirectUrl: `${basePath}/gmail`,
  };
  return mode === 'sign-in' ? (
    <SignIn
      {...common}
      path={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
    />
  ) : (
    <SignUp
      {...common}
      path={`${basePath}/sign-up`}
      signInUrl={`${basePath}/sign-in`}
    />
  );
}
