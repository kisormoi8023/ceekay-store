import argparse
import json
import os
import re
import time
import requests
from playwright.sync_api import sync_playwright

# -------------------------------------------------------------
# Talks to the admin backend added in server.js. Set these to match
# your .env (SCRAPER_API_KEY must be the exact same value on both sides).
# -------------------------------------------------------------
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000")
SCRAPER_API_KEY = os.environ.get("SCRAPER_API_KEY", "")


def get_next_product_id(json_filepath="products.json"):
    """Determines the next product number (e.g., p001, p002) based on products.json."""
    if not os.path.exists(json_filepath):
        return "p001", 1

    try:
        with open(json_filepath, "r", encoding="utf-8") as f:
            products = json.load(f)

        existing_ids = []
        for p in products:
            p_id = p.get("id", "")
            match = re.search(r'p(\d+)', p_id)
            if match:
                existing_ids.append(int(match.group(1)))

        next_num = max(existing_ids) + 1 if existing_ids else len(products) + 1
        return f"p{next_num:03d}", next_num
    except Exception:
        return "p001", 1


def download_image(url, product_code, img_index, img_dir="img"):
    """Downloads a product image using p001_1, p001_2 naming schema."""
    if not os.path.exists(img_dir):
        os.makedirs(img_dir, exist_ok=True)

    ext = ".jpg"
    if ".png" in url.lower():
        ext = ".png"
    elif ".webp" in url.lower():
        ext = ".webp"

    filename = f"{product_code}_{img_index}{ext}"
    filepath = os.path.join(img_dir, filename)
    rel_path = f"{img_dir}/{filename}"

    if os.path.exists(filepath):
        return rel_path

    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(response.content)
            print(f" Saved image: {rel_path}")
            return rel_path
    except Exception as e:
        print(f" Failed image download from {url}: {e}")

    return "img/default.jpg"


def scrape_vendor_product_with_variants(vendor_url):
    product_code, _ = get_next_product_id("products.json")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )

        page = context.new_page()
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        print(f"[{product_code}] Connecting to vendor page...")
        page.goto(vendor_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)

        # 1. Product Title
        title = page.locator("h1").first.inner_text().strip()

        # 2. Strict Filtered Image Selector (Targeting Product Gallery specifically)
        raw_image_urls = []
        gallery_selectors = [
            ".product-gallery img",
            ".product-single__photos img",
            ".product__media img",
            "div[class*='slider'] img",
            "div[class*='gallery'] img",
            ".product-form img"
        ]

        found_images = []
        for sel in gallery_selectors:
            elements = page.locator(sel).all()
            if len(elements) > 0:
                found_images = elements
                break

        if not found_images:
            found_images = page.locator("img").all()

        bad_keywords = [
            "logo", "icon", "banner", "footer", "header", "pay", "paypal",
            "visa", "mastercard", "trust", "service", "avatar", "size_chart",
            "size-guide", "badge", "50x50", "100x100", "small", "thumb"
        ]

        for img in found_images:
            src = img.get_attribute("src") or img.get_attribute("data-src") or ""
            src_lower = src.lower()

            if any(cdn in src_lower for cdn in ["staticdj.com", "img.staticdj", "cdn.shopify.com", "myshopify.com"]):
                if not any(bad in src_lower for bad in bad_keywords):
                    full_src = "https:" + src if src.startswith("//") else src
                    clean_src = full_src.split("?")[0]
                    if clean_src not in raw_image_urls:
                        raw_image_urls.append(clean_src)

        # 3. Sizes
        sizes = []
        try:
            size_selectors = [
                "div[class*='variant'] label",
                "div[class*='size'] label",
                ".product-form__option-value",
                "span[class*='size']"
            ]
            for sel in size_selectors:
                elements = page.locator(sel).all_inner_texts()
                clean_texts = [s.strip() for s in elements if s.strip() and "Sold Out" not in s]
                if clean_texts:
                    sizes.extend(clean_texts)
                    break
        except Exception:
            pass

        if not sizes:
            sizes = ["S", "M", "L", "XL", "2XL"]

        browser.close()

        # 4. Download top 5 genuine product photos
        base_vendor_price = 126.00
        variants = []
        downloaded_gallery = []

        for idx, url in enumerate(raw_image_urls[:5], start=1):
            local_path = download_image(url, product_code, idx)
            downloaded_gallery.append(local_path)

        unique_sizes = list(dict.fromkeys(sizes))
        for idx, size in enumerate(unique_sizes, start=1):
            variant_image = downloaded_gallery[(idx - 1) % len(downloaded_gallery)] if downloaded_gallery else "img/default.jpg"

            vendor_price = base_vendor_price
            retail_price = round(vendor_price * 1.4, 2)

            variants.append({
                "sku": f"{product_code.upper()}-V{idx}",
                "size": size,
                "color": "Multicolor" if "multicolor" in vendor_url.lower() else "Default",
                "vendor_price": vendor_price,
                "retail_price": retail_price,
                "image": variant_image
            })

        return {
            "id": product_code,
            "title": title,
            "vendor_url": vendor_url,
            "base_retail_price": variants[0]["retail_price"] if variants else 177.20,
            "default_image": variants[0]["image"] if variants else "img/default.jpg",
            "variants": variants
        }


