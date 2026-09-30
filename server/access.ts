import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "../agent/lib/demo/service.ts";
const owners = new AsyncLocalStorage<string>();
const LOCAL_OWNER = "00000000-0000-4000-8000-000000000000";
export function assertHostingConfiguration(): void {
  if ((process.env.VERCEL || process.env.RIV_DEPLOYMENT === "production") && process.env.RIV_STORAGE !== "supabase") {
    throw new DomainError("durable_storage_required", "Hosted mode requires explicitly configured durable storage and browser isolation.", 503);
  }
}
function secret() {
  const value = process.env.RIV_SESSION_SIGNING_SECRET ?? process.env.SUPABASE_SECRET_KEY;
  if (!value) throw new DomainError("session_security_unconfigured", "Session security is unavailable. The app will not expose other visitors' conversations.", 503);
  return value;
}
function signature(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
function readOwner(request: IncomingMessage): string | null {
  const cookie = (request.headers.cookie ?? "").split(";").map((p) => p.trim()).find((p) => p.startsWith("riv_owner="))?.slice(10);
  if (!cookie) return null;
  const parts = cookie.split("."); if (parts.length !== 3) return null;
  const [id, expires, actual] = parts;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^\d+$/.test(expires) || Number(expires) <= Date.now()) return null;
  const expected = signature(`${id}.${expires}`); const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b) ? id : null;
}
export function requestOwner(): string {
  assertHostingConfiguration();
  if (process.env.RIV_STORAGE !== "supabase") return LOCAL_OWNER;
  const owner = owners.getStore(); if (!owner) throw new DomainError("owner_required", "An authenticated demo browser session is required.", 403); return owner;
}
export function withHttpOwner<T>(request: IncomingMessage, response: ServerResponse, work: () => T): T {
  assertHostingConfiguration();
  if (process.env.RIV_STORAGE !== "supabase") return owners.run(LOCAL_OWNER, work);
  let owner = readOwner(request);
  if (!owner) {
    owner = randomUUID(); const value = `${owner}.${Date.now() + 86_400_000}`;
    response.setHeader("set-cookie", `riv_owner=${value}.${signature(value)}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=86400`);
  }
  return owners.run(owner, work);
}
export function withSocketOwner<T>(request: IncomingMessage, work: () => T): T {
  assertHostingConfiguration();
  if (process.env.RIV_STORAGE !== "supabase") return owners.run(LOCAL_OWNER, work);
  const owner = readOwner(request); if (!owner) throw new DomainError("owner_required", "Open the demo in a browser before starting voice.", 403);
  return owners.run(owner, work);
}
export function withKnownOwner<T>(owner: string, work: () => T): T { return owners.run(owner, work); }
