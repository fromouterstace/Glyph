import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '../src/components/auth-gate';

const state = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  location: '/emails/message-123',
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({
    isLoaded: state.isLoaded,
    isSignedIn: state.isSignedIn,
  }),
}));

vi.mock('wouter', () => ({
  useLocation: () => [state.location],
  Redirect: ({ to }: { to: string }) => <div data-redirect={to} />,
}));

function renderGate() {
  return renderToStaticMarkup(
    <AuthGate>
      <div>Private account data</div>
    </AuthGate>,
  );
}

describe('private account route authentication', () => {
  beforeEach(() => {
    state.isLoaded = true;
    state.isSignedIn = true;
    state.location = '/emails/message-123';
  });

  it('does not render account data while authentication is loading', () => {
    state.isLoaded = false;
    const html = renderGate();
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Private account data');
    expect(html).not.toContain('data-redirect');
  });

  it('redirects a signed-out visitor to sign-in without rendering private data', () => {
    state.isSignedIn = false;
    const html = renderGate();
    expect(html).toContain('data-redirect="/sign-in"');
    expect(html).not.toContain('Private account data');
  });

  it('renders private content only after authentication is ready', () => {
    const html = renderGate();
    expect(html).toContain('Private account data');
    expect(html).not.toContain('data-redirect');
  });
});
