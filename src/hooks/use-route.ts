import { useCallback, useEffect, useState } from 'react';

import {
  advanceRoute,
  formatRoute,
  HOME,
  parseRoute,
  type Route,
  type RouteState,
  viewBelow,
} from '@/lib/app-route';

interface RouteControls extends RouteState {
  navigate(route: Route, replace?: boolean): void;
  /** Leaves `#settings` for `page`, the view behind it, without growing the Back stack. */
  closeSettings(page: Route): void;
  /** Swaps the view behind Settings while it stays open (the session it showed is gone). */
  resetPage(page: Route): void;
}

/** The hash route, kept in step with the address bar and the Back button. */
export function useRoute(): RouteControls {
  const [state, setState] = useState<RouteState>(() => {
    // Loaded with Settings already open: the pane behind it is the entry it was opened over.
    const behind = viewBelow() ?? HOME;
    return advanceRoute({ route: behind, page: behind }, parseRoute(window.location.hash));
  });

  useEffect(() => {
    const onHashChange = () =>
      setState((previous) => advanceRoute(previous, parseRoute(window.location.hash)));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const hash = formatRoute(next);
    if (replace) {
      // Typing in the search box must not stack one history entry per keystroke.
      window.history.replaceState(null, '', hash);
      setState((previous) => advanceRoute(previous, next));
      return;
    }
    if (window.location.hash === hash) {
      setState((previous) => advanceRoute(previous, next));
      return;
    }
    window.location.hash = hash;
  }, []);

  const closeSettings = useCallback((page: Route) => {
    if (viewBelow() !== undefined) {
      // Opened over an entry of ours: step back onto it, so closing leaves no dead "Back" press
      // behind. `hashchange` then updates the route.
      window.history.back();
      return;
    }
    // Arrived at #settings directly (Chrome's "Options", a bookmark): nothing of ours to go back
    // to, so this entry becomes the view that was showing behind the dialog.
    window.history.replaceState(null, '', formatRoute(page));
    setState({ route: page, page });
  }, []);

  const resetPage = useCallback((page: Route) => {
    setState((previous) => ({ ...previous, page }));
  }, []);

  return { ...state, navigate, closeSettings, resetPage };
}
