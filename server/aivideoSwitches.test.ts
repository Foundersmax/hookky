// The switches survive a restart: saved in Postgres. Runs when TEST_DATABASE_URL is set (CI).
import { test } from "node:test";
import assert from "node:assert/strict";

const url = process.env.TEST_DATABASE_URL;
test("switches are saved and read back", { skip: !url && "set TEST_DATABASE_URL to run" }, async () => {
  process.env.DATABASE_URL = url;
  const { migrate, closeDb } = await import("./db");
  await migrate();
  const s = await import("./aivideoSwitches");
  await s.setSwitch("openai", true);
  await s.setSwitch("kling", true);
  await s.setSwitch("openai", false);
  s._resetSwitches();
  assert.equal(s.isOff("openai"), false);
  await s.loadSwitches();
  assert.equal(s.isOff("openai"), true);
  assert.equal(s.isOff("kling"), false);
  await s.setSwitch("openai", true);
  await closeDb();
});
