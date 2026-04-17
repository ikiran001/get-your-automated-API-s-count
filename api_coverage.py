import json
import re
import argparse
import sys
from typing import Dict, Optional
from urllib.parse import urlparse, unquote

import os

import requests


# ===========================
# USER CONFIG (edit here)
# ===========================
# 1) Swagger/OpenAPI URL (source of all endpoints)
SWAGGER_URL = "https://hosting-beta.uapi.newfold.com/openapi.json"

# 2) Postman collection JSON (source of automated requests)
#    - Can be a local file path, or a stash raw/browse URL.
POSTMAN_COLLECTION_URL = (
    "/Users/kiran.jadhav/hosting-pillar-api-automation/HUAPI/WIP-HUAPI_component_test_collection.json"
)

# 3) Host placeholders used in Postman URLs
#    If your collection uses {{HOST}} or {{HAL_HOST}}, set the real base URLs here.
HOST = "https://hosting-beta.uapi.newfold.com" #the evironment url
HAL_HOST = "https://hal.beta.unifiedlayer.com"

# 4) Coverage options
#    True  = ignore deprecated endpoints in Swagger
#    False = include deprecated endpoints
EXCLUDE_DEPRECATED = True

# ---------------------------------------------------------------------------
# Path normalization — extend this dict so Postman/Swagger param names match
# ---------------------------------------------------------------------------
# Map *path parameter names* (without braces) to a single canonical name.
# Keys are compared case-sensitively (OpenAPI / Postman names usually are).
PATH_PARAM_ALIASES: Dict[str, str] = {
    "brand_type": "api_brand",
    "hosting_account_id": "hosting_id",
    "account_id": "account_id",
}


def _path_without_query_or_fragment(s: str) -> str:
    """Strip ?query and #fragment from a path or URL string."""
    if not s:
        return ""
    s = s.split("#", 1)[0]
    s = s.split("?", 1)[0]
    return s


def _looks_like_network_authority(authority: str) -> bool:
    """
    True if //authority/... is a scheme-relative network URL, not a path like
    //cpanel/v1 (where the first segment is literally 'cpanel').
    """
    if not authority:
        return False
    host_part = authority.split(":", 1)[0]
    if re.fullmatch(r"(?i)localhost", host_part):
        return True
    if re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", host_part):
        return True
    return bool(
        re.fullmatch(
            r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+",
            host_part,
            flags=re.I,
        )
    )


def _extract_path_only(raw: str) -> str:
    """
    Return only the path portion: no scheme/host, no query, no fragment.
    Handles full URLs, scheme-relative URLs, and relative paths.
    """
    s = (raw or "").strip()
    if not s:
        return ""
    if re.match(r"^[a-z][a-z+.-]*://", s, flags=re.I):
        try:
            u = urlparse(s)
            return _path_without_query_or_fragment(u.path or "/")
        except Exception:
            return ""
    if s.startswith("//"):
        authority = s[2:].split("/", 1)[0]
        if _looks_like_network_authority(authority):
            try:
                u = urlparse("https:" + s)
                return _path_without_query_or_fragment(u.path or "/")
            except Exception:
                pass
        return _path_without_query_or_fragment(re.sub(r"^/+", "/", s))
    return _path_without_query_or_fragment(s)


def _apply_path_param_aliases(path: str, aliases: Dict[str, str]) -> str:
    """Rewrite {name} segments using aliases; unknown names unchanged."""

    def repl(m: re.Match) -> str:
        name = (m.group(1) or "").strip()
        if not name:
            return m.group(0)
        canon = aliases.get(name, name)
        return "{" + str(canon) + "}"

    return re.sub(r"\{([^}]*)\}", repl, path)


def normalize_stash_url(url):
    """Convert stash browse URL to raw URL when possible."""
    if "/browse/" in url:
        return url.replace("/browse/", "/raw/")
    return url


