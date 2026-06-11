/**
 * MOMENTUM — Shared server core
 * Prisma singleton + the small helpers every route needs.
 */
import { PrismaClient } from "@prisma/client";
import type { Request, Response, NextFunction, RequestHandler } from "express";

export const prisma = new PrismaClient();

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/** YYYYMMDD integer key for any date — the join key to dim_date. */
export const toDateKey = (d: Date): number =>
  d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

/** First/last date keys of a month — range-scan bounds on facts. */
export const monthKeyRange = (year: number, month: number) => ({
  from: year * 10000 + month * 100 + 1,
  to:   year * 10000 + month * 100 + 31,
});

/**
 * Guarantees the calendar row exists for a date (the seed covers
 * 2024–2032; this keeps inserts safe beyond that horizon).
 */
export async function ensureDimDate(d: Date): Promise<number> {
  const dateKey = toDateKey(d);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const dow = d.getUTCDay();
  await prisma.dimDate.upsert({
    where: { dateKey },
    update: {},
    create: {
      dateKey,
      date: new Date(Date.UTC(y, m - 1, day)),
      year: y,
      quarter: Math.ceil(m / 3),
      month: m,
      monthName: MONTHS[m - 1],
      yearMonth: `${y}-${String(m).padStart(2, "0")}`,
      week: Math.ceil((Math.floor((Date.UTC(y, m - 1, day) - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7),
      dayOfMonth: day,
      dayOfWeek: dow,
      dayName: DAY_NAMES[dow],
      isWeekend: dow === 0 || dow === 6,
    },
  });
  return dateKey;
}

/** Express async wrapper — forwards rejections to the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

/** Demo auth stub: x-user-id header, default 1. Swap for real auth later. */
export const userIdOf = (req: Request): number =>
  Number(req.header("x-user-id") ?? 1);

/** Prisma Decimal | null → number for JSON payloads. */
export const num = (v: unknown): number => (v == null ? 0 : Number(v));
