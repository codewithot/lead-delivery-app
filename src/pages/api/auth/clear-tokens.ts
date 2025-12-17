import { NextApiRequest, NextApiResponse } from "next";
import { withRateLimit } from "@/lib/apiRateLimiter";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Clear the session cookie
  res.setHeader("Set-Cookie", [
    "next-auth.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    "next-auth.csrf-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
  ]);

  return res.status(200).json({ message: "Tokens cleared" });
}

// ✅ Wrap with rate limiting - AUTH tier: 5 requests per 5 minutes
export default withRateLimit(handler, {
  tier: 'AUTH',
});
