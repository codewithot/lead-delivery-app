
import { useSession, signIn } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/router";
import React from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import Layout from "../components/Layout";

type Job = {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
  progress?: {
    processed: number;
    total: number;
    status: string;
  } | null;
};

// ✅ NEW: Plan usage type
type PlanUsage = {
  planLimit: number;
  pushedToday: number;
  remaining: number;
  availableCount: number;
  percentageUsed: number;
  canPushMore: boolean;
  lastUpdated: string;
};

interface FetchError extends Error {
  info?: unknown;
  status?: number;
}

// Update fetcher to throw if response is not ok
const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error: FetchError = new Error("An error occurred while fetching the data.");
    // Attach extra info to the error object.
    const info = await res.json();
    error.status = res.status;
    error.info = info;
    throw error;
  }
  return res.json();
};

// ... inside component ...



export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [authError, setAuthError] = React.useState<string | null>(null);

  useEffect(() => {
    if (router.query.error) {
      const errorStr = router.query.error as string;
      if (errorStr === "OAuthAccountNotLinked" || errorStr === "Callback") {
        setAuthError("This GoHighLevel account is already connected to another user. Each GHL account can only be linked to one ProEdge user.");
      } else {
        setAuthError("An error occurred during authentication. Please try again.");
      }

      // Clean up the URL
      const rest = { ...router.query };
      delete rest.error;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.query, router]);

  useEffect(() => {
    if (session) {
      console.log("[Dashboard] Session data:", {
        userId: session.user?.userId,
        email: session.user?.email,
        locationId: session.user?.locationId,
        companyId: session.user?.companyId
      });
    }
  }, [session]);

  // ✅ NEW: Loading state for connection
  const [isConnecting, setIsConnecting] = React.useState(false);

  // Helper for GHL connection
  const handleConnectGHL = () => {
    setIsConnecting(true);
    signIn("gh", { callbackUrl: "/dashboard" }).catch(() => setIsConnecting(false));
  };

  const { data: jobs, error: jobsError } = useSWR<Job[]>(
    status === "authenticated" ? "/api/jobs" : null,
    fetcher
  );

  // ✅ NEW: Fetch plan usage data
  const { data: planUsage, error: planUsageError } = useSWR<PlanUsage>(
    status === "authenticated" ? "/api/plan-usage" : null,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
    }
  );

  // ✅ NEW: Check if user has valid GHL tokens
  const { data: tokenStatus } = useSWR<{ hasTokens: boolean; hasLocationId: boolean; needsReauth: boolean }>(
    status === "authenticated" ? "/api/auth/check-tokens" : null,
    fetcher
  );

  useEffect(() => {
    if (!session && status !== "loading") {
      router.replace("/auth/signin");
    }
  }, [session, status, router]);

  // Auto-refresh when jobs are in progress
  useEffect(() => {
    if (!jobs) return;

    const hasInProgressJobs = jobs.some(
      (job) => job.status === "in_progress" || job.status === "pending"
    );

    if (hasInProgressJobs) {
      const interval = setInterval(() => {
        console.log("🔄 Refreshing jobs...");
        mutate("/api/jobs");
        mutate("/api/plan-usage"); // ✅ Also refresh plan usage
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [jobs]);

  if (status === "loading" || !session) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </Layout>
    );
  }

  if (jobsError) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto p-4">
          <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-6 text-center">
            <h3 className="text-xl font-bold text-red-500 mb-2">Failed to load data</h3>
            <p className="text-gray-400 mb-4">{jobsError.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors font-medium"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Dashboard - ProEdge">
      <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Delivery Dashboard</h1>
            <p className="text-gray-400">
              Welcome back, <span className="text-blue-400 font-semibold">{session.user?.name || session.user?.email || "User"}</span>
            </p>
          </div>
          <div className="flex gap-3">
            {/* Actions moved to Layout header, but kept context-specific ones here if needed */}
            <Link
              href="/admin/failed-jobs"
              className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors text-sm font-medium"
            >
              Failed Jobs
            </Link>
          </div>
        </div>

        {/* Authentication Error Alert */}
        {authError && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-3 animate-shake">
            <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <p className="text-red-200 text-sm font-medium">{authError}</p>
            </div>
            <button onClick={() => setAuthError(null)} className="text-red-400 hover:text-red-200 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* GHL Connection Prompt - Show if tokens are missing */}
        {tokenStatus?.needsReauth && (
          <div className="glass-panel p-8 rounded-2xl border border-blue-500/30 bg-blue-500/5 animate-pulse-subtle">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-xl font-bold text-white mb-2">
                  {tokenStatus?.hasLocationId ? 'Re-authenticate with GoHighLevel' : 'Connect Your GoHighLevel Account'}
                </h2>
                <p className="text-gray-400 max-w-2xl">
                  {tokenStatus?.hasLocationId
                    ? 'Your GoHighLevel authentication has expired or been revoked. Please re-authenticate to continue receiving leads.'
                    : 'To start receiving automated real-estate leads, you need to connect your GoHighLevel sub-account. This is a one-time setup that ensures seamless lead delivery directly to your CRM.'
                  }
                </p>
              </div>
              <button
                onClick={handleConnectGHL}
                disabled={isConnecting}
                className={`px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] transform hover:-translate-y-1 flex items-center gap-2 ${isConnecting ? 'opacity-75 cursor-wait' : ''}`}
              >
                {isConnecting ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting...
                  </>
                ) : (
                  tokenStatus?.hasLocationId ? 'Re-authenticate' : 'Connect Now'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Settings Configuration Prompt - Show if user has GHL connected but no settings */}
        {planUsageError && tokenStatus?.hasTokens && !tokenStatus?.needsReauth && (
          <div className="glass-panel p-8 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 animate-pulse-subtle">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="w-16 h-16 bg-yellow-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-yellow-500/20">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-xl font-bold text-white mb-2">
                  Configure Your Lead Preferences
                </h2>
                <p className="text-gray-400 max-w-2xl">
                  To start receiving leads, you need to configure your preferences. Set your target ZIP codes, price range, and daily limit to match your business needs.
                </p>
              </div>
              <Link
                href="/settings"
                className="px-8 py-4 bg-yellow-600 hover:bg-yellow-700 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(202,138,4,0.3)] hover:shadow-[0_0_30px_rgba(202,138,4,0.5)] transform hover:-translate-y-1 flex items-center gap-2"
              >
                Go to Settings
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        )}

        {/* Usage Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-panel p-6 rounded-2xl relative overflow-hidden">
            <div className="relative z-10">
              <p className="text-sm font-medium text-gray-400">Daily Push Limit</p>
              <p className="text-3xl font-bold text-white mt-1">
                {planUsage ? `${planUsage.pushedToday} / ${planUsage.planLimit}` : '...'}
              </p>
              <div className="mt-4 w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: planUsage ? `${planUsage.percentageUsed}%` : '0%' }}
                />
              </div>
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
          </div>

          <div className="glass-panel p-6 rounded-2xl relative overflow-hidden">
            <div className="relative z-10">
              <p className="text-sm font-medium text-gray-400">Queued Today</p>
              <p className="text-3xl font-bold text-white mt-1">
                {planUsage?.availableCount || 0}
              </p>
              <p className="text-xs text-gray-500 mt-2">Ready for processing</p>
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="glass-panel rounded-2xl border border-gray-800 overflow-hidden">
          <div className="p-6 border-b border-gray-800 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Recent Delivery Jobs</h2>
            <button
              onClick={() => mutate("/api/jobs")}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Refresh List
            </button>
          </div>

          <div className="overflow-x-auto">
            {!jobs ? (
              <div className="p-8 text-center text-gray-500">Loading jobs...</div>
            ) : jobs.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-400 text-lg">No jobs found</p>
                <p className="text-gray-600 text-sm mt-1">Your automated deliveries will appear here.</p>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-white/5 text-gray-400 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium">Job Details</th>
                    <th className="px-6 py-4 font-medium">Progress</th>
                    <th className="px-6 py-4 font-medium">Timeline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {Array.isArray(jobs) && jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${job.status === 'completed' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                          job.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                            'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                          }`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-white font-mono">{job.id.slice(0, 8)}...</p>
                        {job.lastError && (
                          <p className="text-xs text-red-400 mt-1 max-w-xs truncate">{job.lastError}</p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {job.progress ? (
                          <div className="w-full max-w-xs space-y-2">
                            <div className="flex justify-between text-xs text-gray-400">
                              <span>{job.progress.status}</span>
                              <span>{Math.round((job.progress.processed / job.progress.total) * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${(job.progress.processed / job.progress.total) * 100}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-400">
                        <div>{new Date(job.createdAt).toLocaleDateString()}</div>
                        <div className="text-xs text-gray-600">{new Date(job.createdAt).toLocaleTimeString()}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
