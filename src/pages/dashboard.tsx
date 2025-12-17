
import { useSession } from "next-auth/react";
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

  const { data: jobs, error } = useSWR<Job[]>(
    status === "authenticated" ? "/api/jobs" : null,
    fetcher
  );

  // ✅ NEW: Fetch plan usage data
  const { data: planUsage } = useSWR<PlanUsage>(
    status === "authenticated" ? "/api/plan-usage" : null,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
    }
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
        <div className="flex flex-col items-center justify-center min-h-[50vh]">
          <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-gray-400">Loading your dashboard...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto p-4">
          <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-6 text-center">
            <h3 className="text-xl font-bold text-red-500 mb-2">Failed to load data</h3>
            <p className="text-gray-400 mb-4">{error.message}</p>
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
