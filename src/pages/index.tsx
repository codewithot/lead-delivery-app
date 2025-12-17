
import Image from "next/image";
import Link from "next/link";
import Layout from "../components/Layout";

export default function Home() {
  return (
    <Layout>
      <div className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-20 py-12 lg:py-24 animate-fade-in">

        {/* Left Column: Content */}
        <div className="flex-1 text-center lg:text-left space-y-8 max-w-2xl">

          <div className="space-y-4">
            <h2 className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
              Automated Data Pipeline
            </h2>
            <h1 className="text-5xl lg:text-7xl font-bold leading-tight tracking-tight text-white">
              Hands-Off <br />
              <span className="text-gradient">Real-Estate Lead</span> <br />
              Delivery
            </h1>
          </div>

          <p className="text-xl text-gray-400 leading-relaxed max-w-lg mx-auto lg:mx-0">
            Stop manually importing CSVs. Each night, we refresh your property data
            and push high-quality leads directly into your GoHighLevel CRM.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start pt-4">
            <Link
              href="/auth/signin"
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] transform hover:-translate-y-1"
            >
              Connect with GoHighLevel
            </Link>
            <Link
              href="/dashboard"
              className="px-8 py-4 glass-panel hover:bg-white/10 text-white font-semibold rounded-xl transition-all border border-white/10 hover:border-white/20"
            >
              View Dashboard
            </Link>
          </div>

          {/* Trust Indicators / Stats */}
          <div className="pt-8 grid grid-cols-2 md:grid-cols-3 gap-8 border-t border-gray-800/50 mt-8">
            <div>
              <p className="text-3xl font-bold text-white">100%</p>
              <p className="text-sm text-gray-500">Automated</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">Daily</p>
              <p className="text-sm text-gray-500">Sync Intervals</p>
            </div>
            <div className="hidden md:block">
              <p className="text-3xl font-bold text-white">Secure</p>
              <p className="text-sm text-gray-500">OAuth 2.0</p>
            </div>
          </div>
        </div>

        {/* Right Column: Visual */}
        <div className="flex-1 w-full max-w-xl relative animate-slide-up">
          <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full -z-10 mix-blend-screen" />
          <div className="relative glass-panel rounded-2xl p-2 shadow-2xl overflow-hidden border border-white/10">
            <Image
              src="/hero-visual.png"
              alt="Data Visualization"
              width={800}
              height={800}
              className="rounded-xl w-full h-auto object-cover"
              priority
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
