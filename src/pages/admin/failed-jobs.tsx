// src/pages/admin/failed-jobs.tsx
import { GetServerSideProps } from "next";
import { getSession } from "next-auth/react";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import Layout from "@/components/Layout";
import { Toast } from "@/components/Toast";

type FailedJob = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  User: {
    email: string | null;
    name: string | null;
  };
};

type FailedJobsResponse = {
  jobs: FailedJob[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getSession(ctx);
  if (!session) {
    return {
      redirect: { destination: "/auth/signin", permanent: false },
    };
  }
  return { props: {} };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function FailedJobsPage() {
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const limit = 20;

  const { data, error, isLoading } = useSWR<FailedJobsResponse>(
    `/api/jobs/failed?limit=${limit}&offset=${page * limit}`,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
    }
  );

  const handleSelectJob = (jobId: string) => {
    setSelectedJobs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(jobId)) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (!data?.jobs) return;

    if (selectedJobs.size === data.jobs.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(data.jobs.map((j) => j.id)));
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setIsRetrying(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/retry`, {
        method: "POST",
      });

      if (response.ok) {
        setToast({ message: `Job queued for retry successfully`, type: 'success' });
        mutate(`/api/jobs/failed?limit=${limit}&offset=${page * limit}`);
        setSelectedJobs((prev) => {
          const newSet = new Set(prev);
          newSet.delete(jobId);
          return newSet;
        });
      } else {
        const error = await response.json();
        setToast({ message: `Failed to retry job: ${error.error}`, type: 'error' });
      }
    } catch (error) {
      setToast({ message: `Error retrying job: ${error}`, type: 'error' });
    } finally {
      setIsRetrying(false);
    }
  };

  const handleBulkRetry = async () => {
    if (selectedJobs.size === 0) {
      alert("Please select at least one job to retry");
      return;
    }

    if (!confirm(`Retry ${selectedJobs.size} selected jobs?`)) {
      return;
    }

    setIsRetrying(true);
    try {
      const response = await fetch("/api/jobs/retry-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: Array.from(selectedJobs) }),
      });

      if (response.ok) {
        const result = await response.json();
        setToast({
          message: `Successfully retried ${result.results.successful.length} jobs.`,
          type: 'success'
        });
        mutate(`/api/jobs/failed?limit=${limit}&offset=${page * limit}`);
        setSelectedJobs(new Set());
      } else {
        const error = await response.json();
        setToast({ message: `Bulk retry failed: ${error.error}`, type: 'error' });
      }
    } catch (error) {
      setToast({ message: `Error retrying jobs: ${error}`, type: 'error' });
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="Failed Jobs - Admin">
        <div className="flex flex-col items-center justify-center py-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <p className="mt-4 text-gray-400">Loading failed jobs...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Error - Failed Jobs">
        <div className="max-w-3xl mx-auto py-12">
          <div className="bg-red-500/10 border border-red-500/50 rounded-2xl p-6 flex items-center gap-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-red-200 font-medium">Failed to load jobs</p>
              <p className="text-red-400/80 text-sm mt-1">{error.message}</p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Failed Jobs - ProEdge Admin">
      <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-800 pb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold text-white">Failed Jobs</h1>
              <span className="px-2 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-xs font-bold uppercase tracking-wider">
                Admin
              </span>
            </div>
            <p className="text-gray-400">
              Monitoring {data?.pagination.total || 0} unsuccessful job executions
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 glass-panel hover:bg-white/5 text-gray-300 rounded-xl border border-white/5 hover:border-white/10 transition-all text-sm font-medium"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Bulk Actions */}
        {data && data.jobs.length > 0 && (
          <div className="glass-panel border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${selectedJobs.size === data.jobs.length ? 'bg-blue-600 border-blue-600' : 'border-gray-600 group-hover:border-gray-400'}`}>
                  <input
                    type="checkbox"
                    checked={selectedJobs.size === data.jobs.length}
                    onChange={handleSelectAll}
                    className="sr-only"
                  />
                  {selectedJobs.size === data.jobs.length && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-sm font-medium text-gray-300">
                  {selectedJobs.size === 0
                    ? "Select All on Page"
                    : `${selectedJobs.size} Selected`}
                </span>
              </label>
            </div>

            {selectedJobs.size > 0 && (
              <button
                onClick={handleBulkRetry}
                disabled={isRetrying}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isRetrying ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Retry {selectedJobs.size} {selectedJobs.size === 1 ? 'Job' : 'Jobs'}
              </button>
            )}
          </div>
        )}

        {/* Jobs List */}
        {!data || data.jobs.length === 0 ? (
          <div className="glass-panel border-white/5 rounded-2xl py-24 text-center">
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white">No failed jobs</h3>
            <p className="text-gray-500 mt-2">All lead delivery processes are running smoothly.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {data.jobs.map((job) => (
              <div
                key={job.id}
                onClick={() => handleSelectJob(job.id)}
                className={`glass-panel border-white/5 rounded-2xl p-5 transition-all cursor-pointer group ${selectedJobs.has(job.id)
                    ? "ring-2 ring-blue-500/50 bg-blue-500/5 shadow-lg shadow-blue-500/10"
                    : "hover:bg-white/5"
                  }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition-all ${selectedJobs.has(job.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-700 active:scale-95'}`}>
                    {selectedJobs.has(job.id) && (
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  <div className="flex-1 space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
                            {job.id}
                          </code>
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-0.5 bg-white/5 rounded">
                            {job.type}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-x-4">
                        <div className="text-right">
                          <p className="text-[10px] text-gray-500 uppercase tracking-tighter">Attempts</p>
                          <p className="text-sm font-bold text-white leading-none mt-1">
                            {job.attempts} <span className="text-gray-600 font-normal">/</span> {job.maxAttempts}
                          </p>
                        </div>
                        <div className="h-8 w-px bg-gray-800" />
                        <div className="text-right">
                          <p className="text-[10px] text-gray-500 uppercase tracking-tighter">Target User</p>
                          <p className="text-sm font-bold text-blue-400 leading-none mt-1">
                            {job.User.email?.split('@')[0] || 'Unknown'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {job.lastError && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                        <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1.5 opacity-80 font-mono">
                          Exception Detail
                        </p>
                        <p className="text-xs text-red-200/90 font-mono break-all leading-relaxed bg-black/40 p-2 rounded border border-white/5">
                          {job.lastError}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                      <div className="flex gap-4 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Created: {new Date(job.createdAt).toLocaleTimeString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Failed: {new Date(job.updatedAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetryJob(job.id);
                        }}
                        disabled={isRetrying}
                        className="px-4 py-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-bold rounded-lg border border-green-500/20 transition-all active:scale-95 disabled:opacity-50"
                      >
                        Single Retry
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && data.pagination.total > limit && (
          <div className="flex items-center justify-between pt-8 border-t border-gray-800">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 glass-panel text-sm font-medium text-gray-400 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed rounded-xl border border-white/5"
            >
              ← Prev
            </button>
            <div className="text-xs font-mono text-gray-500">
              Page <span className="text-white font-bold">{page + 1}</span> of {Math.ceil(data.pagination.total / limit)}
            </div>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.pagination.hasMore}
              className="px-4 py-2 glass-panel text-sm font-medium text-gray-400 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed rounded-xl border border-white/5"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </Layout>
  );
}
