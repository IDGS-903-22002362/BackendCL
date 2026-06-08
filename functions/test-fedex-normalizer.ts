import { normalizeMxStateForFedEx } from "./src/modules/shipping/fedex/fedex-address.helper";

const tests = [
  { input: "Guanajuato", expected: "GT" },
  { input: "GTO", expected: "GT" },
  { input: "GUA", expected: "GT" },
  { input: "GT", expected: "GT" },
  { input: "Leon de los Aldama", expected: "Leon de los Aldama" },
  { input: "CIUDAD DE MEXICO", expected: "DF" },
  { input: "ESTADO DE MEXICO", expected: "EM" },
];

let allPassed = true;

for (const test of tests) {
  const result = normalizeMxStateForFedEx(test.input);
  if (result !== test.expected) {
    console.error(`❌ Test failed for "${test.input}": Expected "${test.expected}", got "${result}"`);
    allPassed = false;
  } else {
    console.log(`✅ Test passed for "${test.input}": "${result}"`);
  }
}

if (allPassed) {
  console.log("🎉 All tests passed!");
} else {
  process.exit(1);
}