def load_json(source):
    """
    Load JSON from a URL or local file path.
    - If source is a file path, read from disk.
    - If source is a URL, fetch via HTTP.
    """
    # Normalize common copy/paste issues
    source = source.replace("\u00a0", " ").strip()
    source = os.path.expanduser(source)

    is_url = source.startswith("http://") or source.startswith("https://")
    if not is_url:
        source = os.path.normpath(source)

    if os.path.isfile(source):
        with open(source, "r", encoding="utf-8") as f:
            return json.load(f)
    if source.startswith("/") and not os.path.exists(source):
        raise FileNotFoundError(
            f"Local file not found: {source}. "
            "Check the path and wrap it in quotes if it contains spaces or brackets."
        )

    url = normalize_stash_url(source)
    stash_user = os.getenv("STASH_USER")
    stash_token = os.getenv("STASH_TOKEN")
    auth = (stash_user, stash_token) if stash_user and stash_token else None
    headers = {}
    if stash_token and not stash_user:
        headers["Authorization"] = f"Bearer {stash_token}"

    res = requests.get(url, timeout=30, auth=auth, headers=headers)
    res.raise_for_status()
    content_type = res.headers.get("Content-Type", "")
    if "application/json" not in content_type:
        try:
            return res.json()
        except Exception as exc:
            raise ValueError(
                f"Expected JSON but got Content-Type '{content_type}' from {url}"
            ) from exc
    return res.json()

def extract_swagger_paths(swagger_json, exclude_deprecated=True):
    """
    Extract (method, path) tuples from Swagger spec.
    """
    paths = swagger_json.get("paths", {})
    swagger_endpoints = []
    for path, methods in paths.items():
        for method in methods.keys():
            # Only include standard HTTP methods
            if method.upper() in ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]:
                op = methods.get(method, {})
                if exclude_deprecated and op.get("deprecated") is True:
                    continue
                swagger_endpoints.append((method.upper(), path))
    return swagger_endpoints

def strip_postman_leading_base_noise(s: str) -> str:
    """
    Strip leading Postman env segments ({{HOST}}, {{BASE_URL}}, etc.): spaced, slash,
    or glued to the next segment. If they survive into urlparse, they become an extra
    path segment and nothing matches the OpenAPI paths.
    """
    t = (s or "").strip()
    if not t:
        return t
    seg = r"\{\{[^}]+\}\}"
    prev = None
    while prev != t:
        prev = t
        t = re.sub(r"^/?" + seg + r"\s+", "", t)
    prev2 = None
    while prev2 != t:
        prev2 = t
        t = re.sub(r"^/?" + seg + r"(?=/)", "", t)
        t = re.sub(r"^/?" + seg + r"(?=[^/\s?#])", "", t)
    head = t.split("?", 1)[0]
    if not re.match(r"^[a-z][a-z+.-]*://", t, flags=re.I) and t and not t.startswith("/") and "://" not in head:
        t = "/" + t
    return t


def normalize_path(path: str, param_aliases: Optional[Dict[str, str]] = None) -> str:
    """
    Return a single canonical path string for Swagger or Postman inputs.

    Steps (order matters):
      1. Trim; malformed / empty -> "".
      2. If value looks like a URL, keep only urlparse.path (drops host, query, fragment).
      3. Else strip ?query and #fragment from relative paths.
      4. Backslashes -> slashes; percent-decode when safe.
      5. Strip leading Postman env segments ({{HOST}}, {{BASE_URL}}, …).
      6. Convert Postman ``{{var}}`` to Swagger-style ``{var}``.
      7. Apply PATH_PARAM_ALIASES (plus optional ``param_aliases`` override/extend).
      8. Collapse duplicate slashes; trim trailing slash (except "/"); ensure leading "/".

    Examples::

        normalize_path("{{HOST}}addon_decom/{{brand_type}}")
        # -> "/addon_decom/{api_brand}"

        normalize_path("/addon_decom/{api_brand}?x=1#frag")
        # -> "/addon_decom/{api_brand}"

        normalize_path("https://api.example.com/addon_decom/{{brand_type}}?a=1")
        # -> "/addon_decom/{api_brand}"
    """
    if path is None:
        return ""
    merged_aliases: Dict[str, str] = dict(PATH_PARAM_ALIASES)
    if param_aliases:
        merged_aliases.update(param_aliases)

    try:
        p = _extract_path_only(str(path))
    except Exception:
        return ""
    if not p:
        return ""

    p = p.replace("\\", "/")
    try:
        if "%" in p:
            p = unquote(p)
    except Exception:
        pass

    p = strip_postman_leading_base_noise(p)
    p = re.sub(r"\{\{([^}]+)\}\}", r"{\1}", p)
    p = _apply_path_param_aliases(p, merged_aliases)
    p = re.sub(r"/+", "/", p)
    if len(p) > 1 and p.endswith("/"):
        p = p[:-1]

    head = p.split("?", 1)[0]
    if (
        not re.match(r"^[a-z][a-z+.-]*://", p, flags=re.I)
        and p
        and not p.startswith("/")
        and "://" not in head
    ):
        p = "/" + p
    return p


