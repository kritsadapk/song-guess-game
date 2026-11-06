import { describe, expect, test } from "bun:test";
import { HIT_PAD, inHole, judgeQuestion, layoutHoles, rankPlayers, speedPoints } from "../../shared/protocol";

test("speedPoints: เร็วได้ 1000 ช้าสุดได้ 500 และโบนัสสตรีคสูงสุด 500", () => {
  expect(speedPoints(0, 20000, 1)).toBe(1000);
  expect(speedPoints(10000, 20000, 1)).toBe(750);
  expect(speedPoints(20000, 20000, 1)).toBe(500);
  expect(speedPoints(99999, 20000, 1)).toBe(500);
  expect(speedPoints(-5, 20000, 1)).toBe(1000);
  expect(speedPoints(0, 20000, 3)).toBe(1200);
  expect(speedPoints(0, 20000, 50)).toBe(1500);
});

test("rankPlayers: survival คนรอดมาก่อน, score ดูคะแนนอย่างเดียว", () => {
  const ps = [{ id: "a", alive: false, score: 900 }, { id: "b", alive: true, score: 100 }];
  expect(rankPlayers(ps, "survival").map((p) => p.id)).toEqual(["b", "a"]);
  expect(rankPlayers(ps, "score").map((p) => p.id)).toEqual(["a", "b"]);
});

test("inHole: ยืนบนขอบสระนับว่าอยู่ในหลุม แต่ขอบสระไม่ทับกัน", () => {
  const h = { x: 0.5, y: 0.5, r: 0.1 };
  expect(inHole(0.5, 0.5 + 0.1 + HIT_PAD * 0.9, h)).toBe(true);
  expect(inHole(0.5, 0.5 + 0.1 + HIT_PAD * 1.1, h)).toBe(false);
  for (let n = 2; n <= 6; n++) {
    const L = layoutHoles(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      expect(Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y)).toBeGreaterThan(L[i].r + L[j].r + 2 * HIT_PAD);
  }
});

describe("judgeQuestion", () => {
  const L = layoutHoles(2); // หลุม 0 = ถูก, หลุม 1 = ผิด
  const at = (id: string, hole: number, enteredAt = 0, streak = 0) =>
    ({ id, x: L[hole]?.x ?? 0.5, y: L[hole]?.y ?? 0.15, hole, enteredAt, score: 0, streak });

  test("survival: คนผิดถูกคืนมาให้ตกรอบ คนถูกได้คะแนนตามเวลาเข้าหลุม", () => {
    const right = at("a", 0, 0), wrong = at("b", 1);
    const r = judgeQuestion([right, wrong], L, [0], "survival", 0, 20000, 20000);
    expect(r.wrong.map((p) => p.id)).toEqual(["b"]);
    expect(r.allSaved).toBe(false);
    expect(r.gains).toEqual({ a: 1000 });
    expect([right.streak, wrong.streak]).toEqual([1, 0]);
  });

  test("survival: ผิดกันหมด = รอดหมด ไม่มีใครได้คะแนน · score: ผิดหมดก็ยังผิด", () => {
    expect(judgeQuestion([at("a", 1), at("b", -1)], L, [0], "survival", 0, 1, 1000).allSaved).toBe(true);
    const s = judgeQuestion([at("a", 1), at("b", -1)], L, [0], "score", 0, 1, 1000);
    expect([s.allSaved, s.wrong.length, s.gains]).toEqual([false, 2, {}]);
  });

  test("สตรีคบวกโบนัส และย้ายหลุมแล้วไม่ได้เวลาเข้าเดิม", () => {
    const p = at("a", 0, 0, 2); // ถูกมาแล้ว 2 ข้อ
    expect(judgeQuestion([p], L, [0], "score", 0, 20000, 20000).gains.a).toBe(1000 + 200);
    const moved = { ...at("b", 0, 0), hole: 1 }; // ระบบจำว่าอยู่หลุม 1 แต่ตอนนี้ยืนหลุม 0 → นับว่าเพิ่งเข้าตอนหมดเวลา
    expect(judgeQuestion([moved], L, [0], "score", 0, 20000, 20000).gains.b).toBe(500);
  });
});
