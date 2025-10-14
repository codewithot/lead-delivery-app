// pages/api/auth/clear-tokens.ts
import { getServerSession } from "next-auth";
import { authOptions } from "./[...nextauth]";

export default async function handler(req: any, res: any) {
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
