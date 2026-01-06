
const plans = [
    {
        name: "Neighborhood Basic",
        price: "49",
        tagline: "Getting Started",
        features: [
            "Occupant Name and Phones",
            "Unlimited Searches",
            "Phone and Email",
            "No long term contracts",
        ],
        highlight: false,
        trial: "14 Day Trial Available"
    },
    {
        name: "Premium Neighborhood",
        price: "99",
        tagline: "Most Popular",
        features: [
            "Mobile Phones & Emails",
            "Absentee Owners",
            "Likely to List Algorithm",
            "Month-to-month",
        ],
        highlight: true,
        trial: "14 Day Trial"
    },
    {
        name: "Circle Prospecting Pros",
        price: "99",
        tagline: "Integration Ready",
        features: [
            "Landline, VOIP, Mobile",
            "Owner Name & Address",
            "3rd Party Integrations",
            "No contracts",
        ],
        highlight: false,
        trial: "14 Day Trial, no contracts"
    }
];

export default function Pricing() {
    return (
        <section className="py-24 relative overflow-hidden">
            {/* Background Elements */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-blue-600/10 blur-[100px] rounded-full -z-10"></div>

            <div className="container mx-auto px-4">
                <div className="text-center mb-16">
                    <h2 className="text-3xl lg:text-5xl font-bold text-white mb-4">How much does it cost?</h2>
                    <p className="text-gray-400">Choose the package that fits your goals.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {plans.map((plan, idx) => (
                        <div
                            key={idx}
                            className={`relative p-8 rounded-2xl flex flex-col ${plan.highlight
                                    ? 'bg-gradient-to-b from-blue-900/40 to-gray-900 border-2 border-blue-500 shadow-2xl scale-105 z-10'
                                    : 'bg-white/5 border border-white/10 hover:border-white/20'
                                }`}
                        >
                            {plan.highlight && (
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1 bg-blue-500 rounded-full text-xs font-bold text-white uppercase tracking-wider">
                                    Likely to List Included
                                </div>
                            )}

                            <div className="mb-8">
                                <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                                <p className="text-sm text-gray-400">{plan.tagline}</p>
                            </div>

                            <div className="flex items-baseline mb-8">
                                <span className="text-5xl font-bold text-white">${plan.price}</span>
                                <span className="text-gray-400 ml-2">/ MO</span>
                            </div>

                            <ul className="space-y-4 mb-8 flex-1">
                                {plan.features.map((feat, i) => (
                                    <li key={i} className="flex items-start text-sm text-gray-300">
                                        <svg className="w-5 h-5 text-green-500 mr-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        {feat}
                                    </li>
                                ))}
                            </ul>

                            <div className="mt-auto pt-8 border-t border-gray-800">
                                <p className="text-xs text-center text-blue-300 mb-4 font-medium">{plan.trial}</p>
                                <button className={`w-full py-4 rounded-xl font-bold transition-all ${plan.highlight
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/40'
                                        : 'bg-white/10 hover:bg-white/20 text-white'
                                    }`}>
                                    Try It Free
                                </button>
                            </div>

                            {plan.highlight && (
                                <p className="text-xs text-center text-gray-500 mt-4 px-4 leading-tight">
                                    * Likely to List is Currently FREE to Active Subscribers of a Neighborhood Product
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
