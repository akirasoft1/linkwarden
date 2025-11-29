# Authenticated Archiving with Cookies

This feature allows Linkwarden to archive paywalled content using your existing subscriptions/credentials for content providers.

## How It Works

1. You export cookies from your browser for sites you're logged into
2. Convert them to Playwright's storageState format using the CLI tool
3. Store them as Kubernetes secrets (or in a local directory)
4. The worker automatically applies matching cookies when archiving URLs from those domains

## Setup Guide

### Step 1: Export Cookies from Chrome

1. Open Chrome DevTools (F12)
2. Go to **Application** tab → **Cookies** → select the site
3. Select all cookies (Ctrl+A) and copy (Ctrl+C)
4. Paste into a text file (e.g., `~/cookies-export.txt`)

Alternatively, use a browser extension like "EditThisCookie" or "Cookie-Editor" to export.

### Step 2: Convert to Playwright Format

From the worker directory:

```bash
# Convert all cookies, grouped by domain
npm run convert-cookies ~/cookies-export.txt ./cookie-output/

# Convert only cookies for a specific domain
npm run convert-cookies ~/cookies-export.txt ./cookie-output/ --domain=nytimes.com
```

This creates one JSON file per domain (e.g., `nytimes.com.json`).

### Step 3: Deploy as Kubernetes Secret

```bash
# Create secret from the generated files
kubectl create secret generic linkwarden-site-cookies \
  --from-file=./cookie-output/ \
  -n your-namespace

# Or update an existing secret
kubectl create secret generic linkwarden-site-cookies \
  --from-file=./cookie-output/ \
  -n your-namespace \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Step 4: Mount Secret in Worker Deployment

Add to your worker deployment:

```yaml
spec:
  containers:
    - name: worker
      env:
        - name: SITE_COOKIES_DIR
          value: "/data/cookies"
      volumeMounts:
        - name: site-cookies
          mountPath: /data/cookies
          readOnly: true
  volumes:
    - name: site-cookies
      secret:
        secretName: linkwarden-site-cookies
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SITE_COOKIES_DIR` | `/data/cookies` | Directory containing cookie JSON files |

## Cookie File Format

Each file should be named `{domain}.json` and contain Playwright's storageState format:

```json
{
  "cookies": [
    {
      "name": "session_id",
      "value": "abc123...",
      "domain": ".nytimes.com",
      "path": "/",
      "expires": 1735689600,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    }
  ],
  "origins": []
}
```

## Supported Sites

Any site that uses cookie-based authentication should work. Common examples:

- News sites: NYTimes, WSJ, Washington Post, The Atlantic
- Tech sites: Medium, Substack, O'Reilly
- Academic: JSTOR, IEEE, ACM Digital Library

## Cookie Expiration

Most session cookies expire after days to weeks. When cookies expire:

1. Log into the site again in your browser
2. Re-export the cookies
3. Run the conversion tool again
4. Update the Kubernetes secret:
   ```bash
   kubectl create secret generic linkwarden-site-cookies \
     --from-file=./cookie-output/ \
     -n your-namespace \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

The worker will pick up new cookies on the next archival attempt (no restart needed).

## Troubleshooting

### Cookies not being applied

Check worker logs for:
```
[Cookies] Loaded X domain configs: domain1.com, domain2.com
[Cookies] Applying X cookies for domain.com
```

If you don't see the domain listed, verify:
- The file is named correctly (`domain.com.json`, not `www.domain.com.json`)
- The file is valid JSON
- The secret is mounted correctly

### Still hitting paywall

Some sites use additional checks beyond cookies:
- JavaScript fingerprinting
- IP-based rate limiting
- Account verification on new devices

For these cases, you may need to:
- Use a headless browser that appears more "real" (already using Desktop Chrome device)
- Ensure the `User-Agent` matches what you used when logging in
- Some sites may block headless browsers entirely

### Checking which domains have cookies

The worker logs available domains on startup:
```
[Cookies] Loaded 5 domain configs: nytimes.com, wsj.com, medium.com, ...
```

## Security Considerations

- Cookie files contain authentication tokens - treat them as secrets
- Use Kubernetes RBAC to restrict access to the secret
- Consider enabling encryption at rest for etcd
- Cookies are only used by the worker, never exposed via API
- Session cookies give access to your accounts - rotate if compromised
