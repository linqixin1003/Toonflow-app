import assert from "node:assert/strict";
import { extractNumberedPoints } from "./numberedPoints";

const sample = `1. Snap & Identify Instantly
2. 30,000+ Coins Worldwide
3. Scan Obverse & Reverse`;

assert.deepEqual(extractNumberedPoints(sample), [
  "Snap & Identify Instantly",
  "30,000+ Coins Worldwide",
  "Scan Obverse & Reverse",
]);

assert.deepEqual(extractNumberedPoints("only one line\n2. second"), []);
assert.deepEqual(extractNumberedPoints(""), []);
assert.deepEqual(
  extractNumberedPoints("- Feature A\n- Feature B\n- Feature C"),
  ["Feature A", "Feature B", "Feature C"],
);

console.log("numberedPoints.test.ts: all passed");
