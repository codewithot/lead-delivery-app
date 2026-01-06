
export default function Contact() {
    return (
        <section className="py-24 bg-gradient-to-t from-blue-900/20 to-transparent">
            <div className="container mx-auto px-4">

                <div className="flex flex-col lg:flex-row gap-16 max-w-6xl mx-auto">
                    {/* Contact Info */}
                    <div className="flex-1 space-y-8">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-4">Feel free to talk to us</h2>
                            <p className="text-gray-400">
                                Not sure what package works best for you? Need a custom solution?
                                Reach out to our experienced team of experts for a free consultation.
                            </p>
                        </div>

                        <div className="space-y-6">
                            {/* About Us Mini */}
                            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                                <h3 className="text-white font-bold mb-2">About Us</h3>
                                <p className="text-sm text-gray-400">
                                    ProEdge is the leading provider of Data leads for real estate agents across the country.
                                </p>
                            </div>

                            {/* Info */}
                            <div className="space-y-4">
                                <div className="flex items-center text-gray-300">
                                    <span className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center mr-4 text-blue-400">📍</span>
                                    <span>12600 Hill Country Blvd, Ste. R-130 #335, Austin, TX 78735</span>
                                </div>
                                <div className="flex items-center text-gray-300">
                                    <span className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center mr-4 text-blue-400">📞</span>
                                    <span>888-805-2991</span>
                                </div>
                                <div className="flex items-center text-gray-300">
                                    <span className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center mr-4 text-blue-400">✉️</span>
                                    <span>info@proedge.com</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Form */}
                    <div className="flex-1">
                        <form className="p-8 rounded-2xl bg-white/5 border border-white/10 space-y-6 shadow-2xl">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Full Name*</label>
                                <input type="text" className="w-full px-4 py-3 rounded-lg bg-black/20 border border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-white outline-none transition-all" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Email*</label>
                                <input type="email" className="w-full px-4 py-3 rounded-lg bg-black/20 border border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-white outline-none transition-all" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Subject*</label>
                                <input type="text" className="w-full px-4 py-3 rounded-lg bg-black/20 border border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-white outline-none transition-all" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Message*</label>
                                <textarea rows={4} className="w-full px-4 py-3 rounded-lg bg-black/20 border border-white/10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-white outline-none transition-all"></textarea>
                            </div>
                            <button className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg">
                                Send Message
                            </button>
                        </form>
                    </div>

                </div>
            </div>
        </section>
    );
}
