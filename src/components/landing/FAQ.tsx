
export default function FAQ() {
    return (
        <section className="py-24">
            <div className="container mx-auto px-4 max-w-4xl">
                <div className="text-center mb-16">
                    <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">Frequently Asked Questions</h2>
                </div>

                <div className="space-y-6">
                    {/* FAQ 1 */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                        <h3 className="text-xl font-bold text-white mb-4">How do I incorporate predictive seller leads into my marketing?</h3>
                        <div className="prose prose-invert text-gray-400 text-sm leading-relaxed">
                            <p className="mb-4">
                                Likely to List is the perfect companion to your current Circle Prospect Geographic prospecting.
                                You can incorporate it directly into your Just Listed, Just Sold, and Open House campaigns.
                            </p>
                            <p>
                                The predictive analytics simply ensure that you are targeting properties with a statistically
                                higher propensity to sell compared to other homes inside of your farm.
                                No longer wasting valuable time and marketing budgets on listings that are unlikely to place
                                their home on the market in the near future.
                            </p>
                        </div>
                    </div>

                    {/* FAQ 2 */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                        <h3 className="text-xl font-bold text-white mb-4">What attributes are used in the algorithm?</h3>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            Our proprietary algorithm analyzes hundreds of data points including owner demographics, life events,
                            financial information, and historical market data to calculate propensity to list.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}
