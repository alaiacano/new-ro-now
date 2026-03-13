"""
Diagnostic script v3: click multiple folders, capture full request details
(method, URL, POST body, response) to understand the Document_AjaxBinding API.

Run with:
    uv run --project scraper python diagnose_docenter.py
"""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = "https://www.newrochelleny.gov"
DOCENTER_URL = f"{BASE_URL}/DocumentCenter/"
OUT_DIR = Path(__file__).parent.parent / "data" / "diag"
OUT_DIR.mkdir(parents=True, exist_ok=True)

API_PATH = "/Admin/DocumentCenter/Home/Document_AjaxBinding"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()

        calls = []

        async def on_request(request):
            if API_PATH in request.url:
                calls.append({
                    "event": "request",
                    "method": request.method,
                    "url": request.url,
                    "post_data": request.post_data,
                    "headers": dict(request.headers),
                })

        async def on_response(response):
            if API_PATH in response.url and response.status < 400:
                try:
                    body = await response.json()
                except Exception:
                    body = await response.text()
                calls.append({
                    "event": "response",
                    "url": response.url,
                    "status": response.status,
                    "body": body,
                })

        page.on("request", on_request)
        page.on("response", on_response)

        print(f"Loading {DOCENTER_URL} ...")
        await page.goto(DOCENTER_URL, wait_until="networkidle")

        folders = await page.query_selector_all(".ant-tree-node-content-wrapper")
        print(f"Found {len(folders)} folder nodes\n")

        # Click first 5 folders and capture what changes
        for i in range(min(5, len(folders))):
            title = await folders[i].get_attribute("title")
            calls.clear()

            await folders[i].click()
            await page.wait_for_load_state("networkidle")
            await asyncio.sleep(0.5)

            reqs = [c for c in calls if c["event"] == "request"]
            resps = [c for c in calls if c["event"] == "response"]

            print(f"=== [{i}] {title!r} ===")
            for req in reqs:
                print(f"  {req['method']} {req['url']}")
                if req.get("post_data"):
                    print(f"  POST body: {req['post_data']}")
                else:
                    print(f"  (no POST body)")
            for resp in resps[:1]:
                body = resp["body"]
                if isinstance(body, dict):
                    docs = body.get("Documents", [])
                    total = body.get("TotalCount", 0)
                    print(f"  → {total} total docs, {len(docs)} returned")
                    for d in docs[:3]:
                        print(f"     {d}")
                else:
                    print(f"  → {str(body)[:200]}")
            print()

        # Now also try calling the API directly with httpx to see if we can
        # enumerate folders without Playwright
        print("\n--- Trying to fetch folder tree via API ---")
        import httpx
        headers = {"User-Agent": "new-ro-monitor/1.0"}

        # Try some guesses for a folder listing endpoint
        endpoints = [
            f"{BASE_URL}/Admin/DocumentCenter/Home/Folder_AjaxBinding",
            f"{BASE_URL}/Admin/DocumentCenter/Home/GetFolders",
            f"{BASE_URL}/Admin/DocumentCenter/Home/FolderTree",
            f"{BASE_URL}/Admin/DocumentCenter/Home/Document_AjaxBinding?renderMode=0&loadSource=7",
        ]
        for url in endpoints:
            try:
                r = httpx.get(url, headers=headers, timeout=10, follow_redirects=True)
                ct = r.headers.get("content-type", "")
                print(f"  GET {url}")
                print(f"  → {r.status_code} {ct[:50]}  body: {r.text[:300]}")
            except Exception as e:
                print(f"  GET {url} → ERROR: {e}")
            print()

        await browser.close()


asyncio.run(main())
