# Scripts Directory - README

## 🛠️ Primary Development Tool

### **dev-utils.ts** - All-in-One Utility CLI
Consolidated utility for common development and debugging tasks.

```bash
npx tsx scripts/dev-utils.ts <command> [email]
```

### Available Commands

#### Job Management
- **`jobs:status`** - Check status of jobs (both pg-boss and app table)
- **`jobs:list`** - List all pg-boss jobs by name and state  
- **`jobs:reset`** - Reset failed/stuck jobs to pending state

#### Property Management
- **`properties:list`** - List all properties with push status
- **`properties:debug [email]`** - Debug property matching for a specific user

#### System Utilities
- **`redis:clear`** - Clear Redis rate limiter keys
- **`queue:provision`** - Manually trigger queue provisioning
- **`schema:check`** - Check pg-boss database schema

#### User/Token Management
- **`tokens:check [email]`** - Check GHL OAuth tokens for a user
- **`tokens:clear [email]`** - Clear tokens to force re-authentication

#### Data Operations  
- **`data:stats`** - Show database statistics (totals, pushed/unpushed)
- **`data:duplicates`** - Find duplicate properties by address

### Examples
```bash
# Check job status
npx tsx scripts/dev-utils.ts jobs:status

# Reset all failed jobs
npx tsx scripts/dev-utils.ts jobs:reset

# Debug property matching for a specific user
npx tsx scripts/dev-utils.ts properties:debug user@example.com

# Clear tokens for a user to force re-auth
npx tsx scripts/dev-utils.ts tokens:clear user@example.com

# View database statistics
npx tsx scripts/dev-utils.ts data:stats
```

---

## 🔧 Specialized Scripts

### **reset-for-fresh-run.ts** ⚠️ DESTRUCTIVE
Complete system reset - clears all data and resets state.
```bash
npx tsx scripts/reset-for-fresh-run.ts
```
**Warning:** This will delete all jobs, properties, and reset state. Use with caution!

### **fix-missing-associations.ts**
Repairs missing GHL contact-property associations.
```bash
npx tsx scripts/fix-missing-associations.ts
```
Use this when properties exist in GHL but aren't associated with contacts.

---

## 📝 Notes
- **dev-utils.ts** covers 95% of daily development needs
- Specialized scripts handle destructive operations or complex data repairs
- Email parameter defaults to `victoryikuomola@gmail.com` if not provided
