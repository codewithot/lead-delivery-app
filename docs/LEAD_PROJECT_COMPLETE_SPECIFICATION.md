# GoHighLevel Real-Estate Leads Delivery Platform
## Complete Technical Specification & Implementation Guide

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Database Schema](#database-schema)
5. [Implementation Blueprint](#implementation-blueprint)
6. [Concurrent Delivery System](#concurrent-delivery-system)
7. [Daily Lead Queues (pg-boss)](#daily-lead-queues)
8. [Security & Reliability](#security-reliability)
9. [Deployment & Operations](#deployment-operations)
10. [Future Roadmap](#future-roadmap)

---

## Executive Summary

### Project Overview

A two-part automated lead delivery solution that ingests nightly property data feeds and delivers filtered leads to GoHighLevel (GHL) based on user-specific criteria.

**Key Capabilities:**
- Automated nightly data ingestion from FTP sources
- User-configurable filtering (ZIP codes, radius, price ranges)
- Batch delivery to GoHighLevel CRM
- Job tracking with retry logic
- Dashboard for monitoring and configuration

**Expected Scale:**
- ~50 concurrent users at launch
- Daily batch processing with 7:00 AM deadline
- 10 concurrent workers processing batches of 10 leads

---

## System Architecture

### High-Level Components

```
┌─────────────────────┐
│   FTP Server        │
│  (CSV/XLSX Data)    │
└──────────┬──────────┘
           │ Nightly Download
           ▼
┌─────────────────────┐
│  Express.js         │
│  Ingestion Service  │◄─── Cron Scheduler
└──────────┬──────────┘
           │ Webhook (Secure)
           ▼
┌─────────────────────┐
│   Next.js App       │
│  - Webhook Endpoint │
│  - Job Queue        │
│  - User Interface   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     ┌──────────────┐
│  PostgreSQL + PgBoss│────►│  Worker Pool │
│  - Properties       │     │  (10 Workers)│
│  - Contacts         │     └──────┬───────┘
│  - Jobs Queue       │            │
│  - User Settings    │            │
└─────────────────────┘            │
                                   ▼
                          ┌────────────────┐
                          │  GoHighLevel   │
                          │  API (OAuth)   │
                          └────────────────┘
```

### Component Responsibilities

| Component | Primary Responsibilities |
|-----------|-------------------------|
| **Express.js Ingestion** | • Scheduled nightly FTP downloads<br>• Parse CSV/XLSX files<br>• Upsert data to PostgreSQL<br>• Trigger webhook on completion |
| **Next.js Webhook** | • Validate webhook security<br>• Create delivery jobs<br>• Track job status |
| **Worker Pool** | • Poll pending jobs<br>• Filter properties per user settings<br>• Batch push to GHL<br>• Handle retries and errors |
| **User Interface** | • OAuth onboarding<br>• ZIP/radius configuration<br>• Price range filters<br>• Delivery history dashboard |

---

## Core Components

### 1. Express.js Ingestion Microservice

**Purpose:** Automated nightly data ingestion and processing

**Key Features:**
- Scheduled execution via cron or scheduler
- FTP connection and file download
- CSV/XLSX parsing with validation
- Prisma-based upsert operations
- Secure webhook notification

**Workflow:**
```javascript
// Nightly process
1. Connect to FTP server
2. Download latest CSV/XLSX files
3. Parse and validate data
4. Upsert to PostgreSQL (Contact + Property tables)
5. Create IngestionRun record
6. POST webhook to Next.js app
7. Log WebhookLog entry
```

**Webhook Call:**
```javascript
POST https://your-next-app.com/api/ingest-complete
Headers: { 
  'X-Hook-Secret': <shared_secret>,
  'Content-Type': 'application/json'
}
Body: { 
  ingestedAt: new Date().toISOString(),
  rowCount: 1234,
  runId: 567
}
```

---

### 2. Next.js Lead Delivery Application

**Tech Stack:**
- Next.js (API Routes + React UI)
- Prisma ORM
- PostgreSQL
- NextAuth.js (GHL OAuth)

**Core Responsibilities:**

#### A. Webhook Endpoint (`/api/ingest-complete`)
```javascript
// Validates webhook and creates job
export default async function handler(req, res) {
  // 1. Verify X-Hook-Secret
  if (req.headers['x-hook-secret'] !== process.env.HOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // 2. Create delivery job
  const job = await prisma.job.create({
    data: {
      type: 'deliver-leads',
      payload: req.body,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3
    }
  });
  
  // 3. Respond quickly
  res.status(200).json({ jobId: job.id });
}
```

#### B. Job Processing Worker
```javascript
// Polls and processes jobs
async function processJobs() {
  while (true) {
    // 1. Find pending job
    const job = await prisma.job.findFirst({
      where: {
        status: { in: ['pending', 'failed'] },
        attempts: { lt: maxAttempts }
      }
    });
    
    if (!job) {
      await sleep(60000); // Wait 1 minute
      continue;
    }
    
    // 2. Mark in progress
    await prisma.job.update({
      where: { id: job.id },
      data: { 
        status: 'in_progress',
        attempts: { increment: 1 }
      }
    });
    
    try {
      // 3. Process each user
      const users = await prisma.user.findMany({
        include: { settings: true }
      });
      
      for (const user of users) {
        await deliverLeadsForUser(user, job.payload);
      }
      
      // 4. Mark complete
      await prisma.job.update({
        where: { id: job.id },
        data: { 
          status: 'completed',
          finishedAt: new Date()
        }
      });
    } catch (error) {
      // 5. Handle failure
      await prisma.job.update({
        where: { id: job.id },
        data: { 
          status: job.attempts >= maxAttempts ? 'failed' : 'pending',
          lastError: error.message
        }
      });
    }
  }
}
```

#### C. Lead Delivery Logic
```javascript
async function deliverLeadsForUser(user, payload) {
  const { ingestedAt } = payload;
  
  // 1. Query matching properties
  const properties = await prisma.property.findMany({
    where: {
      createdAt: { gte: new Date(ingestedAt) },
      postalCode: { in: user.settings.zipCodes },
      price: {
        gte: user.settings.priceMin,
        lte: user.settings.priceMax
      },
      pushed: false
    },
    include: { owner: true }
  });
  
  // 2. Apply plan limits
  const limited = properties.slice(0, user.settings.planLimit);
  
  // 3. Push to GHL
  for (const property of limited) {
    await pushToGHL(user, property);
    
    // Mark as pushed
    await prisma.property.update({
      where: { id: property.id },
      data: { pushed: true }
    });
  }
}
```

---

## Database Schema

### Core Tables

```prisma
// Prisma Schema

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  name            String?
  accessToken     String?   // GHL OAuth token
  refreshToken    String?
  tokenExpiresAt  DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  settings        UserSettings?
  jobs            Job[]
}

model UserSettings {
  id          Int      @id @default(autoincrement())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id])
  zipCodes    String[] // Array of ZIP codes
  priceMin    Float?
  priceMax    Float?
  planType    String   // e.g., "5-pack", "10-pack"
  planLimit   Int      // Max leads per batch
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Contact {
  id              Int       @id @default(autoincrement())
  firstName       String?
  lastName        String?
  email           String?
  phone           String?
  companyName     String?
  pushed          Boolean   @default(false)
  ghlContactId    String?   // GHL contact ID after push
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  properties      Property[]
}

model Property {
  id                      Int       @id @default(autoincrement())
  ownerId                 Int?
  owner                   Contact?  @relation(fields: [ownerId], references: [id])
  
  // Address fields
  streetAddress           String?
  city                    String?
  state                   String?
  postalCode              String
  county                  String?
  
  // Property details
  price                   Float?
  bedrooms                String?
  bathrooms               String?
  aboveGradeFinishedSqft  String?
  yearBuilt               Int?
  propertyType            String?
  
  // Valuation fields
  taxValue                String?
  automatedValue          Float?
  estimatedEquity         Float?
  
  // Status
  pushed                  Boolean   @default(false)
  ghlPropertyId           String?   // GHL property ID
  
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt
  
  @@index([postalCode])
  @@index([price])
  @@index([pushed])
}

model ZipCode {
  id        Int      @id @default(autoincrement())
  zipCode   String   @unique
  latitude  Float
  longitude Float
  city      String?
  state     String?
  createdAt DateTime @default(now())
}

model Job {
  id          String    @id @default(cuid())
  type        String    // 'deliver-leads'
  payload     Json      // { ingestedAt, runId, etc. }
  status      String    @default("pending") // pending | in_progress | completed | failed
  attempts    Int       @default(0)
  maxAttempts Int       @default(3)
  lastError   String?
  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?
  updatedAt   DateTime  @updatedAt
  userId      String?
  user        User?     @relation(fields: [userId], references: [id])
  
  @@index([status, attempts])
}

model IngestionRun {
  id         Int       @id @default(autoincrement())
  startedAt  DateTime  @default(now())
  finishedAt DateTime?
  status     String    @default("running") // running | succeeded | failed
  rowCount   Int?
  error      String?
  webhookLogs WebhookLog[]
}

model WebhookLog {
  id           Int       @id @default(autoincrement())
  runId        Int
  run          IngestionRun @relation(fields: [runId], references: [id])
  sentAt       DateTime  @default(now())
  responseCode Int?
  responseBody String?
}
```

---

## Implementation Blueprint

### Phase 1: Database Setup & Core Models

**Step 1.1: Initialize Prisma**
```bash
npm install prisma @prisma/client
npx prisma init
```

**Step 1.2: Define Schema**
- Copy schema from Database Schema section above
- Add any custom fields needed

**Step 1.3: Run Migrations**
```bash
npx prisma migrate dev --name init
npx prisma generate
```

**Step 1.4: Seed Test Data**
```javascript
// prisma/seed.ts
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Create test user
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      name: 'Test User',
      settings: {
        create: {
          zipCodes: ['10001', '10002', '10003'],
          priceMin: 100000,
          priceMax: 500000,
          planType: '10-pack',
          planLimit: 10
        }
      }
    }
  });
  
  // Create test properties
  for (let i = 0; i < 50; i++) {
    await prisma.property.create({
      data: {
        postalCode: ['10001', '10002', '10003'][i % 3],
        price: 150000 + (i * 10000),
        streetAddress: `${i} Main Street`,
        city: 'New York',
        state: 'NY',
        bedrooms: '3',
        bathrooms: '2'
      }
    });
  }
}

main();
```

---

### Phase 2: Express.js Ingestion Service

**Step 2.1: Project Setup**
```bash
mkdir ingestion-service
cd ingestion-service
npm init -y
npm install express prisma @prisma/client ftp csv-parser xlsx node-cron
npm install --save-dev typescript @types/node @types/express
npx tsc --init
```

**Step 2.2: FTP Download Script**
```typescript
// src/ftp/download.ts
import * as ftp from 'basic-ftp';
import * as fs from 'fs';

export async function downloadFromFTP() {
  const client = new ftp.Client();
  
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: true
    });
    
    const files = await client.list('/data');
    const latestFile = files
      .filter(f => f.name.endsWith('.csv'))
      .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    
    if (latestFile) {
      await client.downloadTo(
        `/tmp/${latestFile.name}`,
        `/data/${latestFile.name}`
      );
      return `/tmp/${latestFile.name}`;
    }
  } finally {
    client.close();
  }
}
```

**Step 2.3: CSV Parser**
```typescript
// src/parsers/csvParser.ts
import * as fs from 'fs';
import * as csv from 'csv-parser';

interface PropertyRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode: string;
  price?: string;
  bedrooms?: string;
  bathrooms?: string;
  // ... all other fields
}

export async function parseCSV(filepath: string): Promise<PropertyRow[]> {
  const rows: PropertyRow[] = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(filepath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}
```

**Step 2.4: Database Upsert Logic**
```typescript
// src/db/upsert.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function upsertData(rows: PropertyRow[]) {
  const runId = await createRun();
  let count = 0;
  
  try {
    for (const row of rows) {
      // Upsert contact
      const contact = await prisma.contact.upsert({
        where: { email: row.email || `${row.firstName}-${row.lastName}` },
        create: {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone
        },
        update: {
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone
        }
      });
      
      // Create property
      await prisma.property.create({
        data: {
          ownerId: contact.id,
          streetAddress: row.streetAddress,
          city: row.city,
          state: row.state,
          postalCode: row.postalCode,
          price: parseFloat(row.price || '0'),
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms
          // ... map all fields
        }
      });
      
      count++;
    }
    
    await completeRun(runId, count);
    return { runId, count };
  } catch (error) {
    await failRun(runId, error.message);
    throw error;
  }
}

async function createRun() {
  const run = await prisma.ingestionRun.create({
    data: { status: 'running' }
  });
  return run.id;
}

async function completeRun(id: number, count: number) {
  await prisma.ingestionRun.update({
    where: { id },
    data: { 
      status: 'succeeded',
      finishedAt: new Date(),
      rowCount: count
    }
  });
}

async function failRun(id: number, error: string) {
  await prisma.ingestionRun.update({
    where: { id },
    data: { 
      status: 'failed',
      finishedAt: new Date(),
      error
    }
  });
}
```

**Step 2.5: Webhook Notification**
```typescript
// src/webhook/notify.ts
import axios from 'axios';

export async function notifyNextApp(runId: number, rowCount: number) {
  const response = await axios.post(
    process.env.NEXT_APP_URL + '/api/ingest-complete',
    {
      ingestedAt: new Date().toISOString(),
      runId,
      rowCount
    },
    {
      headers: {
        'X-Hook-Secret': process.env.HOOK_SECRET,
        'Content-Type': 'application/json'
      }
    }
  );
  
  // Log webhook call
  await prisma.webhookLog.create({
    data: {
      runId,
      sentAt: new Date(),
      responseCode: response.status,
      responseBody: JSON.stringify(response.data)
    }
  });
  
  return response.data;
}
```

**Step 2.6: Main Ingestion Script**
```typescript
// src/index.ts
import { downloadFromFTP } from './ftp/download';
import { parseCSV } from './parsers/csvParser';
import { upsertData } from './db/upsert';
import { notifyNextApp } from './webhook/notify';

async function main() {
  console.log('[Ingestion] Starting...');
  
  try {
    // 1. Download
    console.log('[Ingestion] Downloading from FTP...');
    const filepath = await downloadFromFTP();
    
    // 2. Parse
    console.log('[Ingestion] Parsing CSV...');
    const rows = await parseCSV(filepath);
    
    // 3. Upsert
    console.log('[Ingestion] Upserting to database...');
    const { runId, count } = await upsertData(rows);
    
    // 4. Notify
    console.log('[Ingestion] Notifying Next.js app...');
    await notifyNextApp(runId, count);
    
    console.log(`[Ingestion] Complete! Processed ${count} rows`);
  } catch (error) {
    console.error('[Ingestion] Error:', error);
    process.exit(1);
  }
}

main();
```

**Step 2.7: Schedule with Cron**
```javascript
// src/scheduler.ts
import cron from 'node-cron';
import { main } from './index';

// Run every night at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('[Scheduler] Running nightly ingestion...');
  await main();
});

console.log('[Scheduler] Cron job scheduled for 2 AM daily');
```

---

### Phase 3: Next.js Application

**Step 3.1: Initialize Next.js**
```bash
npx create-next-app@latest lead-delivery-app
cd lead-delivery-app
npm install prisma @prisma/client next-auth pg-boss
npm install --save-dev typescript @types/node @types/react
```

**Step 3.2: Webhook Endpoint**
```typescript
// pages/api/ingest-complete.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify secret
  const secret = req.headers['x-hook-secret'];
  if (secret !== process.env.HOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { ingestedAt, runId, rowCount } = req.body;
  
  try {
    // Create delivery job
    const job = await prisma.job.create({
      data: {
        type: 'deliver-leads',
        payload: { ingestedAt, runId, rowCount },
        status: 'pending'
      }
    });
    
    res.status(200).json({ 
      success: true, 
      jobId: job.id 
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
```

**Step 3.3: GHL OAuth Setup**
```typescript
// pages/api/auth/[...nextauth].ts
import NextAuth from 'next-auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default NextAuth({
  providers: [
    {
      id: 'ghl',
      name: 'GoHighLevel',
      type: 'oauth',
      authorization: {
        url: 'https://marketplace.gohighlevel.com/oauth/chooselocation',
        params: {
          scope: 'contacts.write contacts.readonly',
          response_type: 'code'
        }
      },
      token: {
        url: 'https://services.leadconnectorhq.com/oauth/token'
      },
      userinfo: {
        url: 'https://services.leadconnectorhq.com/users/me'
      },
      clientId: process.env.GHL_CLIENT_ID,
      clientSecret: process.env.GHL_CLIENT_SECRET,
      profile(profile, tokens) {
        return {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token
        };
      }
    }
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account && user) {
        // Store tokens in database
        await prisma.user.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            email: user.email,
            name: user.name,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            tokenExpiresAt: new Date(account.expires_at * 1000)
          },
          update: {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            tokenExpiresAt: new Date(account.expires_at * 1000)
          }
        });
      }
      return token;
    }
  }
});
```

**Step 3.4: User Settings Page**
```typescript
// pages/settings.tsx
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

export default function Settings() {
  const { data: session } = useSession();
  const [zipCodes, setZipCodes] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState<number>(0);
  const [priceMax, setPriceMax] = useState<number>(1000000);
  
  async function saveSettings() {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zipCodes,
        priceMin,
        priceMax,
        planType: '10-pack',
        planLimit: 10
      })
    });
  }
  
  return (
    <div>
      <h1>Settings</h1>
      <form onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
        <label>
          ZIP Codes (comma separated):
          <input 
            value={zipCodes.join(',')} 
            onChange={(e) => setZipCodes(e.target.value.split(','))}
          />
        </label>
        
        <label>
          Min Price:
          <input 
            type="number" 
            value={priceMin} 
            onChange={(e) => setPriceMin(Number(e.target.value))}
          />
        </label>
        
        <label>
          Max Price:
          <input 
            type="number" 
            value={priceMax} 
            onChange={(e) => setPriceMax(Number(e.target.value))}
          />
        </label>
        
        <button type="submit">Save Settings</button>
      </form>
    </div>
  );
}
```

---

## Concurrent Delivery System

### Architecture Decision

**Requirements:**
- 50 concurrent users
- Process batches efficiently
- Predictable memory usage
- No external dependencies (Redis)

**Solution: pg-boss with PostgreSQL**

**Configuration:**
```javascript
// Recommended setup
WORKER_COUNT=10           // Number of worker processes
JOB_CONCURRENCY=10        // Jobs per worker
BATCH_SIZE=10             // Leads per batch
MAX_OLD_SPACE_SIZE=768    // Node.js heap limit (MB)
JOB_PG_POOL_MAX=6         // PostgreSQL connection pool
```

### Worker Implementation

```typescript
// src/workers/worker.ts
import PgBoss from 'pg-boss';
import { PrismaClient } from '@prisma/client';
import { processLeadBatch } from './handlers/leadBatch';

const prisma = new PrismaClient();

async function main() {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.JOB_PG_POOL_MAX || 6),
    application_name: 'lead-worker'
  });
  
  await boss.start();
  
  const concurrency = Number(process.env.JOB_CONCURRENCY || 10);
  
  await boss.work(
    'deliver-leads-batch',
    { concurrency, retryLimit: 3, retryDelay: 60000 },
    async (job) => {
      console.log(`Processing job ${job.id}`);
      await processLeadBatch(job.data);
    }
  );
  
  console.log(`Worker started with concurrency=${concurrency}`);
}

main().catch(err => {
  console.error('Worker error:', err);
  process.exit(1);
});
```

### Batch Processing Handler

```typescript
// src/workers/handlers/leadBatch.ts
import { PrismaClient } from '@prisma/client';
import { pushToGHL } from '../integrations/ghl';

const prisma = new PrismaClient();

export async function processLeadBatch(payload: any) {
  const { userId, batchIndex, batchSize } = payload;
  
  // 1. Get user and settings
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { settings: true }
  });
  
  if (!user?.settings) {
    throw new Error('User or settings not found');
  }
  
  // 2. Calculate offset for this batch
  const offset = batchIndex * batchSize;
  
  // 3. Query properties for this batch
  const properties = await prisma.property.findMany({
    where: {
      price: {
        gte: user.settings.priceMin || 0,
        lte: user.settings.priceMax || Number.MAX_SAFE_INTEGER
      },
      postalCode: { in: user.settings.zipCodes },
      pushed: false
    },
    include: { owner: true },
    skip: offset,
    take: batchSize
  });
  
  console.log(`Batch ${batchIndex}: Processing ${properties.length} properties`);
  
  // 4. Push each property to GHL
  for (const property of properties) {
    try {
      await pushToGHL(user, property);
      
      // Mark as pushed
      await prisma.property.update({
        where: { id: property.id },
        data: { pushed: true }
      });
    } catch (error) {
      console.error(`Failed to push property ${property.id}:`, error);
      // Continue with next property
    }
  }
}
```

### Memory Monitoring

```typescript
// src/workers/monitoring.ts
export function setupMemoryMonitoring() {
  setInterval(() => {
    const usage = process.memoryUsage();
    console.log('Memory:', {
      rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(usage.external / 1024 / 1024)}MB`
    });
  }, 10000); // Every 10 seconds
}
```

---

## Daily Lead Queues

### Feature Overview

**Objective:** Process daily lead distribution with hard deadline of 7:00 AM local time

**Key Requirements:**
- Timezone-aware scheduling
- Idempotent queue provisioning
- Deadline monitoring and alerts
- Predictable memory usage

### Timezone Configuration

```bash
# Environment variables
REGION_TZ=America/New_York
DATABASE_URL=postgresql://...
JOB_CONCURRENCY=10
JOB_PG_POOL_MAX=6
```

### Queue Naming Convention

```
leads:assign:YYYYMMDD
```

Examples:
- `leads:assign:20250115` - January 15, 2025
- `leads:assign:20250116` - January 16, 2025

### Implementation

#### 1. Date/Time Utilities

```typescript
// src/utils/datetime.ts
import { DateTime } from 'luxon';

export function todayYYYYMMDD(tz: string): string {
  return DateTime.now().setZone(tz).toFormat('yyyyLLdd');
}

export function deadlineDateTime(tz: string): DateTime {
  return DateTime.now()
    .setZone(tz)
    .set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
}

export function minutesUntilDeadline(tz: string): number {
  const now = DateTime.now().setZone(tz);
  const deadline = deadlineDateTime(tz);
  return Math.floor(deadline.diff(now, 'minutes').minutes);
}
```

#### 2. Queue Provisioning Script

```typescript
// src/jobs/provisionDailyQueues.ts
import PgBoss from 'pg-boss';
import { DateTime } from 'luxon';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tz = process.env.REGION_TZ || 'America/New_York';

async function main() {
  const yyyymmdd = DateTime.now().setZone(tz).toFormat('yyyyLLdd');
  const queueName = `leads:assign:${yyyymmdd}`;
  
  console.log(`Provisioning queue: ${queueName}`);
  
  const boss = new PgBoss({ 
    connectionString: process.env.DATABASE_URL 
  });
  
  await boss.start();
  
  try {
    // Get all users
    const users = await prisma.user.findMany({
      include: { settings: true }
    });
    
    // Get new properties for each user
    for (const user of users) {
      if (!user.settings) continue;
      
      const properties = await prisma.property.findMany({
        where: {
          postalCode: { in: user.settings.zipCodes },
          price: {
            gte: user.settings.priceMin || 0,
            lte: user.settings.priceMax || Number.MAX_SAFE_INTEGER
          },
          pushed: false
        },
        take: user.settings.planLimit,
        include: { owner: true }
      });
      
      // Enqueue job for each property
      for (const property of properties) {
        await boss.send(
          queueName,
          {
            userId: user.id,
            contactId: property.ownerId,
            propertyId: property.id,
            date: yyyymmdd
          },
          {
            singletonKey: `${property.id}:${yyyymmdd}` // Idempotency
          }
        );
      }
      
      console.log(`Enqueued ${properties.length} jobs for user ${user.id}`);
    }
    
    console.log(`Provisioning complete for ${queueName}`);
  } finally {
    await boss.stop();
  }
}

main().catch(err => {
  console.error('Provisioning error:', err);
  process.exit(1);
});
```

#### 3. Daily Queue Worker

```typescript
// src/jobs/dailyWorker.ts
import PgBoss from 'pg-boss';
import { DateTime } from 'luxon';
import { handleLeadAssignment } from './handlers/leadAssignment';

const tz = process.env.REGION_TZ || 'America/New_York';

function getTodayQueueName(): string {
  const date = DateTime.now().setZone(tz).toFormat('yyyyLLdd');
  return `leads:assign:${date}`;
}

async function main() {
  const queueName = getTodayQueueName();
  
  console.log(`Worker binding to queue: ${queueName}`);
  
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.JOB_PG_POOL_MAX || 6),
    application_name: 'daily-lead-worker'
  });
  
  await boss.start();
  
  const concurrency = Number(process.env.JOB_CONCURRENCY || 10);
  
  await boss.work(
    queueName,
    { 
      concurrency,
      retryLimit: 5,
      retryDelay: 30000
    },
    handleLeadAssignment
  );
  
  console.log(`Worker started for ${queueName} with concurrency=${concurrency}`);
  
  // Monitor deadline
  setInterval(() => {
    const minutesLeft = minutesUntilDeadline(tz);
    console.log(`Minutes until 7:00 AM deadline: ${minutesLeft}`);
    
    if (minutesLeft <= 30) {
      console.warn('⚠️ Approaching deadline!');
    }
  }, 60000); // Check every minute
}

