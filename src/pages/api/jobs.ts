// src/pages/api/jobs.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    console.log("Session in /api/jobs:", session);

    const userId = session?.user?.userId;

    if (!userId) {
      console.warn("Missing userId in session");
      return res.status(401).json({ error: "Unauthorized - missing userId" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.warn("User not found for ID:", userId);
      return res.status(404).json({ error: "User not found" });
    }

    const jobs = await prisma.job.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    console.log(`Found ${jobs.length} jobs for user ${userId}`);
    return res.status(200).json(jobs);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
