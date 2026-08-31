-- Approved fourth portal role. Additive only; no existing rows or constraints are rewritten.
ALTER TYPE "AccountRole" ADD VALUE IF NOT EXISTS 'ABANMI';
