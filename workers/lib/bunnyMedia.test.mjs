import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadMediaUploadConfig,
  bunnyConfigured,
  bunnyUploadInbox,
  finalizeChoiceStills,
  MEDIA_REPO_KEYS,
} from "./bunnyMedia.mjs";

describe("bunnyMedia per-repo destination", () => {
  let root;
  let prevRoot;
  let prevKey;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "bunny-media-"));
    prevRoot = process.env.TICKETS_REGIONS_ROOT;
    prevKey = process.env.BUNNY_STORAGE_API_KEY;
    process.env.TICKETS_REGIONS_ROOT = root;
    for (const key of MEDIA_REPO_KEYS) {
      mkdirSync(join(root, key), { recursive: true });
      writeFileSync(
        join(root, key, "media-upload.json"),
        JSON.stringify({
          schema: "myproblem.media-upload.v1",
          provider: "bunny",
          storage_zone: "myproblem-stills",
          cdn_host: "https://myproblem-stills.b-cdn.net",
          storage_host: "storage.bunnycdn.com",
          path_prefix: key,
        }) + "\n",
      );
    }
  });

  after(() => {
    if (prevRoot === undefined) delete process.env.TICKETS_REGIONS_ROOT;
    else process.env.TICKETS_REGIONS_ROOT = prevRoot;
    if (prevKey === undefined) delete process.env.BUNNY_STORAGE_API_KEY;
    else process.env.BUNNY_STORAGE_API_KEY = prevKey;
    rmSync(root, { recursive: true, force: true });
  });

  it("loads georgia/israel/fixit path prefixes from media-upload.json", () => {
    for (const key of MEDIA_REPO_KEYS) {
      const cfg = loadMediaUploadConfig(key);
      assert.equal(cfg.ok, true);
      assert.equal(cfg.storage_zone, "myproblem-stills");
      assert.equal(cfg.path_prefix, key);
      assert.equal(cfg.cdn_host, "https://myproblem-stills.b-cdn.net");
    }
  });

  it("rejects unknown repo keys", () => {
    const cfg = loadMediaUploadConfig("mars");
    assert.equal(cfg.ok, false);
  });

  it("bunnyConfigured requires API key", () => {
    delete process.env.BUNNY_STORAGE_API_KEY;
    assert.equal(bunnyConfigured("georgia"), false);
    process.env.BUNNY_STORAGE_API_KEY = "test-key";
    assert.equal(bunnyConfigured("georgia"), true);
  });

  it("finalizeChoiceStills deletes unused cache and requires scrub confirm", async () => {
    const cacheDir = join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    const keepFp = join(cacheDir, "keep.jpg");
    const dropFp = join(cacheDir, "drop.jpg");
    writeFileSync(keepFp, Buffer.from("keep-bytes"));
    writeFileSync(dropFp, Buffer.from("drop-bytes"));
    const purged = [];
    const tip = {
      ticket_uuid: "11111111-1111-1111-1111-111111111111",
      region: "georgia",
      evidence: [
        {
          id: "keep",
          kind: "still",
          uri: "cache://keep.jpg",
          choice: true,
        },
        {
          id: "drop",
          kind: "still",
          uri: "cache://drop.jpg",
          choice: false,
        },
      ],
    };

    const denied = await finalizeChoiceStills(tip, {
      choice_ids: ["keep"],
      confirm_scrubbed: false,
      resolveCache: (uri) => join(cacheDir, uri.slice("cache://".length)),
      purgeUri: (uri) => purged.push(uri),
      readFile: (fp) => readFileSync(fp),
    });
    assert.equal(denied.errors[0]?.error, "scrub_not_confirmed");
    assert.equal(denied.deleted.includes("drop"), true);
    assert.ok(purged.includes("cache://drop.jpg"));

    // Without a real Bunny PUT, expect upload error when confirm is true and key set.
    process.env.BUNNY_STORAGE_API_KEY = "test-key";
    const tip2 = {
      ticket_uuid: "11111111-1111-1111-1111-111111111111",
      region: "georgia",
      evidence: [
        {
          id: "keep",
          kind: "still",
          uri: "cache://keep.jpg",
        },
      ],
    };
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("ok", { status: 201, statusText: "Created" });
    try {
      const linked = await finalizeChoiceStills(tip2, {
        choice_ids: ["keep"],
        confirm_scrubbed: true,
        resolveCache: (uri) => join(cacheDir, uri.slice("cache://".length)),
        purgeUri: () => {},
        readFile: (fp) => readFileSync(fp),
      });
      assert.equal(linked.linked.length, 1);
      assert.match(linked.linked[0].uri, /georgia\/tickets\//);
      assert.equal(tip2.evidence[0].choice, true);
      assert.equal(tip2.evidence[0].scrubbed, true);
      assert.match(tip2.evidence[0].uri, /^https:\/\/myproblem-stills\.b-cdn\.net\//);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("uploads video into the private inbox path, not the public stills path", async () => {
    process.env.BUNNY_STORAGE_API_KEY = "test-key";
    const origFetch = globalThis.fetch;
    let putUrl = "";
    globalThis.fetch = async (url) => {
      putUrl = String(url);
      return new Response("ok", { status: 201 });
    };
    try {
      const up = await bunnyUploadInbox(
        "georgia",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "vid1",
        Buffer.from("fake-mp4"),
        "mp4",
        "video/mp4",
      );
      assert.equal(up.ok, true);
      assert.match(up.path, /\/inbox\/tickets\//);
      assert.match(putUrl, /\/inbox\/tickets\//);
      assert.match(up.uri, /storage\.bunnycdn\.com/);
      assert.equal(up.uri.includes("b-cdn.net"), false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
