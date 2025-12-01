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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const { data: jobs, error } = useSWR<Job[]>(
    status === "authenticated" ? "/api/jobs" : null,
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
      }, 5000); // Refresh every 5 seconds

      return () => clearInterval(interval);
    }
  }, [jobs, mutate]);

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