def postman_path_segment_to_str(seg) -> str:
    """Postman v2.1 path[] entries can be strings or dicts with a 'value' field."""
    if seg is None:
        return ""
    if isinstance(seg, str):
        return seg
    if isinstance(seg, dict):
        v = seg.get("value")
        if isinstance(v, str):
            return v
        for k in ("path", "key", "description"):
            kk = seg.get(k)
            if isinstance(kk, str):
                return kk
        return ""
    return str(seg)


def join_postman_path_list(path_list):
    """Join Postman url.path; drop leading {{HOST}} / {{HAL_HOST}} segments."""
    segs = []
    for x in path_list:
        if x is None:
            continue
        s = postman_path_segment_to_str(x).strip().replace("\\", "/")
        s = s.strip("/")
        if s:
            segs.append(s)
    while segs:
        a = segs[0]
        if re.fullmatch(r"\{\{HOST\}\}", a, flags=re.I) or re.fullmatch(
            r"\{\{HAL_HOST\}\}", a, flags=re.I
        ):
            segs = segs[1:]
            continue
        if re.fullmatch(r"\{\{[^}]+\}\}", a):
            segs = segs[1:]
            continue
        break
    return "/" + "/".join(segs)


def path_structure_tokens(path: str):
    """
    Split a path into a tuple of segments: fixed strings, or None for a
    {parameter} placeholder.
    """
    normalized = normalize_path(path).strip()
    if not normalized:
        return tuple()
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    parts = [p for p in normalized.split("/") if p]
    tokens = []
    for part in parts:
        if len(part) >= 2 and part.startswith("{") and part.endswith("}"):
            tokens.append(None)
        elif len(part) >= 2 and part.startswith(":"):
            tokens.append(None)
        else:
            tokens.append(part)
    return tuple(tokens)


def swagger_postman_paths_match(swagger_path: str, postman_path: str) -> bool:
    """
    True if the two paths are the same route: literals must match; a {param}
    in Swagger matches any single segment in Postman (another {name} or a
    concrete value like 123).
    """
    spec_t = path_structure_tokens(swagger_path)
    req_t = path_structure_tokens(postman_path)
    if len(spec_t) != len(req_t):
        return False
    for spec_seg, req_seg in zip(spec_t, req_t):
        if spec_seg is None or req_seg is None:
            continue
        if spec_seg != req_seg:
            return False
    return True


def join_server_prefix_and_path(prefix: str, path: str) -> str:
    """Same rules as docs/app.js: OpenAPI base path + paths key."""
    raw = (path or "").strip()
    path_part = raw if raw.startswith("/") else "/" + raw
    pre = (prefix or "").strip().rstrip("/")
    if not pre or pre == "/":
        return path_part
    if not pre.startswith("/"):
        pre = "/" + pre
    return pre + path_part


def get_server_path_prefixes(swagger_json: dict):
    """Path prefixes from OpenAPI servers[] and Swagger 2 basePath; always ''."""
    out = {""}
    if not isinstance(swagger_json, dict):
        return sorted(out)
    for s in swagger_json.get("servers") or []:
        if not isinstance(s, dict):
            continue
        url = (s.get("url") or "").strip()
        if not url:
            continue
        try:
            parsed = urlparse(url)
            pathname = parsed.path or ""
            if len(pathname) > 1 and pathname.endswith("/"):
                pathname = pathname[:-1]
            if pathname == "/":
                pathname = ""
            out.add(pathname)
        except Exception:
            continue
    bp = swagger_json.get("basePath")
    if isinstance(bp, str) and bp.strip():
        bp = bp.strip()
        if not bp.startswith("/"):
            bp = "/" + bp
        if len(bp) > 1 and bp.endswith("/"):
            bp = bp[:-1]
        if bp != "/":
            out.add(bp)
    return sorted(out)


