
import { GetServerSideProps } from "next";
import { getSession } from "next-auth/react";
import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/router";
import Layout from "../components/Layout";

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getSession(ctx);
  if (!session) {
    return {
      redirect: { destination: "/api/auth/signin", permanent: false },
    };
  }
  return { props: {} };
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error fetching data");
  return data;
};

export default function SettingsPage() {
  const router = useRouter();

  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState(10);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(1000000);
  const planLimit = 100; // Fixed value, no longer state
  const [selectedZips, setSelectedZips] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const { data: nearbyZips, error } = useSWR(
    zip ? `/api/zipcodes?zip=${zip}&radius=${radius}` : null,
    fetcher
  );

  const handleZipToggle = (z: string) => {
    setSelectedZips((prev) =>
      prev.includes(z) ? prev.filter((x) => x !== z) : [...prev, z]
    );
  };

  const handleSelectAll = () => {
    if (Array.isArray(nearbyZips)) {
      const allSelected = nearbyZips.every((z: string) =>
        selectedZips.includes(z)
      );
      setSelectedZips(allSelected ? [] : nearbyZips);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const res = await fetch("/api/user-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zipCodes: selectedZips,
        radius,
        priceMin,
        priceMax,
        planLimit,
      }),
    });

    setIsSaving(false);

    if (res.ok) {
      alert("✅ Settings saved!");
      router.reload();
    } else {
      alert("❌ Failed to save settings.");
    }
  };

  return (
    <Layout title="Settings - ProEdge">
      <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">

        <div className="flex justify-between items-center border-b border-gray-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">Config Settings</h1>
            <p className="text-gray-400 mt-1">Manage your lead filtering preferences</p>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-8 border border-gray-800">
          <form onSubmit={handleSubmit} className="space-y-8">

            {/* Location Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                Location Targeting
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Central ZIP Code</label>
                  <input
                    type="text"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="e.g. 90210"
                    className="w-full bg-black/40 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Radius (miles)</label>
                  <input
                    type="number"
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="w-full bg-black/40 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
              </div>

              {/* Zip Selection */}
              {Array.isArray(nearbyZips) && nearbyZips.length > 0 && (
                <div className="bg-black/20 rounded-xl p-4 border border-gray-700/50 mt-4">
                  <div className="flex justify-between items-center mb-3 border-b border-gray-700/50 pb-2">
                    <label className="font-medium text-gray-300">Targetable ZIPs Found</label>
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Select All
                    </button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-48 overflow-y-auto custom-scrollbar p-1">
                    {nearbyZips.map((z) => (
                      <label key={z} className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${selectedZips.includes(z) ? 'bg-blue-500/20 text-blue-200' : 'hover:bg-white/5 text-gray-400'}`}>
                        <input
                          type="checkbox"
                          checked={selectedZips.includes(z)}
                          onChange={() => handleZipToggle(z)}
                          className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-offset-gray-900"
                        />
                        <span className="text-sm">{z}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {error && (
                <div className="text-red-400 text-sm bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                  Targeting Error: {error.message}
                </div>
              )}
            </div>

            {/* Price Section */}
            <div className="space-y-4 pt-4 border-t border-gray-800">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-1 h-6 bg-purple-500 rounded-full"></span>
                Price Range
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Minimum Price ($)</label>
                  <input
                    type="number"
                    value={priceMin}
                    onChange={(e) => setPriceMin(Number(e.target.value))}
                    className="w-full bg-black/40 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Maximum Price ($)</label>
                  <input
                    type="number"
                    value={priceMax}
                    onChange={(e) => setPriceMax(Number(e.target.value))}
                    className="w-full bg-black/40 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Plan Limit (Read Only) */}
            <div className="space-y-4 pt-4 border-t border-gray-800 opacity-75">
              <h3 className="text-lg font-semibold text-gray-400">Account Limits</h3>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">Daily Push Limit</label>
                <input
                  type="number"
                  value={100}
                  readOnly
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-600 mt-2">Contact support to increase your limit.</p>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-6 border-t border-gray-800 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 transform active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
