// src/pages/dashboard.tsx

import { useSession, signOut } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/router";
import React from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const { data: jobs, error } = useSWR<Job[]>(
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

  if (status === "loading") {
    return (
      <div className="max-w-4xl mx-auto p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-2 text-gray-800">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto p-4 text-center">
        <h1 className="text-2xl font-bold mb-4 text-gray-900">
          Authenticating...
        </h1>
        <p className="mb-4 text-gray-700">
          Redirecting to GoHighLevel sign in...
        </p>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-red-50 border border-red-300 rounded-md p-4">
          <p className="text-red-900 font-medium">
            Failed to load jobs: {error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-red-700 hover:text-red-900 hover:underline font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!jobs) {
    return (
      <div className="max-w-4xl mx-auto p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-2 text-gray-800">Loading jobs...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900">
            Delivery History
          </h1>
          <p className="text-gray-600 text-base mt-1">
            Welcome back,{" "}
            <span className="text-gray-800 font-medium">
              {session.user?.name || session.user?.email || "User"}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/failed-jobs"
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors font-medium"
          >
            Failed Jobs
          </Link>
          <Link
            href="/settings"
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors font-medium"
          >
            Settings
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors font-medium"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ✅ UPDATED: Plan Usage Card with Real Data */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6 mb-6">
        {planUsageError ? (
          // Error state
          <div className="text-center py-4">
            <p className="text-red-700 font-medium">
              ⚠️ Failed to load plan usage
            </p>
            <button
              onClick={() => mutate("/api/plan-usage")}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : !planUsage ? (
          // Loading state
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
            <p className="text-gray-600">Loading plan usage...</p>
          </div>
        ) : (
          // Data loaded successfully
          <>
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-blue-900 mb-2">
                  📊 Plan Usage
                </h2>
                <p className="text-sm text-gray-600">
                  Your current plan limit and daily usage
                </p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">
                  {planUsage.pushedToday} / {planUsage.planLimit}
                </div>
                <p className="text-xs text-gray-500">properties pushed today</p>
                {planUsage.availableCount > 0 && (
                  <p className="text-xs text-green-600 mt-1">
                    {planUsage.availableCount} available to push
                  </p>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-300 ${
                    planUsage.percentageUsed >= 100
                      ? "bg-red-600"
                      : planUsage.percentageUsed >= 80
                      ? "bg-yellow-600"
                      : "bg-blue-600"
                  }`}
                  style={{
                    width: `${Math.min(100, planUsage.percentageUsed)}%`,
                  }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>0</span>
                <span>{planUsage.percentageUsed}% used</span>
                <span>Limit: {planUsage.planLimit}</span>
              </div>
            </div>

            {/* Status Messages */}
            <div className="mt-3">
              {planUsage.percentageUsed >= 100 ? (
                <div className="flex items-center text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                  <span className="mr-2">🚫</span>
                  <span className="font-medium">
                    Daily limit reached. Resets tomorrow.
                  </span>
                </div>
              ) : planUsage.percentageUsed >= 80 ? (
                <div className="flex items-center text-sm text-yellow-700 bg-yellow-50 rounded-md px-3 py-2">
                  <span className="mr-2">⚠️</span>
                  <span className="font-medium">
                    {planUsage.remaining} properties remaining today
                  </span>
                </div>
              ) : planUsage.canPushMore && planUsage.availableCount > 0 ? (
                <div className="flex items-center text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                  <span className="mr-2">✅</span>
                  <span className="font-medium">
                    Ready to push more properties
                  </span>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Jobs Table */}
      {!Array.isArray(jobs) ? (
        <div className="text-center py-8">
          <p className="text-red-700 text-lg">Jobs data is unavailable.</p>
          <pre className="text-xs text-gray-500">
            {JSON.stringify(jobs, null, 2)}
          </pre>
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-700 text-lg">No delivery jobs found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-white rounded-lg shadow-lg border border-gray-300">
            <thead>
              <tr className="bg-gray-800 text-white">
                <th className="border border-gray-400 px-4 py-3 text-left font-semibold">
                  ID
                </th>
                <th className="border border-gray-400 px-4 py-3 text-left font-semibold">
                  Status
                </th>
                <th className="border border-gray-400 px-4 py-3 text-left font-semibold">
                  Attempts
                </th>
                <th className="border border-gray-400 px-4 py-3 text-left font-semibold">
                  Last Error
                </th>
                <th className="border border-gray-400 px-4 py-3 text-left font-semibold">
                  Created At
                </th>
                <th className="border border-gray-400 px-4 py-3 text-left font-semibold">
                  Finished At
                </th>
                <th className="border border-gray-400 px-4 py-3 text-left font-semibold">
                  Progress
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, index) => (
                <tr
                  key={job.id}
                  className={`hover:bg-blue-50 ${
                    index % 2 === 0 ? "bg-gray-50" : "bg-white"
                  }`}
                >
                  <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-gray-800">
                    {job.id}
                  </td>
                  <td className="border border-gray-300 px-4 py-3">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        job.status === "completed"
                          ? "bg-green-200 text-green-900"
                          : job.status === "failed"
                          ? "bg-red-200 text-red-900"
                          : "bg-yellow-200 text-yellow-900"
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="border border-gray-300 px-4 py-3 text-gray-800 font-medium">
                    {job.attempts}
                  </td>
                  <td className="border border-gray-300 px-4 py-3 text-sm text-red-700 font-medium">
                    {job.lastError || "—"}
                  </td>
                  <td className="border border-gray-300 px-4 py-3 text-sm text-gray-800">
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                  <td className="border border-gray-300 px-4 py-3 text-sm text-gray-800">
                    {job.finishedAt
                      ? new Date(job.finishedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="border border-gray-300 px-4 py-3">
                    {job.progress ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-gray-700">
                            {job.progress.processed} / {job.progress.total}
                          </span>
                          <span className="font-bold text-blue-600">
                            {Math.round(
                              (job.progress.processed / job.progress.total) *
                                100
                            )}
                            %
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                100,
                                (job.progress.processed / job.progress.total) *
                                  100
                              )}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {job.progress.status}
                        </p>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
