import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office requires the taskpane to be served over HTTPS. install.sh generates a
// trusted dev cert in ~/.hermes-office/certs; the bridge reuses the same one.
const certDir = path.join(os.homedir(), ".hermes-office", "certs");
const keyFile = path.join(certDir, "localhost.key");
const certFile = path.join(certDir, "localhost.crt");
const https =
  fs.existsSync(keyFile) && fs.existsSync(certFile)
    ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
    : undefined;

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: true, https, headers: { "Access-Control-Allow-Origin": "*" } },
  preview: { port: 3000, strictPort: true, https },
  build: { outDir: "dist", sourcemap: true },
});
