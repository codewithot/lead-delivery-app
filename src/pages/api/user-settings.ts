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
  // Check request method early
  if (req.method !== "PUT" && req.method !== "GET") {
    logger.warn("Invalid method", { method: req.method });
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Validate CSRF token only for state-changing requests (PUT)
  if (req.method === "PUT") {
    const csrfToken = req.headers["x-csrf-token"];
    const validToken = await getCsrfToken({ req });
    if (csrfToken !== validToken) {
      logger.warn("Invalid CSRF token");
      return res.status(403).json({ error: "Invalid CSRF token" });
    }
  }

  try {
    logger.info("API called", { method: req.method, url: req.url, version: "SANITIZED_V3" });

    // Try to get session
    let session;
    try {
      session = await getServerSession(req, res, authOptions);
    } catch (error) {
      logger.error("Error getting session", { error });
      return res.status(500).json({ error: "Failed to get session" });
    }

    if (!session?.user?.email) {
      logger.warn("No session or user email found");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { settings: true }
    });

    if (!user) {
      logger.warn("User not found for email", { email: session.user.email });
      return res.status(404).json({ error: "User not found" });
    }

    // Handle GET request - return settings
    if (req.method === "GET") {
      const settings = user.settings;
      if (!settings) {
        return res.status(200).json({
          zipCodes: [],
          radius: 10,
          priceMin: 0,
          priceMax: 1000000,
          planLimit: 100
        });
      }

      return res.status(200).json({
        zipCodes: settings.zipCodes,
        radius: settings.radiusMiles,
        priceMin: settings.priceMin,
        priceMax: settings.priceMax,
        planLimit: settings.planLimit
      });
    }

    // Handle PUT request (Update)
    else if (req.method === "PUT") {
      // Extract body only for PUT
      const { zipCodes, radius, priceMin, priceMax, planLimit } = req.body as {
        zipCodes: string[];
        radius: number;
        priceMin: number;
        priceMax: number;
        planLimit: number;
      };

      const validationErrors = [];
      if (!Array.isArray(zipCodes)) validationErrors.push(`zipCodes is ${typeof zipCodes}`);
      if (typeof radius !== "number") validationErrors.push(`radius is ${typeof radius}`);
      if (typeof priceMin !== "number") validationErrors.push(`priceMin is ${typeof priceMin}`);
      if (typeof priceMax !== "number") validationErrors.push(`priceMax is ${typeof priceMax}`);
      if (typeof planLimit !== "number") validationErrors.push(`planLimit is ${typeof planLimit}`);

      if (validationErrors.length > 0) {
        logger.warn("Invalid payload structure", { errors: validationErrors, body: req.body });
        return res.status(400).json({ error: `Invalid payload: ${validationErrors.join(', ')}` });
      }

      // Sanitize integers to prevent Postgres overflow (MAX INT ~2.14B)
      const MAX_INT = 2147483647;
      const safeRadius = Math.min(Math.max(0, radius), MAX_INT);
      const safePriceMin = Math.min(Math.max(0, priceMin), MAX_INT);
      const safePriceMax = Math.min(Math.max(0, priceMax), MAX_INT);
      const safePlanLimit = Math.min(Math.max(0, planLimit), MAX_INT);

      const upserted = await prisma.userSettings.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          zipCodes,
          radiusMiles: safeRadius,
          priceMin: safePriceMin,
          priceMax: safePriceMax,
          planLimit: safePlanLimit,
        },
        update: {
          zipCodes,
          radiusMiles: safeRadius,
          priceMin: safePriceMin,
          priceMax: safePriceMax,
          planLimit: safePlanLimit,
        },
      });

      logger.info("UserSettings upserted", { id: upserted.id });
      return res.status(200).json({ message: "Settings saved." });
    }

    return res.status(405).json({ error: "Method logic error" });

  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    logger.error("Error during DB operation", { message: e.message, stack: e.stack, meta: e.meta });
    return res.status(500).json({ error: `Something went wrong: ${e.message}` });
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
