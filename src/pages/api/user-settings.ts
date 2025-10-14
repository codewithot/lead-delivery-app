import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log("API called:", req.method, req.url);

  // Check request method early
  if (req.method !== "PUT") {
    console.log("Invalid method:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Try to get session
  let session;
  try {
    session = await getServerSession(req, res, authOptions);
  } catch (error) {
    console.error("Error getting session:", error);
    return res.status(500).json({ error: "Failed to get session" });
  }
  console.log("Session object [user-settings]:", session);

  if (!session) {
    console.log("No session found");
    return res.status(401).json({ error: "Unauthorized - No session" });
  }

  if (!session?.user?.email) {
    console.log("Session user missing email:", session?.user);
    return res.status(401).json({ error: "Unauthorized - No user email" });
  }

  const { zipCodes, radius, priceMin, priceMax, planLimit } = req.body as {
    zipCodes: string[];
    radius: number;
    priceMin: number;
    priceMax: number;
    planLimit: number;
  };

  if (
    !Array.isArray(zipCodes) ||
    typeof radius !== "number" ||
    typeof priceMin !== "number" ||
    typeof priceMax !== "number" ||
    typeof planLimit !== "number"
  ) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  console.log("Request body:", {
    zipCodes,
    radius,
    priceMin,
    priceMax,
    planLimit,
  });

  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      console.log("User not found for email:", session.user.email);
      return res.status(404).json({ error: "User not found" });
    }

    console.log("Found user:", user.email);

    const upserted = await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        zipCodes,
        radiusMiles: radius, // ← map radius → radiusMiles
        priceMin,
        priceMax,
        planLimit,
      },
      update: {
        zipCodes,
        radiusMiles: radius, // ← and here as well
        priceMin,
        priceMax,
        planLimit,
      },
    });

    console.log("UserSettings upserted:", upserted);
    return res.status(200).json({ message: "Settings saved." });
  } catch (err) {
    console.error("Error during DB operation:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