def swagger_operation_covered(
    method: str,
    swagger_path: str,
    prefixes,
    postman_endpoints,
) -> bool:
    """True if some Postman request matches this op (structural + server prefix variants)."""
    for pm, pp in postman_endpoints:
        if pm.upper() != method.upper():
            continue
        for prefix in prefixes:
            joined = join_server_prefix_and_path(prefix, swagger_path)
            if swagger_postman_paths_match(joined, pp):
                return True
    return False


def postman_request_matches_swagger(
    pm: str,
    pp: str,
    swagger_endpoints,
    prefixes,
) -> bool:
    for sm, sp in swagger_endpoints:
        if sm.upper() != pm.upper():
            continue
        for prefix in prefixes:
            joined = join_server_prefix_and_path(prefix, sp)
            if swagger_postman_paths_match(joined, pp):
                return True
    return False


def normalize_postman_url(raw_url, url_obj):
    """
    Extract a stable path from a Postman request URL.
    Prefer non-empty ``raw`` (full URL string) over ``path`` / ``host`` parts:
    Postman often puts ``v1`` in ``host`` and only resource segments in ``path``,
    so using ``path`` alone drops the ``/v1`` prefix vs OpenAPI.
    """
    raw = (raw_url or "").strip()
    if isinstance(url_obj, dict) and not raw:
        raw = (url_obj.get("raw") or "").strip()

    if raw:
        safe_raw = strip_postman_leading_base_noise(raw)
        safe_raw = safe_raw.replace("{{HOST}}", HOST)
        safe_raw = safe_raw.replace("{{HAL_HOST}}", HAL_HOST)
        parsed = urlparse(safe_raw)
        path = parsed.path or ""
        try:
            path = unquote(path)
        except Exception:
            pass
        if path and not path.startswith("/") and not parsed.scheme:
            path = "/" + path
        if path:
            return path

    if isinstance(url_obj, dict):
        path_list = url_obj.get("path")
        if isinstance(path_list, str) and path_list.strip():
            p = path_list.strip().replace("\\", "/")
            p = strip_postman_leading_base_noise(p)
            if not p.startswith("/"):
                p = "/" + p
            try:
                return unquote(p)
            except Exception:
                return p
        if isinstance(path_list, list) and path_list:
            p = join_postman_path_list(path_list)
            p = strip_postman_leading_base_noise(p)
            try:
                return unquote(p)
            except Exception:
                return p

    return ""

def unwrap_postman_collection(coll):
    """Some exports wrap the collection as {\"collection\": {info, item}}."""
    if not isinstance(coll, dict):
        return coll
    inner = coll.get("collection")
    if isinstance(inner, dict) and inner.get("info") and isinstance(inner.get("item"), list):
        return inner
    return coll


def extract_postman_requests(postman_collection):
    """
    Extract (method, path) tuples from the Postman .json collection.
    Supports nested folders of any depth.
    """
    postman_collection = unwrap_postman_collection(postman_collection)
    postman_endpoints = []
    total_requests = 0

    def walk_items(items):
        nonlocal total_requests
        for item in items:
            if "request" in item:
                method = item["request"].get("method", "").upper()
                url_field = item["request"].get("url", {})
                if isinstance(url_field, str):
                    raw_url = url_field
                    url_obj = {}
                elif isinstance(url_field, dict):
                    url_obj = url_field
                    raw_url = url_field.get("raw", "")
                else:
                    raw_url = ""
                    url_obj = {}
                path = normalize_postman_url(raw_url, url_obj)
                path = normalize_path(path)
                if method and path:
                    postman_endpoints.append((method, path))
                total_requests += 1
            if "item" in item:
                walk_items(item["item"])

    if "item" in postman_collection:
        walk_items(postman_collection["item"])
    return postman_endpoints, total_requests

