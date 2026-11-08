import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AuthForm } from '../src/components/auth-form';

const forms = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn() }));
vi.mock('@clerk/react', () => ({
  SignIn: (props: unknown) => {
    forms.signIn(props);
    return <div>Sign in</div>;
  },
  SignUp: (props: unknown) => {
    forms.signUp(props);
    return <div>Sign up</div>;
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each(['', '/glyph'])(
  'both auth forms avoid hosted popup callbacks and retain base-aware routes at %s',
  (basePath) => {
    render(<AuthForm mode="sign-in" basePath={basePath} />);
    expect(forms.signIn).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthFlow: 'redirect',
        routing: 'path',
        path: `${basePath}/sign-in`,
        signUpUrl: `${basePath}/sign-up`,
        forceRedirectUrl: `${basePath}/gmail`,
      }),
    );
    render(<AuthForm mode="sign-up" basePath={basePath} />);
    expect(forms.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthFlow: 'redirect',
        routing: 'path',
        path: `${basePath}/sign-up`,
        signInUrl: `${basePath}/sign-in`,
        forceRedirectUrl: `${basePath}/gmail`,
      }),
    );
  },
);
