// pages/index.tsx
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header Section */}
      <header className="pt-12 pb-6">
        <div className="max-w-4xl mx-auto px-8 text-center">
          {/* ProEdge Logo */}
          <div className="flex justify-center mb-8">
            <Image
              src="/logo.png" // Make sure logo.png is in your /public folder
              alt="ProEdge Logo"
              width={80}
              height={80}
              className="drop-shadow-sm"
            />
          </div>

          {/* Main Heading */}
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            Hands‑Off Real‑Estate Lead Delivery
          </h1>

          {/* Description */}
          <p className="text-lg max-w-2xl mx-auto leading-relaxed mb-8 text-gray-600">
            Each night we refresh your property data and push only the leads you
            want into GoHighLevel.
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 pb-12">
        <div className="max-w-md w-full space-y-6">
          {/* Primary CTA */}
          <div className="text-center">
            <Link
              href="/auth/signin"
              className="inline-block w-full px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-colors duration-200 shadow-lg hover:shadow-xl"
            >
              Connect with GoHighLevel
            </Link>
          </div>

          {/* Secondary Action */}
          <div className="text-center">
            <p className="mb-2">Already connected?</p>
            <Link
              href="/dashboard"
              className="text-blue-600 underline hover:text-blue-700 transition-colors duration-200"
            >
              View your Dashboard
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="pb-8 text-center">
        <p className="text-sm text-gray-400">Powered by ProEdge</p>
      </footer>
    </div>
  );
}