def save_to_local_catalog(product_data, json_filepath="products.json"):
    products = []

    if os.path.exists(json_filepath):
        with open(json_filepath, "r", encoding="utf-8") as f:
            try:
                products = json.load(f)
            except Exception:
                products = []

    titles = [p.get("title") for p in products]
    if product_data["title"] in titles:
        for idx, p in enumerate(products):
            if p.get("title") == product_data["title"]:
                product_data["id"] = p.get("id", product_data["id"])
                products[idx] = product_data
    else:
        products.append(product_data)

    with open(json_filepath, "w", encoding="utf-8") as f:
        json.dump(products, f, indent=2)

    print(f"\n--- SUCCESS! Saved as {product_data['id']} in {json_filepath} ---")


def push_product_to_store(product_data):
    """Sends a scraped product to the live database via server.js's admin API."""
    if not SCRAPER_API_KEY:
        raise RuntimeError("SCRAPER_API_KEY is not set — export it (must match the server's .env value).")

    payload = {
        "productId": product_data["id"],
        "productName": product_data["title"],
        "price": product_data["base_retail_price"],
        "imageUrl": product_data["default_image"],
        "category": product_data.get("category"),
        "description": product_data.get("description"),
        "variants": product_data["variants"],
        "stockQuantity": product_data.get("stock_quantity", 20)
    }

    resp = requests.post(
        f"{API_BASE_URL}/api/admin/products",
        json=payload,
        headers={"X-API-Key": SCRAPER_API_KEY},
        timeout=20
    )
    resp.raise_for_status()
    print(f"Pushed {payload['productId']} to {API_BASE_URL}")
    return payload["productId"]


def run_bot_loop(poll_interval=15):
    """Continuously polls the admin dashboard's scrape job queue and fulfills jobs
    as they're created (via admin.html -> Scraper Bot -> Queue Scrape Job)."""
    if not SCRAPER_API_KEY:
        print("SCRAPER_API_KEY is not set. Export it to match your server's .env value, then re-run.")
        return

    print(f"Scraper bot started. Polling {API_BASE_URL} every {poll_interval}s. Ctrl+C to stop.")
    headers = {"X-API-Key": SCRAPER_API_KEY}

    while True:
        try:
            resp = requests.get(f"{API_BASE_URL}/api/admin/scrape-jobs/next", headers=headers, timeout=15)
            resp.raise_for_status()
            job = resp.json().get("job")

            if not job:
                time.sleep(poll_interval)
                continue

            print(f"\nClaimed job #{job['id']}: {job['vendor_url']}")
            try:
                product_data = scrape_vendor_product_with_variants(job["vendor_url"])
                save_to_local_catalog(product_data, "products.json")
                product_id = push_product_to_store(product_data)

                requests.post(
                    f"{API_BASE_URL}/api/admin/scrape-jobs/{job['id']}/complete",
                    json={"success": True, "productId": product_id},
                    headers=headers, timeout=15
                )
                print(f"Job #{job['id']} complete -> {product_id}")
            except Exception as job_err:
                print(f"Job #{job['id']} failed: {job_err}")
                requests.post(
                    f"{API_BASE_URL}/api/admin/scrape-jobs/{job['id']}/complete",
                    json={"success": False, "errorMessage": str(job_err)},
                    headers=headers, timeout=15
                )
        except KeyboardInterrupt:
            print("\nStopping bot.")
            break
        except Exception as loop_err:
            print(f"Bot loop error (will retry): {loop_err}")
            time.sleep(poll_interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ceekay product scraper")
    parser.add_argument("--bot", action="store_true",
                         help="Run continuously, polling the admin dashboard's scrape job queue")
    parser.add_argument("--url", type=str,
                         help="Scrape a single vendor URL directly, save it locally, and push it to the store")
    parser.add_argument("--interval", type=int, default=15,
                         help="Seconds between polls in --bot mode (default 15)")
    args = parser.parse_args()

    if args.bot:
        run_bot_loop(args.interval)
    elif args.url:
        data = scrape_vendor_product_with_variants(args.url)
        save_to_local_catalog(data, "products.json")
        push_product_to_store(data)
    else:
        print(
            "Usage:\n"
            "  python product_scraper.py --url <vendor product URL>   (one-off scrape + push)\n"
            "  python product_scraper.py --bot                        (poll admin dashboard queue continuously)\n"
        )


class ApiPipeline:
    """Optional Scrapy pipeline hook, if you're running this as part of a Scrapy spider
    instead of the Playwright function above. Sends each scraped item to the same
    admin endpoint the bot uses."""

    def process_item(self, item, spider):
        payload = {
            "productId": item["id"],
            "productName": item["title"],
            "price": float(item.get("base_retail_price", 0)),
            "imageUrl": item["images"][0] if item.get("images") else None,
            "variants": item.get("variants", [])
        }
        requests.post(
            f"{API_BASE_URL}/api/admin/products",
            json=payload,
            headers={"X-API-Key": SCRAPER_API_KEY},
            timeout=20
        )
        return item