main().catch(err => {
  console.error('Worker error:', err);
  process.exit(1);
});
```

#### 4. Lead Assignment Handler

```typescript
// src/jobs/handlers/leadAssignment.ts
import { PrismaClient } from '@prisma/client';
import { pushToGHL } from '../../integrations/ghl';

const prisma = new PrismaClient();

export async function handleLeadAssignment(job: any) {
  const { userId, contactId, propertyId, date } = job.data;
  
  console.log(`Processing lead assignment: ${propertyId} for user ${userId}`);
  
  // 1. Get user with tokens
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });
  
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  
  // 2. Get property and contact
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { owner: true }
  });
  
  if (!property) {
    throw new Error(`Property ${propertyId} not found`);
  }
  
  // 3. Push to GHL
  await pushToGHL(user, property);
  
  // 4. Mark as pushed
  await prisma.property.update({
    where: { id: propertyId },
    data: { pushed: true }
  });
  
  console.log(`✅ Successfully pushed property ${propertyId} to GHL`);
}
```

### Scheduling (Cron)

```bash
# crontab -e
SHELL=/bin/bash
REGION_TZ=America/New_York

# Provision queues at 6:00 AM
0 6 * * * TZ="$REGION_TZ" node /app/dist/jobs/provisionDailyQueues.js >> /var/log/provision.log 2>&1

