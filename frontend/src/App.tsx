/* Orbital Operations Console: dark municipal command center, signal-led UI, asymmetric workspace. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/ThemePreview";
import GisOperations from "./pages/PublicGis";
import NotFound from "./pages/NotFound";
import { lazy, Suspense } from "react";
import { CLOUD_DEPLOYMENT } from "./lib/deployment";
const Contributors = lazy(() => import("./pages/Contributors"));
const ContributorPrivacy = lazy(() => import("./pages/ContributorPrivacy"));
const AdminDesk = CLOUD_DEPLOYMENT
  ? NotFound
  : lazy(() => import("./pages/AdminDesk"));

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/gis" component={GisOperations} />
      <Route path="/design-preview" component={Home} />
      <Route path="/admin" component={AdminDesk} />
      <Route path="/contribute/privacy" component={ContributorPrivacy} />
      <Route path="/contribute/login" component={Contributors} />
      <Route path="/contribute" component={Contributors} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster richColors position="bottom-right" />
          <Suspense
            fallback={
              <div className="min-h-screen bg-slate-950 p-8 text-slate-300">
                Loading page…
              </div>
            }
          >
            <Router />
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
