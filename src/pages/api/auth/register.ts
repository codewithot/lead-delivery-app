import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createLogger } from "@/lib/secureLogger";

const logger = createLogger('AuthRegister');

const prisma = new PrismaClient();

// Validation schema
const registerSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== "POST") {
        return res.status(405).json({ message: "Method not allowed" });
    }

    try {
        // 1. Validate input
        const { name, email, password } = registerSchema.parse(req.body);

        // 2. Check if user exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            if (existingUser.password) {
                return res
                    .status(409)
                    .json({ message: "User already exists. Please sign in." });
            } else {
                // User exists (e.g., from GHL) but hasn't set a password.
                // Option: Allow them to "claim" the account by setting a password?
                // For simplicity now, fail and tell them to login with GHL or Reset Password (future).
                // OR: Update the existing user with a password. Let's do that for smoother transition.
                const hashedPassword = await bcrypt.hash(password, 12);
                await prisma.user.update({
                    where: { email },
                    data: {
                        password: hashedPassword,
                        name: existingUser.name || name, // Keep existing name if present, else update
                    },
                });
                return res.status(200).json({ message: "Account updated with password successfully" });
            }
        }

        // 3. Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // 4. Create user
        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
            },
        });

        return res.status(201).json({ message: "User created successfully", userId: user.id });
    } catch (error: unknown) {
        logger.error("[register] Error", { error });
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: error.errors[0].message });
        }
        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        return res.status(500).json({ message: errorMessage });
    }
}
