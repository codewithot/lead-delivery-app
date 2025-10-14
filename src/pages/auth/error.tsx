// src/pages/auth/error.tsx
import { useRouter } from "next/router";
import Link from "next/link";

const errors = {
  Configuration: "There is a problem with the server configuration.",
  AccessDenied: "You do not have permission to sign in.",
  Verification: "The sign in link is no longer valid.",
  Default: "Unable to sign in.",
};

export default function AuthError() {
  const router = useRouter();
  const { error } = router.query;

  const errorMessage =
    error && errors[error as keyof typeof errors]
      ? errors[error as keyof typeof errors]
      : errors.Default;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Authentication Error
          </h2>
          <p className="mt-2 text-center text-sm text-red-600">
            {errorMessage}
          </p>
          {error && (
            <p className="mt-1 text-center text-xs text-gray-500">
              Error code: {error}
            </p>
          )}
        </div>
        <div className="mt-8 space-y-6">
          <Link
            href="/auth/signin"
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Try Again
          </Link>
        </div>
      </div>
    </div>
  );
}
