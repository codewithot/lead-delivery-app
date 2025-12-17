/**
 * Check if the current session user is an admin
 */
export function isAdmin(session) {
    return session?.user?.role === "ADMIN";
}
/**
 * Guard function to require admin access for API routes
 * Returns true if allowed, sends 403 response and returns false if denied
 */
export function requireAdmin(req, res, session) {
    if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return false;
    }
    if (!isAdmin(session)) {
        console.warn(`⛔ Non-admin user attempted admin action: ${session.user?.email}`);
        res.status(403).json({ error: "Forbidden - Admin access required" });
        return false;
    }
    return true;
}
