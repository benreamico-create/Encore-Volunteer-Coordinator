import { readFile } from "node:fs/promises";
import pg from "pg";
// Development only. Production schema changes are applied by Replit Publish.
if (process.env.NODE_ENV === "production") throw new Error("Use Replit Publish to apply the production database schema.");
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
  for (const phase of [0,1,2,3,4]) {
    const source=new URL(`../../../lib/db/schema-phase${phase}.sql`,import.meta.url);
    await pool.query(await readFile(source,"utf8"));
  }
  console.log("Development schema is ready.");
} finally { await pool.end(); }
