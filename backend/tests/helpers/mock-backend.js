// In-memory stand-in for Supabase (PostgREST) and Cloudflare R2 (S3 API), so the
// real server and the real SDKs can be tested end to end without any cloud accounts.
import http from "node:http";

function decodeAwsChunked(buffer) {
  const parts = [];
  let i = 0;
  while (i < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", i);
    const size = parseInt(buffer.subarray(i, lineEnd).toString().split(";")[0], 16);
    if (!size) break;
    parts.push(buffer.subarray(lineEnd + 2, lineEnd + 2 + size));
    i = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const isChunked =
        (req.headers["x-amz-content-sha256"] || "").startsWith("STREAMING-") ||
        (req.headers["content-encoding"] || "").includes("aws-chunked");
      resolve(isChunked ? decodeAwsChunked(body) : body);
    });
  });
}

function rowMatches(row, params) {
  for (const [column, condition] of params) {
    if (["select", "columns", "on_conflict", "limit", "order"].includes(column)) continue;
    const [operator, ...rest] = condition.split(".");
    const value = rest.join(".");
    if (operator === "eq" && String(row[column]) !== value) return false;
    if (operator === "neq" && String(row[column]) === value) return false;
    if (operator === "lt" && !(String(row[column]) < value)) return false;
  }
  return true;
}

export function startMockBackend() {
  const objects = new Map();
  const multipartUploads = new Map();
  const tables = {
    upload_tokens: [],
    files: [],
    file_recipients: [],
    public_keys: [],
  };
  const usedNonces = new Set();

  function handleRpc(name, args) {
    switch (name) {
      case "consume_upload_token": {
        const index = tables.upload_tokens.findIndex(
          (t) => t.file_id === args.p_file_id && t.token_hash === args.p_token_hash,
        );
        if (index < 0) return false;
        tables.upload_tokens.splice(index, 1);
        return true;
      }
      case "consume_ownership_nonce":
        if (usedNonces.has(args.p_nonce)) return false;
        usedNonces.add(args.p_nonce);
        return true;
      case "get_file_metadata":
        return tables.files
          .filter((f) => f.id === args.lookup_id)
          .map((f) => ({ metadata: f.metadata }));
      case "get_encrypted_key_for_recipient":
        return (
          tables.file_recipients.find(
            (r) =>
              r.file_id === args.lookup_file_id &&
              r.recipient_fingerprint === args.lookup_fingerprint,
          )?.encrypted_key ?? null
        );
      default:
        return null;
    }
  }

  function handleSupabase(req, res, url, body) {
    const json = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)/);
    if (rpc) return json(200, handleRpc(rpc[1], JSON.parse(body.toString() || "{}")));

    const table = url.pathname.match(/^\/rest\/v1\/(\w+)/)[1];
    const rows = tables[table] ?? (tables[table] = []);
    const params = [...url.searchParams];

    if (req.method === "GET") {
      const found = rows.filter((row) => rowMatches(row, params));
      if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
        return found.length === 1
          ? json(200, found[0])
          : json(406, { code: "PGRST116", message: "0 rows", details: "", hint: null });
      }
      return json(200, found);
    }

    if (req.method === "POST") {
      const incoming = JSON.parse(body.toString());
      const upsert = (req.headers.prefer || "").includes("merge-duplicates");
      for (const row of Array.isArray(incoming) ? incoming : [incoming]) {
        const key = row.id ?? row.file_id;
        const existing = rows.findIndex((r) => (r.id ?? r.file_id) === key);
        if (existing >= 0 && table !== "file_recipients") {
          if (!upsert) return json(409, { code: "23505", message: "duplicate key" });
          rows[existing] = row;
        } else {
          rows.push(row);
        }
      }
      return json(201);
    }

    if (req.method === "DELETE") {
      tables[table] = rows.filter((row) => !rowMatches(row, params));
      return json(204);
    }

    return json(404, {});
  }

  function handleS3(req, res, url, body) {
    const key = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));
    const query = url.searchParams;
    const xml = (status, content) => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>${content}`);
    };

    if (req.method === "POST" && query.has("uploads")) {
      const uploadId = `upload-${multipartUploads.size + 1}`;
      multipartUploads.set(uploadId, new Map());
      return xml(
        200,
        `<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
      );
    }
    if (req.method === "PUT" && query.has("partNumber")) {
      multipartUploads
        .get(query.get("uploadId"))
        .set(Number(query.get("partNumber")), body);
      res.writeHead(200, { etag: `"part-${query.get("partNumber")}"` });
      return res.end();
    }
    if (req.method === "POST" && query.has("uploadId")) {
      const parts = multipartUploads.get(query.get("uploadId"));
      const ordered = [...parts.keys()].sort((a, b) => a - b);
      objects.set(key, Buffer.concat(ordered.map((n) => parts.get(n))));
      return xml(
        200,
        `<CompleteMultipartUploadResult><Location>x</Location><Bucket>b</Bucket><Key>${key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`,
      );
    }
    if (req.method === "DELETE" && query.has("uploadId")) {
      multipartUploads.delete(query.get("uploadId"));
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "PUT") {
      objects.set(key, body);
      res.writeHead(200, { etag: '"object"' });
      return res.end();
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }

    const object = objects.get(key);
    const headers = {
      etag: '"object"',
      "last-modified": new Date(0).toUTCString(),
      "content-length": object?.length,
    };
    if (req.method === "HEAD") {
      res.writeHead(object ? 200 : 404, object ? headers : {});
      return res.end();
    }
    if (!object) {
      return xml(404, "<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>");
    }
    res.writeHead(200, { ...headers, "content-type": "application/octet-stream" });
    return res.end(object);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const body = await readBody(req);
    if (url.pathname.startsWith("/rest/v1/")) handleSupabase(req, res, url, body);
    else handleS3(req, res, url, body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
        objects,
        tables,
      });
    });
  });
}
