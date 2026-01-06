
const features = [
    {
        title: "Big Data, Automated Delivery",
        description: "Our ingestion engine processes property data nightly, normalizing and verifying hundreds of attributes before pushing consistent, high-quality leads directly to your CRM.",
        icon: (
            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
        ),
    },
    {
        title: "Accurate Contact Information",
        description: "We focus on data integrity. Our multi-stage verification process ensures you receive accurate owner names, mailing addresses, and contact details, formatted for immediate engagement.",
        icon: (
            <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
        ),
    },
    {
        title: "Find Your Target",
        description: "Configure your exact buy box with advanced filtering. Set precise Price Ranges, Search Radius, and Zip Codes to only receive leads that match your specific investment criteria.",
        icon: (
            <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
        ),
    },
    {
        title: "Fill Your Pipeline",
        description: "Automate your prospecting with our reliable daily delivery system. Leads are synced to your GoHighLevel account every morning, ensuring a steady stream of opportunities regardless of market conditions.",
        icon: (
            <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
        ),
    },
];

export default function Features() {
    return (
        <section className="py-24 bg-gray-900/30">
            <div className="container mx-auto px-4">

                {/* Intro Text */}
                <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
                    <h2 className="text-3xl lg:text-4xl font-bold text-white">
                        Driven by Predictable Intelligence
                    </h2>
                    <p className="text-gray-400 leading-relaxed">
                        Our platform orchestrates a seamless pipeline from raw data to actionable leads.
                        By combining nightly data ingestion with your trusted HighLevel CRM, we ensure
                        you are efficiently prospecting to sellers with the highest propensity to sell.
                    </p>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {features.map((feature, idx) => (
                        <div
                            key={idx}
                            className="p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-blue-500/30 transition-all group"
                        >
                            <div className="w-12 h-12 rounded-lg bg-gray-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                {feature.icon}
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">
                                {feature.description}
                            </p>
                        </div>
                    ))}
                </div>

            </div>
        </section>
    );
}
