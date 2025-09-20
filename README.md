# DNS Server / Monitor

This project is a lightweight DNS forwarder with logging, blacklist management, optional Discord alerts and now AdGuard filter list support.

## Features

- UDP DNS forwarder (IPv4 / IPv6 sockets) with multi-upstream failover
- Query logging to SQLite (WAL) with retention policy
- Web dashboard + SSE live updates
- Manual blacklist (exact domains & suffix matching for subdomains)
- AdGuard / hosts style blocklist ingestion
- Discord alerts for upstream issues (optional)
- Two blocking policies: NXDOMAIN or NULL (0.0.0.0 / ::)

## AdGuard List Support

You can configure one or more public filter list URLs (AdGuard style or hosts file style). On startup and at a periodic interval the lists are downloaded, parsed and every extracted domain is added to the internal blacklist (duplicates ignored).

Supported line formats:
- `||example.com^` (typical AdGuard domain rule)
- `0.0.0.0 example.com` or `127.0.0.1 example.com` (hosts)
- Plain `example.com` lines
- Lines starting with `!` or `#` are ignored (comments)

Currently unsupported / ignored:
- Cosmetic rules / element hiding
- Script/network modifiers ($third-party, $important, etc.)
- Wildcards beyond the base domain extraction

### Configuration Keys

Add to `config.json` (or via environment variables):

```
"ADGUARD_LIST_URLS": [
  "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt",
  "https://someone/hosts.txt"
],
"ADGUARD_REFRESH_MIN": 120
```

Environment variable equivalents:
- `ADGUARD_LIST_URLS` (comma separated)
- `ADGUARD_REFRESH_MIN` (minutes, default 120)

### API Endpoints

- `GET /api/adguard/status` – Returns last fetch timestamp, number of domains loaded and errors if any.
- `POST /api/adguard/refresh` – Forces immediate refresh.

## Running

Install dependencies and start:

```
npm install
npm start
```

Point your clients to this server's IP on UDP/53 and open the dashboard on the configured HTTP port.

## Blocking Policy

- `NXDOMAIN`: Respond with NXDOMAIN for blocked domains
- `NULL`: Respond with 0.0.0.0 / :: for A / AAAA queries

Configure using `BLOCK_POLICY` in `config.json` or environment.

## Notes

- Download errors do not stop the DNS service; previous blacklist entries remain.
- Domains loaded from lists are merged into the same blacklist used for manual entries.
- Refresh timer keeps running in the background (unref'd interval).

## Future Ideas

- ETag / Last-Modified conditional fetches
- Partial wildcard support beyond base host extraction
- UI management for filter list URLs

## License

MIT (see headers if provided or adapt as needed)
