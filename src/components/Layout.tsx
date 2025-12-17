
import React from 'react';
import Head from 'next/head';

import Link from 'next/link';
import { useRouter } from 'next/router';

interface LayoutProps {
    children: React.ReactNode;
    title?: string;
}

export default function Layout({ children, title = "ProEdge - Hands-Off Lead Delivery" }: LayoutProps) {
    const router = useRouter();

    const isActive = (path: string) => router.pathname === path;

    return (
        <div className="min-h-screen flex flex-col font-sans">
            <Head>
                <title>{title}</title>
                <meta name="description" content="Automated Real-Estate Lead Delivery to GoHighLevel" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            {/* Header */}
            <header className="fixed top-0 w-full z-50 glass-panel border-b-0 border-b-slate-800/50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        {/* Logo */}
                        <div className="flex-shrink-0 flex items-center">
                            <Link href="/" className="flex items-center gap-2">
                                {/* Placeholder for logo if exists, or text fallback */}
                                {/* <Image src="/logo.png" alt="ProEdge" width={32} height={32} /> */}
                                <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                                    ProEdge
                                </span>
                            </Link>
                        </div>

                        {/* Navigation */}
                        <nav className="hidden md:flex space-x-8">
                            <NavLink href="/dashboard" active={isActive('/dashboard')}>Dashboard</NavLink>
                            <NavLink href="/settings" active={isActive('/settings')}>Settings</NavLink>
                        </nav>

                        {/* Auth / Action */}
                        <div className="flex items-center space-x-4">
                            <Link
                                href="/auth/signin"
                                className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
                            >
                                Sign In
                            </Link>
                            <Link
                                href="/dashboard"
                                className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all shadow-lg hover:shadow-blue-500/25"
                            >
                                Get Started
                            </Link>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
                {children}
            </main>

            {/* Footer */}
            <footer className="border-t border-gray-800 bg-black/20 backdrop-blur-sm mt-auto">
                <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
                    <p className="text-center text-gray-500 text-sm">
                        &copy; {new Date().getFullYear()} ProEdge. All rights reserved.
                    </p>
                </div>
            </footer>
        </div>
    );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
    return (
        <Link
            href={href}
            className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${active
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-700'
                }`}
        >
            {children}
        </Link>
    );
}
