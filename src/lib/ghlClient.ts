// src/lib/ghlClient.ts
import axios from "axios";
import { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/secureLogger";

const logger = createLogger('GHLClient');
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const CLIENT_ID = process.env.GHL_CLIENT_ID!;
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET!;

export async function getValidAccessToken(user: User, correlationId?: string): Promise<string> {
  const scopedLogger = correlationId ? logger.withCorrelationId(correlationId) : logger;

  const { accessToken, refreshToken, tokenExpiresAt } = user;

  // 1️⃣ Ensure we actually have tokens and an expiry
  if (!accessToken || !refreshToken || !tokenExpiresAt) {
    throw new Error(
      "Missing stored GHL credentials—accessToken, refreshToken or expiry."
    );
  }

  // 2️⃣ If we have >5 min left, just return the stored token
  const nowSec = Date.now() / 1000;
  const expiresSec = tokenExpiresAt.getTime() / 1000;
  if (expiresSec - nowSec > 300) {
    return accessToken;
  }

  // 3️⃣ Otherwise, refresh
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const resp = await axios.post(
    GHL_TOKEN_URL,
    params,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: parseInt(process.env.TIMEOUT || "30000")
    }
  );

  scopedLogger.info("Refreshed access token", { userId: user.id });

  const {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    expires_in: newExpiresIn,
  } = resp.data;

  // 4️⃣ Persist fresh tokens
  await prisma.user.update({
    where: { id: user.id },
    data: {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenExpiresAt: new Date(Date.now() + newExpiresIn * 1000),
    },
  });

  return newAccessToken;
}
