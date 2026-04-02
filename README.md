# API Coverage Utility

This script compares **Swagger/OpenAPI endpoints** with a **Postman collection** and reports:
- how many APIs are automated
- how many are missing

It is designed for non‑technical users. You only need to edit a few lines or run one command.

---

## 1) Quick Start (no code changes)

Run the script with your Swagger URL and your Postman collection file/path:

```
python3 api_coverage.py <swagger_url> <postman_json_path_or_url>
```

Example:

```
python3 api_coverage.py \
  "https://hosting-beta.uapi.newfold.com/openapi.json" \
  "/Users/kiran.jadhav/Documents/PostmanAutomtion_Cursor/hosting-pillar-api-automation/HUAPI/HUAPI_component_test_collection.json"
```

---

## 2) Edit Once (for your own repo)

Open `api_coverage.py` and change only the **USER CONFIG** section:

```python
# ===========================
# USER CONFIG (edit here)
# ===========================
SWAGGER_URL = "https://your-api.com/openapi.json"
POSTMAN_COLLECTION_URL = "/path/to/your/postman_collection.json"

# Host placeholders used in Postman URLs
HOST = "https://your-api.com"
HAL_HOST = "https://your-hal-host.com"

# Coverage options
EXCLUDE_DEPRECATED = True
```

Then run:

```
python3 api_coverage.py
```

---

## 3) If Swagger and Postman use different path variables

Sometimes Swagger uses `{hosting_id}` but Postman uses `{hosting_account_id}`.

In `api_coverage.py`, update `normalize_path()`:

```python
path = path.replace("{hosting_account_id}", "{hosting_id}")
```

Add more replacements if needed:

```python
path = path.replace("{site_id}", "{site_uuid}")
```

---

## 4) Output Files (Report)

After running, these files are created in the same folder:

- `automated_apis.json` → unique endpoints matched to Swagger
- `automated_requests.json` → all matched Postman request items
- `unmatched_requests.json` → requests not found in Swagger
- `missing_apis.json` → Swagger endpoints not covered

---

## 5) Common Issues

**Problem:** `Expected JSON but got Content-Type 'text/html'`
- Your Postman URL needs login/auth.
- Use a local file instead, or provide access token.

**Problem:** Coverage seems low
- Check host placeholders (`HOST`, `HAL_HOST`)
- Check variable mapping in `normalize_path()`
- Check if `EXCLUDE_DEPRECATED = True`

---

## 6) Requirements

Python 3.8+  
Install dependencies:

```
pip3 install requests
```

---

## 7) Optional: Stash authentication

If your Postman collection is in a private Stash repo:

```
export STASH_USER="your-email@company.com"
export STASH_TOKEN="your-token"
python3 api_coverage.py <swagger_url> <stash_raw_url>
```

---

## 8) Web app (GitHub Pages)

A static UI in `docs/` runs the same comparison **in the browser** (no server; files stay on the user’s machine).

**What users do**

1. Open the published site.
2. Upload the Postman collection JSON.
3. Paste an OpenAPI/Swagger JSON URL **or** upload the spec file (many APIs block browser `fetch` via CORS, so upload is often required).
4. Optionally set `{{HOST}}` / `{{HAL_HOST}}` replacements and toggle deprecated endpoints.
5. Run the report and read the summary and lists.

**Host on GitHub (pick one)**

- **Branch `/docs`:** Repository → **Settings** → **Pages** → **Build and deployment** → Source: **Deploy from a branch** → Branch `main`, folder **`/docs`**, Save. The site URL will be `https://<user>.github.io/<repo>/`.
- **GitHub Actions:** Source: **GitHub Actions**. Pushes to `main` run `.github/workflows/deploy-pages.yml`, which publishes the `docs/` folder.

---

That’s it. If you want a CSV report or folder‑wise breakdown, let me know.