# Start worker at 6:01 AM
1 6 * * * TZ="$REGION_TZ" node --max-old-space-size=768 /app/dist/jobs/dailyWorker.js >> /var/log/worker.log 2>&1

# Retry provisioning at 6:10 AM (if initial failed)
10 6 * * * TZ="$REGION_TZ" node /app/dist/jobs/provisionDailyQueues.js >> /var/log/provision.log 2>&1

# Final retry at 6:20 AM
20 6 * * * TZ="$REGION_TZ" node /app/dist/jobs/provisionDailyQueues.js >> /var/log/provision.log 2>&1
```

### Idempotency Implementation

```typescript
// src/lib/idempotency.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function checkIdempotency(
  queueName: string,
  idempotencyKey: string
): Promise<boolean> {
  try {
    await prisma.jobIdempotency.create({
      data: {
        queueName,
        idempotencyKey,
        processedAt: new Date()
      }
    });
    return true; // Can process
  } catch (error) {
    // Unique constraint violation - already processed
    return false;
  }
}

// Schema addition needed:
// model JobIdempotency {
//   id              Int      @id @default(autoincrement())
//   queueName       String
//   idempotencyKey  String
//   processedAt     DateTime @default(now())
//   
//   @@unique([queueName, idempotencyKey])
// }
```

### Deadline Monitoring

```typescript
// src/jobs/monitoring/deadline.ts
import { DateTime } from 'luxon';
import PgBoss from 'pg-boss';

