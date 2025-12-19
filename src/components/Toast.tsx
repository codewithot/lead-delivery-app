import React, { useEffect } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
    message: string;
    type: ToastType;
    onClose: () => void;
    duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 3000 }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [onClose, duration]);

    const styles = {
        success: 'bg-green-500/10 border-green-500/50 text-green-400',
        error: 'bg-red-500/10 border-red-500/50 text-red-400',
        info: 'bg-blue-500/10 border-blue-500/50 text-blue-400',
    };

    return (
        <div className={`fixed bottom-8 right-8 z-[100] p-4 rounded-xl border backdrop-blur-md shadow-2xl flex items-center gap-3 animate-slide-up ${styles[type]}`}>
            {type === 'success' && (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            )}
            {type === 'error' && (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            )}
            <p className="text-sm font-medium">{message}</p>
            <button onClick={onClose} className="ml-2 hover:opacity-70 transition-opacity">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
};
