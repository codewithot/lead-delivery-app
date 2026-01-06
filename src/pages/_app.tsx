import "../styles/globals.css";
import { SessionProvider } from "next-auth/react";
import type { AppProps } from "next/app";
import type { Session } from "next-auth";
import { useEffect, useState } from "react";
import { Router } from "next/router";
import PageLoader from "@/components/PageLoader";

// Validate environment variables on server startup
if (typeof window === "undefined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { validateEnvironment } = require("../lib/validateEnv");
    validateEnvironment(false); // Log warnings but don't crash dev server immediately
  } catch (e) {
    console.error("Failed to validate environment:", e);
  }
}

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}: AppProps<{ session: Session }>) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const start = () => setLoading(true);
    const end = () => setLoading(false);

    Router.events.on("routeChangeStart", start);
    Router.events.on("routeChangeComplete", end);
    Router.events.on("routeChangeError", end);

    return () => {
      Router.events.off("routeChangeStart", start);
      Router.events.off("routeChangeComplete", end);
      Router.events.off("routeChangeError", end);
    };
  }, []);

  return (
    <SessionProvider session={session}>
      {loading && <PageLoader />}
      <Component {...pageProps} />
    </SessionProvider>
  );
}