const tz = process.env.REGION_TZ || 'America/New_York';

export async function monitorDeadline(boss: PgBoss, queueName: string) {
  const deadline = DateTime.now()
    .setZone(tz)
    .set({ hour: 7, minute: 0, second: 0 });
  
  const now = DateTime.now().setZone(tz);
  const minutesLeft = Math.floor(deadline.diff(now, 'minutes').minutes);
  
  // Get queue depth
  const queueSize = await boss.getQueueSize(queueName);
  
  console.log({
    time: now.toISO(),
    minutesUntilDeadline: minutesLeft,
    queueDepth: queueSize,
    queueName
  });
  
  // Alert if approaching deadline with work remaining
  if (minutesLeft <= 30 && queueSize > 0) {
    console.error('🚨 ALERT: Approaching deadline with work remaining!', {
      minutesLeft,
      queueSize
    });
    
    // Send alert (email, Slack, etc.)
    await sendAlert({
      message: 'Lead delivery may miss 7:00 AM deadline',
      minutesLeft,
      queueSize
    });
  }
}

// Run every minute
setInterval(() => {
  const queueName = getTodayQueueName();
  monitorDeadline(boss, queueName);
}, 60000);
```

---

## Security & Reliability

### 1. Webhook Security

**Shared Secret Validation:**
```typescript
// Both services must have same secret
// Express.js: sends X-Hook-Secret header
// Next.js: validates X-Hook-Secret header

