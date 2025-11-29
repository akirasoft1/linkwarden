/**
 * Cookie management for authenticated archiving
 *
 * Loads Playwright storageState files from a configured directory,
 * matching them to URLs by domain for paywall bypass.
 */

import * as fs from "fs";
import * as path from "path";
import type { BrowserContextOptions } from "playwright";

// Directory where cookie files are stored (mounted from K8s secret)
const COOKIES_DIR = process.env.SITE_COOKIES_DIR || "/data/cookies";

interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

// Cache of loaded storage states
const storageStateCache = new Map<string, StorageState>();

// List of available cookie domains (populated on first call)
let availableDomains: string[] | null = null;

/**
 * Get list of domains we have cookies for
 */
export function getAvailableCookieDomains(): string[] {
  if (availableDomains !== null) {
    return availableDomains;
  }

  availableDomains = [];

  if (!fs.existsSync(COOKIES_DIR)) {
    console.log(`[Cookies] Directory not found: ${COOKIES_DIR}`);
    return availableDomains;
  }

  try {
    const files = fs.readdirSync(COOKIES_DIR);
    availableDomains = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));

    if (availableDomains.length > 0) {
      console.log(
        `[Cookies] Loaded ${availableDomains.length} domain configs: ${availableDomains.join(", ")}`
      );
    }
  } catch (err) {
    console.error(`[Cookies] Error reading directory: ${err}`);
  }

  return availableDomains;
}

/**
 * Extract the registrable domain from a URL
 * e.g., "https://www.nytimes.com/article" -> "nytimes.com"
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Simple extraction: take last two parts (or three for co.uk, etc.)
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      // Handle common two-part TLDs
      const twoPartTLDs = ["co.uk", "com.au", "co.jp", "org.uk"];
      const lastTwo = parts.slice(-2).join(".");
      if (twoPartTLDs.includes(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join(".");
      }
      return parts.slice(-2).join(".");
    }
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Find matching cookie file for a URL
 * Tries exact domain match first, then parent domains
 */
export function findMatchingCookieFile(url: string): string | null {
  const domain = extractDomain(url);
  if (!domain) return null;

  const domains = getAvailableCookieDomains();

  // Try exact match first
  if (domains.includes(domain)) {
    return path.join(COOKIES_DIR, `${domain}.json`);
  }

  // Try to find a parent domain match
  // e.g., URL is cooking.nytimes.com, we have nytimes.com
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const availableDomain of domains) {
      if (
        hostname === availableDomain ||
        hostname.endsWith(`.${availableDomain}`)
      ) {
        return path.join(COOKIES_DIR, `${availableDomain}.json`);
      }
    }
  } catch {
    // Invalid URL, skip
  }

  return null;
}

/**
 * Load storage state from a cookie file
 */
export function loadStorageState(filePath: string): StorageState | null {
  // Check cache first
  if (storageStateCache.has(filePath)) {
    return storageStateCache.get(filePath)!;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const state = JSON.parse(content) as StorageState;

    // Validate structure
    if (!state.cookies || !Array.isArray(state.cookies)) {
      console.error(`[Cookies] Invalid storageState format: ${filePath}`);
      return null;
    }

    // Filter out expired cookies
    const now = Math.floor(Date.now() / 1000);
    const validCookies = state.cookies.filter(
      (c) => c.expires === -1 || c.expires > now
    );

    if (validCookies.length < state.cookies.length) {
      console.log(
        `[Cookies] Filtered ${state.cookies.length - validCookies.length} expired cookies from ${filePath}`
      );
    }

    state.cookies = validCookies;
    storageStateCache.set(filePath, state);

    return state;
  } catch (err) {
    console.error(`[Cookies] Error loading ${filePath}: ${err}`);
    return null;
  }
}

/**
 * Get storage state for a URL if we have matching cookies
 */
export function getStorageStateForUrl(url: string): StorageState | null {
  const cookieFile = findMatchingCookieFile(url);
  if (!cookieFile) {
    return null;
  }

  return loadStorageState(cookieFile);
}

/**
 * Merge storage state into browser context options
 */
export function applyStorageState(
  options: BrowserContextOptions,
  url: string
): BrowserContextOptions {
  const storageState = getStorageStateForUrl(url);

  if (!storageState) {
    return options;
  }

  const domain = extractDomain(url);
  console.log(`[Cookies] Applying ${storageState.cookies.length} cookies for ${domain}`);

  return {
    ...options,
    storageState,
  };
}

/**
 * Clear the storage state cache (useful if cookie files are updated)
 */
export function clearCookieCache(): void {
  storageStateCache.clear();
  availableDomains = null;
  console.log("[Cookies] Cache cleared");
}

/**
 * Check if we have cookies for a given URL
 */
export function hasCookiesForUrl(url: string): boolean {
  return findMatchingCookieFile(url) !== null;
}
