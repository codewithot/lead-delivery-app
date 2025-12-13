"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getValidAccessToken = getValidAccessToken;
// src/lib/ghlClient.ts
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const GHL_TOKEN_URL = "https://rest.gohighlevel.com/oauth/token";
const CLIENT_ID = process.env.GHL_CLIENT_ID;
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;
async function getValidAccessToken(user) {
    const { accessToken, refreshToken, tokenExpiresAt } = user;
    // 1️⃣ Ensure we actually have tokens and an expiry
    if (!accessToken || !refreshToken || !tokenExpiresAt) {
        throw new Error("Missing stored GHL credentials—accessToken, refreshToken or expiry.");
    }
    // 2️⃣ If we have >5 min left, just return the stored token
    const nowSec = Date.now() / 1000;
    const expiresSec = tokenExpiresAt.getTime() / 1000;
    if (expiresSec - nowSec > 300) {
        return accessToken;
    }
    // 3️⃣ Otherwise, refresh
    const resp = await axios_1.default.post(GHL_TOKEN_URL, {
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
    });
    const { access_token: newAccessToken, refresh_token: newRefreshToken, expires_in: newExpiresIn, } = resp.data;
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
