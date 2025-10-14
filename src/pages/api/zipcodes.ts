import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import haversine from "haversine-distance";

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<string[] | { error: string }>
) {
  const { zip, radius } = req.query;

  if (typeof zip !== "string" || typeof radius !== "string") {
    return res.status(400).json({ error: "zip and radius required" });
  }

  const miles = Number(radius);
  if (isNaN(miles) || miles <= 0) {
    return res.status(400).json({ error: "radius must be a positive number" });
  }

  // 1️⃣ Look up center ZIP in DB
  const center = await prisma.zipCode.findUnique({ where: { code: zip } });
  if (!center) {
    return res.status(404).json({ error: `ZIP ${zip} not found in database` });
  }

  // 2️⃣ Narrow down by bounding box
  const degreeDelta = miles / 69; // Approx. latitude degrees per mile
  const candidates = await prisma.zipCode.findMany({
    where: {
      latitude: {
        gte: center.latitude - degreeDelta,
        lte: center.latitude + degreeDelta,
      },
      longitude: {
        gte: center.longitude - degreeDelta,
        lte: center.longitude + degreeDelta,
      },
    },
  });

  // 3️⃣ Filter with Haversine distance
  const nearby = candidates
    .filter((z) => {
      const distMeters = haversine(
        { latitude: center.latitude, longitude: center.longitude },
        { latitude: z.latitude, longitude: z.longitude }
      );
      return distMeters / 1609.34 <= miles;
    })
    .map((z) => z.code);

  return res.status(200).json(nearby);
}