// .env (both services)
HOOK_SECRET=your-super-secret-key-here

// Validation
if (req.headers['x-hook-secret'] !== process.env.HOOK_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### 2. OAuth Token Management

**Token Storage:**
```typescript
// Store encrypted tokens in database
model User {
  accessToken     String?   @db.Text
  refreshToken    String?   @db.Text
  tokenExpiresAt  DateTime?
}
```

**Token Refresh:**
```typescript
// src/integrations/ghl/tokenManager.ts
export async function ensureValidToken(user: User): Promise<string> {
  // Check if token is expired
  if (user.tokenExpiresAt && user.tokenExpiresAt < new Date()) {
    // Refresh token
    const tokens = await refreshGHLToken(user.refreshToken);
    
    // Update database
    await prisma.user.update({
      where: { id: user.id },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000)
      }
    });
    
    return tokens.access_token;
  }
  
  return user.accessToken;
}

async function refreshGHLToken(refreshToken: string) {
  const response = await fetch(
    'https://services.leadconnectorhq.com/oauth/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.GHL_CLIENT_ID,
        client_secret: process.env.GHL_CLIENT_SECRET
      })
    }
  );
  
  return response.json();
}
```

### 3. Database Connection Pooling

```typescript
// Prisma connection pooling
// schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  
  // Connection pool settings
  connection_limit = 20
}

// Runtime configuration
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});
```

### 4. Error Handling & Retries

**Job Retry Configuration:**
```typescript
await boss.work(
  'deliver-leads',
  {
    teamSize: 10,
    teamConcurrency: 10,
    retryLimit: 3,
    retryDelay: 60,        // 1 minute
    retryBackoff: true,    // Exponential backoff
    expireInHours: 24      // Job expires after 24 hours
  },
  handler
);
```

**Graceful Error Handling:**
```typescript
async function handleJob(job) {
  try {
    await processJob(job);
  } catch (error) {
    // Log detailed error
    console.error('Job failed:', {
      jobId: job.id,
      error: error.message,
      stack: error.stack,
      data: job.data
    });
    
    // Re-throw to trigger retry
    throw error;
  }
}
```

---

## Deployment & Operations

### Environment Setup

**Development (.env.local):**
```bash
# Database
DATABASE_URL=postgresql://localhost:5432/leads_dev

# Next.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-key

# GHL OAuth
GHL_CLIENT_ID=your-dev-client-id
GHL_CLIENT_SECRET=your-dev-client-secret

# Webhook Security
HOOK_SECRET=dev-hook-secret

# Worker Configuration
JOB_CONCURRENCY=5
JOB_PG_POOL_MAX=6

# Timezone
REGION_TZ=America/New_York
```

**Production (.env.production):**
```bash
# Database (use connection pooling service)
DATABASE_URL=postgresql://user:pass@prod-db.example.com:5432/leads_prod?pgbouncer=true

# Next.js
NEXTAUTH_URL=https://leads.yourdomain.com
NEXTAUTH_SECRET=production-secret-key-use-crypto.randomBytes(32)

# GHL OAuth (production credentials)
GHL_CLIENT_ID=prod-client-id
GHL_CLIENT_SECRET=prod-client-secret

# Webhook Security (strong secret)
HOOK_SECRET=production-hook-secret-use-crypto.randomBytes(32)

# Worker Configuration (scaled for production)
WORKER_COUNT=10
JOB_CONCURRENCY=10
JOB_PG_POOL_MAX=6

# Timezone
REGION_TZ=America/New_York

# Memory Limits
NODE_OPTIONS=--max-old-space-size=768
```

### Deployment Architecture

**Option 1: VPS/VM Deployment**
```
┌─────────────────────────────────────┐
│         Load Balancer (Nginx)        │
│  - SSL/TLS Termination               │
│  - Rate Limiting                     │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│      Next.js App (PM2)               │
│  - Port 3000                         │
│  - 2 instances (cluster mode)        │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   Worker Pool (PM2)                  │
│  - 10 worker processes               │
│  - Each with concurrency=10          │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│      PostgreSQL Database             │
│  - Connection pooling (PgBouncer)    │
│  - Daily backups                     │
└─────────────────────────────────────┘
```

**PM2 Configuration:**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'next-app',
      script: 'npm',
      args: 'start',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'workers',
      script: './dist/workers/worker.js',
      instances: 10,
      exec_mode: 'cluster',
      node_args: '--max-old-space-size=768',
      env: {
        NODE_ENV: 'production',
        JOB_CONCURRENCY: 10
      }
    },
    {
      name: 'ingestion',
      script: './ingestion-service/dist/scheduler.js',
      instances: 1,
      cron_restart: '0 2 * * *',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
```

**Option 2: Cloud Platform (Vercel + Railway)**
```
Vercel (Next.js App)
  ↓
Railway (PostgreSQL + Workers)
  - Database: PostgreSQL with automatic backups
  - Worker Service: 10 instances
  - Ingestion Service: Scheduled cron
```

### Monitoring & Alerting

**Health Checks:**
```typescript
// pages/api/health.ts
export default async function handler(req, res) {
  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;
    
    // Check pg-boss
    const queueSize = await boss.getQueueSize('deliver-leads');
    
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      queueSize,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
}
```

**Metrics Logging:**
```typescript
// Log every 10 seconds
setInterval(() => {
  const metrics = {
    timestamp: new Date().toISOString(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    },
    queue: {
      depth: queueDepth,
      processing: activeJobs
    },
    deadline: {
      minutesRemaining: minutesUntilDeadline(REGION_TZ)
    }
  };
  
  console.log('METRICS:', JSON.stringify(metrics));
}, 10000);
```

**Alerting Configuration:**
```typescript
// src/monitoring/alerts.ts
export async function sendAlert(alert: {
  level: 'warning' | 'error' | 'critical';
  message: string;
  details: any;
}) {
  // Email via SendGrid
  await sendEmail({
    to: process.env.ALERT_EMAIL,
    subject: `[${alert.level.toUpperCase()}] Lead Delivery Alert`,
    body: `
      Message: ${alert.message}
      Details: ${JSON.stringify(alert.details, null, 2)}
      Time: ${new Date().toISOString()}
    `
  });
  
  // Slack webhook
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🚨 ${alert.level.toUpperCase()}: ${alert.message}`,
      attachments: [
        {
          color: alert.level === 'critical' ? 'danger' : 'warning',
          text: JSON.stringify(alert.details, null, 2)
        }
      ]
    })
  });
}
```

### Backup & Recovery

**Database Backups:**
```bash
#!/bin/bash
# backup.sh - Daily database backup

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/backups
DB_NAME=leads_prod

# Create backup
pg_dump $DATABASE_URL > $BACKUP_DIR/backup_$DATE.sql

# Compress
gzip $BACKUP_DIR/backup_$DATE.sql

# Upload to S3
aws s3 cp $BACKUP_DIR/backup_$DATE.sql.gz s3://your-bucket/backups/

# Clean up old backups (keep 30 days)
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +30 -delete

echo "Backup completed: backup_$DATE.sql.gz"
```

**Scheduled via cron:**
```
0 3 * * * /scripts/backup.sh >> /var/log/backup.log 2>&1
```

---

## Future Roadmap

### Phase 1 (Current) - Core Functionality ✅
- [x] Basic ingestion pipeline
- [x] Job queue with pg-boss
- [x] User authentication (GHL OAuth)
- [x] Manual settings configuration
- [x] Basic lead delivery to GHL

### Phase 2 (Q2 2025) - Enhanced Features
- [ ] **GHL Custom Objects Support**
  - Push properties as structured objects (not just contact fields)
  - Support complex relationships
  
- [ ] **Advanced Filtering**
  - Radius-based ZIP lookup via Google Geocoding API
  - Property type filters
  - Date range filters
  
- [ ] **Plan Enforcement**
  - Automatic lead limiting based on user's plan tier
  - Usage tracking and notifications
  - Upgrade prompts

### Phase 3 (Q3 2025) - Analytics & Intelligence
- [ ] **Dashboard Analytics**
  - Lead delivery metrics
  - Conversion tracking
  - Performance insights
  
- [ ] **AI-Powered Features**
  - Lead scoring based on historical data
  - Predictive analytics for best leads
  - Automated follow-up suggestions

### Phase 4 (Q4 2025) - Scale & Performance
- [ ] **Horizontal Scaling**
  - Multi-region deployment
  - Job queue sharding
  - Database read replicas
  
- [ ] **Advanced Integrations**
  - Multiple CRM support (beyond GHL)
  - Zapier/Make.com webhooks
  - API for third-party integrations

### Phase 5 (2026) - Enterprise Features
- [ ] **White Label Solution**
  - Custom branding
  - Multi-tenant architecture
  - Reseller portal
  
- [ ] **Advanced Workflows**
  - Custom automation rules
  - Conditional lead routing
  - Team collaboration features

---

## Appendix

### A. GoHighLevel API Reference

**Base URL:**
```
https://services.leadconnectorhq.com
```

**Authentication:**
```typescript
// OAuth 2.0 with refresh tokens
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'Version': '2021-07-28',
  'Content-Type': 'application/json'
}
```

**Create Contact:**
```typescript
POST /contacts/
Body: {
  locationId: string,
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
  customFields: [
    { id: "field_id", value: "value" }
  ],
  tags: string[]
}
```

**Custom Fields Mapping:**
```typescript
// Property fields → GHL custom fields
const fieldMapping = {
  price: 'price',
  bedrooms: 'bedrooms',
  bathrooms: 'bathrooms',
  squareFeet: 'square_footage',
  propertyType: 'property_type',
  // ... map all fields
};
```

### B. Database Indexes

**Recommended Indexes:**
```sql
-- Properties table
CREATE INDEX idx_properties_postal ON properties(postal_code);
CREATE INDEX idx_properties_price ON properties(price);
CREATE INDEX idx_properties_pushed ON properties(pushed);
CREATE INDEX idx_properties_created ON properties(created_at);

-- Jobs table
CREATE INDEX idx_jobs_status_attempts ON jobs(status, attempts);
CREATE INDEX idx_jobs_created ON jobs(created_at);

-- Users table
CREATE INDEX idx_users_email ON users(email);
```

### C. Common Issues & Solutions

**Issue 1: Worker Running Out of Memory**
```
Solution: Reduce JOB_CONCURRENCY or increase --max-old-space-size
```

**Issue 2: Jobs Timing Out**
```
Solution: Increase retryLimit and retryDelay in pg-boss configuration
```

**Issue 3: GHL Rate Limiting**
```
Solution: Implement exponential backoff and request throttling
```

**Issue 4: Duplicate Leads**
```
Solution: Use idempotency keys and check pushed status before delivery
```

### D. Performance Benchmarks

**Expected Throughput:**
- Single worker: ~50-100 leads/minute
- 10 workers: ~500-1000 leads/minute
- Memory per worker: ~400-600 MB

**Database Performance:**
- Insert rate: ~1000 properties/second
- Query time (filtered): <100ms for typical user settings

---

## Conclusion

This comprehensive specification provides a complete blueprint for building and deploying the GoHighLevel Real-Estate Leads Delivery Platform. The system is designed for:

- **Reliability:** Database-backed job queue with retries
- **Scalability:** Horizontal scaling with pg-boss and worker pools
- **Security:** OAuth authentication, webhook validation, token management
- **Observability:** Comprehensive logging, metrics, and alerting
- **Maintainability:** Clear separation of concerns, well-documented code

**Next Steps:**
1. Review and approve architecture
2. Set up development environment
3. Begin Phase 1 implementation (database + ingestion)
4. Iterate with testing and feedback
5. Deploy to production with monitoring

---

**Document Version:** 1.0  
**Last Updated:** December 2024  
**Status:** Ready for Implementation
