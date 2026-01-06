import Image from "next/image";
import Layout from "../components/Layout";
import Hero from "../components/landing/Hero";
import Features from "../components/landing/Features";
import Pricing from "../components/landing/Pricing";
import FAQ from "../components/landing/FAQ";
import Contact from "../components/landing/Contact";

export default function Home() {
  return (
    <Layout>
      <div className="flex flex-col">
        <Hero />
        <Features />

        {/* Screenshots Placeholder */}
        {/* Platform Interface */}
        <section className="py-20 bg-black/20 border-y border-white/5">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-2xl font-bold text-white mb-8 opacity-50 uppercase tracking-widest">Platform Interface</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl mx-auto">
              {/* Dashboard */}
              <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10 relative group">
                <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none"></div>
                <Image
                  src="/dashboard-preview.png"
                  alt="ProEdge Dashboard Interface"
                  width={800}
                  height={600}
                  className="w-full h-auto"
                  unoptimized
                />
                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs text-white border border-white/10">
                  Real-time Dashboard
                </div>
              </div>

              {/* Map View */}
              <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10 relative group">
                <div className="absolute inset-0 bg-green-500/5 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none"></div>
                <Image
                  src="/map-preview.png"
                  alt="Lead Map Visualization"
                  width={800}
                  height={600}
                  className="w-full h-auto"
                  unoptimized
                />
                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs text-white border border-white/10">
                  Interactive Lead Map
                </div>
              </div>
            </div>
          </div>
        </section>

        <Pricing />
        <FAQ />
        <Contact />
      </div>
    </Layout>
  );
}
