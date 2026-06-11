# scanSecurity

AI-powered web security scanner. Phát hiện HTTP error pages (4xx, 5xx, fake-200) và kiểm tra HTTP security headers bằng AI agent (GPT-5.2).

## Kiến trúc

```
scanSecurity/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── agent.ts              # ReAct AI agent loop
│   ├── ai.ts                 # Client gọi localhost:3000/v1/chat/completions
│   ├── config.ts             # CLI argument parser
│   ├── cookie-jar.ts         # Cookie management
│   ├── types.ts              # TypeScript types
│   └── tools/
│       ├── registry.ts       # Tool definitions + dispatcher (8 tools)
│       ├── requester.ts      # request() + batch_request()
│       ├── crawler.ts        # crawl() web spider
│       ├── auth.ts           # login() form authentication
│       ├── analyzer.ts       # analyze() error page detection
│       ├── header-scanner.ts # check_headers() HTTP security header audit
│       ├── payload.ts        # generate_payload() attack payloads
│       └── reporter.ts       # report() + export JSON/CSV
└── output/
    ├── findings.json
    └── findings.csv
```

## Yêu cầu

- [Bun](https://bun.sh) >= 1.0
- AI API (OpenAI-compatible) tại `http://localhost:3000/v1/chat/completions` (mặc định)

## Cài đặt

```bash
bun install
```

## Sử dụng

### Scan cơ bản (public pages)

```bash
bun run src/index.ts --url https://target.com
```

### Scan có đăng nhập

```bash
bun run src/index.ts --url https://target.com \
  --username admin \
  --password secret
```

### Scan với đầy đủ tùy chọn

```bash
bun run src/index.ts --url https://target.com \
  --username admin \
  --password secret \
  --login-url https://target.com/login \
  --model gpt-5.2 \
  --api http://localhost:3000/v1/chat/completions \
  --depth 3 \
  --max-urls 500 \
  --concurrency 5 \
  --output ./results \
  --max-iterations 100
```

## AI Agent Tools

| Tool | Mô tả |
|---|---|
| `crawl` | Crawl website, trả về tất cả URLs cùng domain |
| `request` | Gửi GET/POST với cookie tự động |
| `batch_request` | Test 10 URLs cùng lúc |
| `login` | Auto-detect form login + submit |
| `analyze` | Phát hiện error page (kể cả fake-200) |
| **`check_headers`** | **Kiểm tra HTTP security headers** |
| `generate_payload` | Sinh POST payload (empty, invalid, xss, sqli, overflow) |
| `report` | Ghi nhận + xuất JSON/CSV |

## Kiểm tra HTTP Headers

Tool `check_headers` phân tích HTTP response headers để phát hiện:

### Security headers được kiểm tra

| Header | Severity | Mô tả |
|---|---|---|
| `Strict-Transport-Security` (HSTS) | **HIGH** | Chống SSL stripping, force HTTPS |
| `Content-Security-Policy` (CSP) | **HIGH** | Chống XSS, control resources |
| `X-Frame-Options` | MEDIUM | Chống clickjacking |
| `X-Content-Type-Options` | MEDIUM | Chống MIME sniffing |
| `Cache-Control` | MEDIUM | Kiểm soát caching |
| `Access-Control-Allow-Origin` (CORS) | MEDIUM | Kiểm soát cross-origin |
| `Referrer-Policy` | LOW | Kiểm soát referrer leak |
| `Permissions-Policy` | LOW | Giới hạn browser features |

### Information disclosure headers

| Header | Mô tả |
|---|---|
| `Server` | Lộ server software + version |
| `X-Powered-By` | Lộ technology stack |
| `X-AspNet-Version` | Lộ ASP.NET version |

### Output

```
HTTP Security Header Score: 4/8 (50%) - 4 issue(s) found. Also found 2 information disclosure header(s)

MISSING HEADERS:
  - Strict-Transport-Security (HSTS) - HIGH
  - Content-Security-Policy (CSP) - HIGH
  - Cache-Control - MEDIUM

MISCONFIGURED:
  - X-Frame-Options: SAMEORIGIN (OK)

INFO DISCLOSURE:
  - Server: nginx/1.24.0 (LOW)
  - X-Powered-By: Express (LOW)
```

## Error page detection

Tool `analyze` phát hiện:
- **4xx errors**: 400, 401, 403, 404, 405, 429
- **5xx errors**: 500, 502, 503, 504
- **Fake-200 errors**: Status 200 nhưng nội dung chứa error indicators (stack trace, exception message, error page patterns)

## Output files

### findings.json
```json
{
  "scan_time": "2026-06-11T10:30:00.000Z",
  "total_findings": 15,
  "findings": [
    {
      "url": "https://target.com/admin",
      "status_code": 403,
      "method": "GET",
      "error_type": "403",
      "confidence": 0.95,
      "details": "HTTP 403 + Forbidden pattern detected",
      "timestamp": "2026-06-11T10:30:00.000Z"
    }
  ]
}
```

### findings.csv
```csv
url,status_code,method,error_type,confidence,details,timestamp
"https://target.com/admin",403,"GET","403",0.95,"HTTP 403 forbidden","2026-06-11T10:30:00.000Z"
```

## Tùy chọn CLI

| Option | Default | Mô tả |
|---|---|---|
| `--url` | (required) | Target website |
| `--username` | - | Login username |
| `--password` | - | Login password |
| `--login-url` | auto-detect | Login page URL |
| `--model` | `gpt-5.2` | AI model name |
| `--api` | `http://localhost:3000/v1/chat/completions` | AI API endpoint |
| `--depth` | `2` | Crawl depth |
| `--max-urls` | `500` | Max URLs to crawl |
| `--concurrency` | `5` | Concurrent requests |
| `--output` | `./output` | Output directory |
| `--max-iterations` | `100` | Max AI agent iterations |
| `--help` | - | Show help |

## Flow

```
User input → AI Agent (GPT-5.2) → Tool calls → Results → Loop until done
     ↓                                                          ↓
  Login → Crawl → Test URLs → Analyze → Check Headers → Report → Export JSON/CSV
```
