import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

export type Row = Record<string, any>;
export type Sql = Pick<PoolClient, "query">;
export const sql: Sql = pool;
export async function rows(query: string, values: unknown[] = [], client: Sql = sql): Promise<Row[]> {
  return (await client.query(query, values)).rows;
}
export async function one(query: string, values: unknown[] = [], client: Sql = sql): Promise<Row | undefined> {
  return (await rows(query, values, client))[0];
}
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function required<T>(value: T | undefined | null, message = "Not found"): T {
  if (value == null) throw new HttpError(404, message);
  return value;
}
export function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(400, "Invalid identifier");
  return n;
}
// Only route-owned constant table/field allowlists may reach this helper.
export async function patch(table: "events" | "tasks" | "roles" | "sponsors", rowId: number, data: Row, eventId?: number, client: Sql = sql) {
  const allow: Record<typeof table, string[]> = {
    events: ["name","starts_at","timezone","city","guests_expected","budget_amount","description_raw","purpose_why","purpose_audience","purpose_takeaway","signups_open","auto_task_from_signup","event_day_mode","event_day_notes","day_of_contact_text","status","place_text","sponsor_goal_amount","updated_at","updated_by_user_id"],
    tasks: ["title","group_name","status","assignee_user_id","assignee_volunteer_id","role_id","due_date","recurring","sort_order"],
    roles: ["name","instruction","slots_needed"],
    sponsors: ["name","offer_text","status","owner_user_id","amount","next_step_text","next_step_due"],
  };
  const keys = Object.keys(data).filter(k => allow[table].includes(k));
  const args: unknown[] = [rowId];
  if (eventId !== undefined) args.push(eventId);
  const where = eventId === undefined ? "id=$1" : "id=$1 AND event_id=$2";
  if (!keys.length) return required(await one(`SELECT * FROM ${table} WHERE ${where}`, args, client));
  const set = keys.map(k => { args.push(data[k]); return `${k}=$${args.length}`; }).join(",");
  return required(await one(`UPDATE ${table} SET ${set} WHERE ${where} RETURNING *`, args, client));
}
