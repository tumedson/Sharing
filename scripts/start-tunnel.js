const fs = require("fs");
const localtunnel = require("localtunnel");

const PORT = Number(process.env.PORT || 3000);
const OUTPUT_FILE = process.env.TUNNEL_URL_FILE || "/tmp/photo-share-public-url.txt";

(async () => {
  try {
    const tunnel = await localtunnel({ port: PORT });

    fs.writeFileSync(OUTPUT_FILE, `${tunnel.url}\n`, "utf8");
    console.log(`Public URL: ${tunnel.url}`);
    console.log(`Saved URL to: ${OUTPUT_FILE}`);

    tunnel.on("close", () => {
      console.error("Tunnel closed.");
      process.exit(1);
    });

    process.stdin.resume();
  } catch (error) {
    console.error("Failed to create tunnel:", error.message);
    process.exit(1);
  }
})();
