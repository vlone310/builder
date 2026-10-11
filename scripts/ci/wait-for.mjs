// Waits until a URL answers below 500, or fails after the timeout.
//
//   node scripts/ci/wait-for.mjs http://localhost:8080/realms/builder 180
const [url, seconds = "120"] = process.argv.slice(2);
if (!url) {
  console.error("Usage: wait-for.mjs <url> [timeout-seconds]");
  process.exit(1);
}

const deadline = Date.now() + Number(seconds) * 1000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.status < 500) {
      console.log(`${url} → ${response.status}`);
      process.exit(0);
    }
  } catch {
    // Not listening yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.error(`${url} did not answer within ${seconds}s`);
process.exit(1);
