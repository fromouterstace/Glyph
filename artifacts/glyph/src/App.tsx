import { useEffect, useRef, type ReactNode, type ComponentType } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Switch,
  Route,
  Redirect,
  useLocation,
  Link,
  Router as WouterRouter,
} from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/dashboard';
import Emails from '@/pages/emails';
import ActivityPage from '@/pages/activity';
import SettingsPage from '@/pages/settings';
import GmailPage from '@/pages/gmail';
import { Shell } from '@/components/shell';
import { GlyphMark } from '@/components/bits';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const INK = 'hsl(203 32% 13%)';
const clerkAppearance = {
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(9 76% 50%)',
    colorForeground: INK,
    colorMutedForeground: 'hsl(203 12% 38%)',
    colorDanger: 'hsl(350 70% 44%)',
    colorBackground: 'hsl(40 40% 98.5%)',
    colorInput: 'hsl(40 33% 96%)',
    colorInputForeground: INK,
    colorNeutral: INK,
    fontFamily: "'Instrument Sans', system-ui, sans-serif",
    borderRadius: '0.375rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox:
      'bg-[hsl(40_40%_98.5%)] rounded-md w-[420px] max-w-full overflow-hidden border border-[hsl(38_18%_84%)] shadow-[0_24px_60px_-30px_hsl(203_32%_13%/0.45)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle:
      "text-[hsl(203_32%_13%)] font-extrabold text-2xl [font-family:'Bricolage_Grotesque',sans-serif]",
    headerSubtitle: 'text-[hsl(203_12%_38%)]',
    socialButtonsBlockButtonText: 'text-[hsl(203_32%_13%)] font-medium',
    formFieldLabel: 'text-[hsl(203_32%_13%)] font-medium',
    footerActionLink: 'text-[hsl(9_76%_46%)] font-semibold',
    footerActionText: 'text-[hsl(203_12%_38%)]',
    dividerText: 'text-[hsl(203_12%_38%)]',
    identityPreviewEditButton: 'text-[hsl(9_76%_46%)]',
    formFieldSuccessText: 'text-[hsl(176_45%_28%)]',
    alertText: 'text-[hsl(203_32%_13%)]',
    logoBox: 'h-11 justify-start',
    logoImage: 'h-11 w-11',
    socialButtonsBlockButton:
      'border border-[hsl(38_18%_80%)] bg-[hsl(40_33%_96%)] hover:bg-[hsl(38_26%_90%)]',
    formButtonPrimary:
      'bg-[hsl(9_76%_50%)] text-[hsl(40_40%_98%)] font-semibold shadow-none',
    formFieldInput:
      'border border-[hsl(38_16%_80%)] bg-[hsl(40_33%_96%)] text-[hsl(203_32%_13%)]',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-[hsl(38_18%_84%)]',
    alert: 'border border-[hsl(350_60%_84%)] bg-[hsl(350_70%_96%)]',
    otpCodeFieldInput:
      'border border-[hsl(38_16%_80%)] text-[hsl(203_32%_13%)]',
    formFieldRow: 'mb-1',
    main: 'gap-5',
  },
};

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grain grid min-h-[100dvh] bg-background lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          data-testid="link-auth-home"
        >
          <GlyphMark live />{' '}
          <span className="font-display text-2xl font-extrabold text-sidebar-accent-foreground">
            glyph
          </span>
        </Link>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-primary">
            1 x 1 px
          </div>
          <h2 className="font-display mt-3 text-5xl font-extrabold leading-[0.95] text-sidebar-accent-foreground">
            The smallest thing
            <br />
            in your email
            <br />
            tells you the most.
          </h2>
          <p className="mt-5 max-w-sm text-sm text-sidebar-foreground/70">
            Sign in with the account whose verified email matches the connected
            Gmail to send. Any other account sees only its own empty workspace.
          </p>
        </div>
        <div className="grid grid-cols-12 gap-1.5 opacity-70" aria-hidden>
          {Array.from({ length: 48 }).map((_, i) => (
            <span
              key={i}
              className={`aspect-square rounded-[2px] ${[7, 19, 30, 41].includes(i) ? 'bg-sidebar-primary' : 'bg-sidebar-accent'}`}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-10">
        {children}
      </div>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthFrame>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </AuthFrame>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/app" />
      </Show>
      <Show when="signed-out">
        <Shell>
          <Dashboard />
        </Shell>
      </Show>
    </>
  );
}

function AppHome() {
  return (
    <>
      <Show when="signed-in">
        <Shell>
          <Dashboard />
        </Shell>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

const wrap = (C: ComponentType) => () => (
  <Shell>
    <C />
  </Shell>
);
const EmailsRoute = wrap(Emails);
const ActivityRoute = wrap(ActivityPage);
const SettingsRoute = wrap(SettingsPage);
const GmailRoute = wrap(GmailPage);

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Back to your signals',
            subtitle: 'Use the email that owns your connected Gmail',
          },
        },
        signUp: {
          start: {
            title: 'Start reading the glyphs',
            subtitle: 'Verify the email that matches your Gmail to send',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/app" component={AppHome} />
              <Route path="/emails" component={EmailsRoute} />
              <Route path="/emails/:id" component={EmailsRoute} />
              <Route path="/activity" component={ActivityRoute} />
              <Route path="/settings" component={SettingsRoute} />
              <Route path="/gmail" component={GmailRoute} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
