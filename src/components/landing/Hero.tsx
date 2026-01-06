import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";

export default function Hero() {
    const { data: session } = useSession();

    return (
        <section className="relative pt-20 pb-32 overflow-hidden">
            <div className="container mx-auto px-4">
                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">

                    {/* Content */}
                    <div className="flex-1 text-center lg:text-left space-y-8 max-w-2xl z-10">
                        <h1 className="text-5xl lg:text-7xl font-bold leading-tight tracking-tight text-white animate-fade-in-up">
                            Predictive Analytics and <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">
                                Real Estate Leads
                            </span>
                        </h1>

                        <p className="text-xl text-gray-400 leading-relaxed animate-fade-in-up delay-100">
                            Uncover new real estate leads before they hit the market.
                            Identify home seller leads with a high propensity to list.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start pt-4 animate-fade-in-up delay-200">
                            {session ? (
                                <Link
                                    href="/dashboard"
                                    className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-emerald-500/30 transform hover:-translate-y-1 flex items-center justify-center gap-2 group"
                                >
                                    <span>Go to Dashboard</span>
                                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                </Link>
                            ) : (
                                <>
                                    <Link
                                        href="/auth/signup"
                                        className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-blue-500/30 transform hover:-translate-y-1"
                                    >
                                        Start Your Trial
                                    </Link>
                                    <Link
                                        href="/auth/signin"
                                        className="px-8 py-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold rounded-xl transition-all backdrop-blur-sm"
                                    >
                                        Login
                                    </Link>
                                </>
                            )}
                        </div>

                        <p className="text-sm text-gray-500 pt-4 max-w-lg mx-auto lg:mx-0">
                            ProEdge proprietary algorithm analyzes hundreds of attributes
                            including owner, demographic, life event, and financial information.
                        </p>
                    </div>

                    {/* Visual */}
                    <div className="flex-1 w-full max-w-xl relative animate-fade-in-up delay-300">
                        <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full -z-10 mix-blend-screen animate-pulse-slow"></div>
                        <div className="relative glass-panel rounded-2xl p-2 shadow-2xl border border-white/10 bg-gray-900/50 backdrop-blur-xl">
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
            </div>
        </section>
    );
}