def main():
    parser = argparse.ArgumentParser(
        description="API coverage report (Swagger vs Postman)."
    )
    parser.add_argument(
        "swagger",
        nargs="?",
        default=SWAGGER_URL,
        help="Swagger/OpenAPI JSON URL or file path",
    )
    parser.add_argument(
        "postman",
        nargs="?",
        default=POSTMAN_COLLECTION_URL,
        help="Postman collection JSON URL or file path",
    )
    args = parser.parse_args()

    swagger_url = args.swagger.strip()
    postman_url = args.postman.strip()

    print("\nFetching Swagger specification...")
    swagger_json = load_json(swagger_url)
    print("Fetching Postman collection...")
    postman_json = load_json(postman_url)

    swagger_endpoints = extract_swagger_paths(
        swagger_json, exclude_deprecated=EXCLUDE_DEPRECATED
    )
    postman_endpoints, postman_requests_total = extract_postman_requests(postman_json)
    prefixes = get_server_path_prefixes(swagger_json)

    covered_swagger = [
        (m, normalize_path(p))
        for m, p in swagger_endpoints
        if swagger_operation_covered(m, p, prefixes, postman_endpoints)
    ]
    covered_set = set(covered_swagger)
    missing = [
        (m, normalize_path(p))
        for m, p in swagger_endpoints
        if (m, normalize_path(p)) not in covered_set
    ]
    covered_unique = set(covered_swagger)

    matched_requests = [
        ep
        for ep in postman_endpoints
        if postman_request_matches_swagger(ep[0], ep[1], swagger_endpoints, prefixes)
    ]
    unmatched_requests = [
        ep
        for ep in postman_endpoints
        if not postman_request_matches_swagger(ep[0], ep[1], swagger_endpoints, prefixes)
    ]

    print("\n====== API AUTOMATION COVERAGE REPORT ======")
    total_apis = len(swagger_endpoints)
    print(f"Total APIs in Swagger: {total_apis}")
    print(f"Total API requests in Postman collection: {postman_requests_total}")
    print(f"Automated API requests (matched to Swagger): {len(matched_requests)}")
    print(f"Postman requests not in Swagger: {len(unmatched_requests)}")
    print(f"Remaining Swagger APIs (not covered): {len(missing)}")

    unique_automated = len(covered_unique)
    remaining_apis = len(missing)
    coverage_pct = (unique_automated / total_apis * 100) if total_apis else 0
    remaining_pct = (remaining_apis / total_apis * 100) if total_apis else 0

    print("\n+----------------------------------------+---------+")
    print("| Metric                                 | Value   |")
    print("+----------------------------------------+---------+")
    print(f"| Total APIs from Swagger                | {total_apis:<7} |")
    print("+----------------------------------------+---------+")
    print(f"| Total Automated tests                  | {postman_requests_total:<7} |")
    print("+----------------------------------------+---------+")
    print(f"| Total actual automated APIs            | {unique_automated:<7} |")
    print("+----------------------------------------+---------+")
    print(f"| Remaining APIs from Swagger            | {remaining_apis:<7} |")
    print("+----------------------------------------+---------+")
    print(f"| Automation Coverage (%)                | {coverage_pct:>6.2f}% |")
    print("+----------------------------------------+---------+")
    print(f"| Remaining Coverage (%)                 | {remaining_pct:>6.2f}% |")
    print("+----------------------------------------+---------+")

    # Optional: write coverage details to files
    with open("automated_apis.json", "w") as f:
        json.dump(list(covered_unique), f, indent=2)
    with open("automated_requests.json", "w") as f:
        json.dump(matched_requests, f, indent=2)
    with open("unmatched_requests.json", "w") as f:
        json.dump(unmatched_requests, f, indent=2)
    with open("missing_apis.json", "w") as f:
        json.dump(list(missing), f, indent=2)

    print("\nDetailed lists written to:")
    print(" - automated_apis.json        (automated Swagger endpoints)")
    print(" - automated_requests.json    (automated request items)")
    print(" - unmatched_requests.json    (Postman requests not in Swagger)")
    print(" - missing_apis.json          (Swagger endpoints not automated)")

if __name__ == "__main__":
    main()

