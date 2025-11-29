#!/usr/bin/env tsx
/**
 * Cookie Converter CLI
 *
 * Converts Chrome DevTools cookie export (tab-separated) to Playwright storageState format.
 *
 * Usage:
 *   npx tsx convertCookies.ts input.txt output-dir/
 *   npx tsx convertCookies.ts input.txt output-dir/ --domain=nytimes.com
 *
 * Input format (Chrome DevTools copy):
 *   name\tvalue\tdomain\tpath\texpires\tsize\thttpOnly\tsecure\tsameSite\t...
 *
 * Output: Playwright storageState JSON files, one per domain
 */

import * as fs from "fs";
import * as path from "path";

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface StorageState {
  cookies: PlaywrightCookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

function parseChromeCookieLine(line: string): PlaywrightCookie | null {
  const parts = line.split("\t");
  if (parts.length < 7) return null;

  const [name, value, domain, cookiePath, expiresStr, _size, ...flags] = parts;

  if (!name || !domain) return null;

  // Parse expiration - Chrome shows "Session" or ISO date string
  let expires = -1;
  if (expiresStr && expiresStr !== "Session") {
    const date = new Date(expiresStr);
    if (!isNaN(date.getTime())) {
      expires = Math.floor(date.getTime() / 1000);
    }
  }

  // Parse flags - Chrome uses checkmarks (✓) or empty for boolean fields
  // Format varies but typically: size, httpOnly, secure, sameSite, ...
  const httpOnly = flags.some((f) => f === "✓" || f.toLowerCase() === "true");
  const secure = flags.slice(1).some((f) => f === "✓" || f.toLowerCase() === "true");

  // sameSite is typically a string value in the flags
  let sameSite: "Strict" | "Lax" | "None" = "Lax";
  for (const flag of flags) {
    const lower = flag.toLowerCase().trim();
    if (lower === "strict") sameSite = "Strict";
    else if (lower === "none") sameSite = "None";
    else if (lower === "lax") sameSite = "Lax";
  }

  return {
    name: name.trim(),
    value: value.trim(),
    domain: domain.trim(),
    path: cookiePath?.trim() || "/",
    expires,
    httpOnly,
    secure,
    sameSite,
  };
}

function normalizeDomain(domain: string): string {
  // Remove leading dot for filename, but keep for matching
  return domain.replace(/^\./, "").toLowerCase();
}

function groupCookiesByDomain(
  cookies: PlaywrightCookie[]
): Map<string, PlaywrightCookie[]> {
  const groups = new Map<string, PlaywrightCookie[]>();

  for (const cookie of cookies) {
    const domain = normalizeDomain(cookie.domain);
    if (!groups.has(domain)) {
      groups.set(domain, []);
    }
    groups.get(domain)!.push(cookie);
  }

  return groups;
}

function createStorageState(cookies: PlaywrightCookie[]): StorageState {
  return {
    cookies,
    origins: [],
  };
}

function printUsage() {
  console.log(`
Cookie Converter - Chrome DevTools to Playwright storageState

Usage:
  npx tsx convertCookies.ts <input-file> <output-dir> [options]

Arguments:
  input-file    Path to file containing Chrome cookie export (tab-separated)
  output-dir    Directory to write Playwright storageState JSON files

Options:
  --domain=X    Only output cookies for specified domain (e.g., --domain=nytimes.com)
  --help        Show this help message

Input Format:
  Export cookies from Chrome DevTools > Application > Cookies, then copy/paste.
  Each line should be tab-separated with columns:
  name, value, domain, path, expires, size, httpOnly, secure, sameSite, ...

Output:
  One JSON file per domain: {domain}.json
  Format: Playwright storageState (ready to use with browser.newContext())

Example:
  npx tsx convertCookies.ts ~/cookies.txt /data/cookies/
  npx tsx convertCookies.ts ~/cookies.txt /data/cookies/ --domain=wsj.com
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length < 2) {
    printUsage();
    process.exit(args.includes("--help") ? 0 : 1);
  }

  const inputFile = args[0];
  const outputDir = args[1];
  const domainFilter = args
    .find((a) => a.startsWith("--domain="))
    ?.split("=")[1]
    ?.toLowerCase();

  // Validate input file
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  // Create output directory if needed
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}`);
  }

  // Read and parse input
  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  console.log(`Parsing ${lines.length} lines...`);

  const cookies: PlaywrightCookie[] = [];
  let skipped = 0;

  for (const line of lines) {
    const cookie = parseChromeCookieLine(line);
    if (cookie) {
      cookies.push(cookie);
    } else {
      skipped++;
    }
  }

  console.log(`Parsed ${cookies.length} cookies (skipped ${skipped} invalid lines)`);

  // Group by domain
  const grouped = groupCookiesByDomain(cookies);
  console.log(`Found ${grouped.size} unique domains`);

  // Write output files
  let written = 0;
  for (const [domain, domainCookies] of grouped) {
    if (domainFilter && !domain.includes(domainFilter)) {
      continue;
    }

    const storageState = createStorageState(domainCookies);
    const outputPath = path.join(outputDir, `${domain}.json`);

    fs.writeFileSync(outputPath, JSON.stringify(storageState, null, 2));
    console.log(`  ${domain}: ${domainCookies.length} cookies -> ${outputPath}`);
    written++;
  }

  console.log(`\nWrote ${written} storageState files to ${outputDir}`);

  if (written > 0) {
    console.log(`
Next steps:
1. Review the generated JSON files
2. Create a Kubernetes secret:
   kubectl create secret generic linkwarden-site-cookies --from-file=${outputDir}
3. Mount the secret in your worker deployment at /data/cookies
`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
