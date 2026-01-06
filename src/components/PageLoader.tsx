import { useEffect, useState } from "react";

export default function PageLoader() {
    const [show, setShow] = useState(false);

    useEffect(() => {
        // Small delay to prevent flashing on instant navigations
        const timer = setTimeout(() => setShow(true), 100);
        return () => clearTimeout(timer);
    }, []);

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950">
            <div className="absolute inset-0 animate-pulse bg-zinc-900/50 backdrop-blur-sm" />
            <div className="relative z-10 flex flex-col items-center gap-4">
                {/* Abstract pulsating shape */}
                <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 opacity-80 animate-ping" />
                <div className="text-sm font-medium text-zinc-400 animate-pulse">
                    Loading...
                </div>
            </div>
        </div>
    );
}
