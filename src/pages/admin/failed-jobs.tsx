// src/pages/admin/failed-jobs.tsx
import { GetServerSideProps } from "next";
import { getSession } from "next-auth/react";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";

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
        alert(`✅ Job ${jobId} queued for retry`);
        mutate(`/api/jobs/failed?limit=${limit}&offset=${page * limit}`);
        setSelectedJobs((prev) => {
          const newSet = new Set(prev);
          newSet.delete(jobId);
          return newSet;
        });
      } else {
        const error = await response.json();
        alert(`❌ Failed to retry job: ${error.error}`);
      }
    } catch (error) {
      alert(`❌ Error retrying job: ${error}`);
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
        alert(
          `✅ Retried ${result.results.successful.length} jobs\n` +
            `❌ Failed: ${result.results.failed.length}`
        );
        mutate(`/api/jobs/failed?limit=${limit}&offset=${page * limit}`);
        setSelectedJobs(new Set());
      } else {
        const error = await response.json();
        alert(`❌ Bulk retry failed: ${error.error}`);
      }
    } catch (error) {
      alert(`❌ Error retrying jobs: ${error}`);
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-2 text-gray-800">Loading failed jobs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-4">
        <div className="bg-red-50 border border-red-300 rounded-md p-4">
          <p className="text-red-900 font-medium">
            Failed to load jobs: {error.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Failed Jobs</h1>
          <p className="text-gray-600 mt-1">
            {data?.pagination.total || 0} failed jobs total
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard"
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors"
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      {/* Actions */}
      {data && data.jobs.length > 0 && (
        <div className="bg-white border border-gray-300 rounded-lg p-4 mb-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedJobs.size === data.jobs.length}
                onChange={handleSelectAll}
                className="w-4 h-4"
              />
              <span className="font-medium">
                {selectedJobs.size === 0
                  ? "Select All"
                  : `${selectedJobs.size} Selected`}
              </span>
            </label>
          </div>

          {selectedJobs.size > 0 && (
            <button
              onClick={handleBulkRetry}
              disabled={isRetrying}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isRetrying
                ? "Retrying..."
                : `Retry ${selectedJobs.size} Job${
                    selectedJobs.size === 1 ? "" : "s"
                  }`}
            </button>
          )}
        </div>
      )}

      {/* Jobs List */}
      {!data || data.jobs.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-300 rounded-lg">
          <p className="text-gray-600 text-lg">✅ No failed jobs</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.jobs.map((job) => (
            <div
              key={job.id}
              className={`bg-white border rounded-lg p-4 transition-all ${
                selectedJobs.has(job.id)
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selectedJobs.has(job.id)}
                  onChange={() => handleSelectJob(job.id)}
                  className="mt-1 w-4 h-4"
                />

                {/* Job Info */}
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-mono text-sm text-gray-800">
                        {job.id}
                      </h3>
                      <p className="text-sm text-gray-600">{job.type}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-500">
                        Attempts: {job.attempts}/{job.maxAttempts}
                      </span>
                      <p className="text-xs text-gray-500">
                        User: {job.User.email || job.User.name || job.userId}
                      </p>
                    </div>
                  </div>

                  {/* Error */}
                  {job.lastError && (
                    <div className="bg-red-50 border border-red-200 rounded p-2 mb-2">
                      <p className="text-sm font-medium text-red-900">Error:</p>
                      <p className="text-xs text-red-700 font-mono">
                        {job.lastError}
                      </p>
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>
                      Created: {new Date(job.createdAt).toLocaleString()}
                    </span>
                    <span>
                      Failed: {new Date(job.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <button
                  onClick={() => handleRetryJob(job.id)}
                  disabled={isRetrying}
                  className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Retry
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pagination.total > limit && (
        <div className="mt-6 flex justify-between items-center">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>

          <span className="text-gray-600">
            Page {page + 1} of {Math.ceil(data.pagination.total / limit)}
          </span>

          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!data.pagination.hasMore}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
