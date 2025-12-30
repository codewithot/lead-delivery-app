import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { PrismaClient } from "@prisma/client";
import { getCsrfToken } from "next-auth/react";
import { withRateLimit } from "@/lib/apiRateLimiter";
import { createLogger } from "@/lib/secureLogger";

const logger = createLogger('UserSettings');

const prisma = new PrismaClient();

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const csrfToken = req.headers["x-csrf-token"];
  const validToken = await getCsrfToken({ req });
  if (csrfToken !== validToken) {
    logger.warn("Invalid CSRF token");
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  logger.info("API called", { method: req.method, url: req.url });

  // Check request method early
  if (req.method !== "PUT") {
    logger.warn("Invalid method", { method: req.method });
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Try to get session
  let session;
  try {
    session = await getServerSession(req, res, authOptions);
  } catch (error) {
    logger.error("Error getting session", { error });
    return res.status(500).json({ error: "Failed to get session" });
  }
  logger.debug("Session object", { session });

  if (!session) {
    logger.warn("No session found");
    return res.status(401).json({ error: "Unauthorized - No session" });
  }

  if (!session?.user?.email) {
    logger.warn("Session user missing email", { user: session?.user });
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


  logger.info("Request body validated", {
    zipCodes: zipCodes.length,
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
      logger.warn("User not found for email", { email: session.user.email });
      return res.status(404).json({ error: "User not found" });
    }

    logger.debug("Found user", { email: user.email });

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



    logger.info("UserSettings upserted", { id: upserted.id });
    return res.status(200).json({ message: "Settings saved." });
  } catch (err) {
    logger.error("Error during DB operation", { error: err });
    return res.status(500).json({ error: "Something went wrong" });
  }
}

// ✅ Wrap with rate limiting - WRITE tier: 30 requests/minute
export default withRateLimit(handler, {
  tier: 'WRITE',
  getUserId: async (req) => {
    try {
      const session = await getServerSession(req, {} as NextApiResponse, authOptions);
      return session?.user?.userId;
    } catch {
      return undefined;
    }
  },
});
