// src/pages/settings.tsx
import { GetServerSideProps } from "next";
import { getSession, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/router";

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
  const { data: session } = useSession();
  const router = useRouter();

  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState(10);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(1000000);
  const planLimit = 100; // Fixed value, no longer state
  const [selectedZips, setSelectedZips] = useState<string[]>([]);

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

    if (res.ok) {
      alert("✅ Settings saved!");
      router.reload();
    } else {
      alert("❌ Failed to save settings.");
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">User Settings</h1>
        <Link
          href="/dashboard"
          className="text-blue-600 underline hover:text-blue-800"
        >
          Go to Dashboard
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-medium">ZIP Code</label>
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            className="w-full border rounded p-2"
          />
        </div>

        <div>
          <label className="block font-medium">Radius (miles)</label>
          <input
            type="number"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full border rounded p-2"
          />
        </div>

        {Array.isArray(nearbyZips) && nearbyZips.length > 0 && (
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="font-medium">Nearby ZIPs</label>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-sm text-blue-600 hover:underline"
              >
                Select All
              </button>
            </div>
            <div className="border rounded p-2 max-h-40 overflow-y-auto space-y-1">
              {nearbyZips.map((z) => (
                <label key={z} className="block">
                  <input
                    type="checkbox"
                    checked={selectedZips.includes(z)}
                    onChange={() => handleZipToggle(z)}
                    className="mr-2"
                  />
                  {z}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-600 text-sm">
            Error fetching ZIPs: {error.message}
          </div>
        )}

        <div>
          <label className="block font-medium">Price Min</label>
          <input
            type="number"
            value={priceMin}
            onChange={(e) => setPriceMin(Number(e.target.value))}
            className="w-full border rounded p-2"
          />
        </div>

        <div>
          <label className="block font-medium">Price Max</label>
          <input
            type="number"
            value={priceMax}
            onChange={(e) => setPriceMax(Number(e.target.value))}
            className="w-full border rounded p-2"
          />
        </div>

        <div>
          <label className="block font-medium">Plan Limit</label>
          <input
            type="number"
            value={100}
            readOnly
            className="w-full border rounded p-2 bg-gray-100 text-gray-600 cursor-not-allowed"
          />
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          Save Settings
        </button>
      </form>
    </div>
  );
}
