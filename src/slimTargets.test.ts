import test from "node:test";
import assert from "node:assert/strict";
import {
  slimCapabilityFor,
  canApplySlim,
  canPreviewSlim,
  MARKDOWN_FAMILY_LANG_IDS,
} from "./slimTargets.js";

// --- markdown family → apply (also previewable) -----------------------------

test("markdown-family languageIds are apply-capable (#50)", () => {
  for (const id of MARKDOWN_FAMILY_LANG_IDS) {
    assert.equal(
      slimCapabilityFor(id, "/tmp/whatever.xyz"),
      "apply",
      `languageId ${id} should be apply-capable`
    );
  }
});

test("markdown by extension is apply-capable even with a plaintext languageId", () => {
  assert.equal(slimCapabilityFor("plaintext", "/tmp/a.md"), "apply");
  assert.equal(slimCapabilityFor("plaintext", "/tmp/a.markdown"), "apply");
  // case-insensitive extension match
  assert.equal(slimCapabilityFor("plaintext", "/tmp/A.MD"), "apply");
});

test("apply implies preview for markdown", () => {
  assert.equal(canApplySlim("markdown", "/tmp/a.md"), true);
  assert.equal(canPreviewSlim("markdown", "/tmp/a.md"), true);
});

// --- YAML → preview only ----------------------------------------------------

test("YAML is preview-only, never apply (#50 data-safety)", () => {
  assert.equal(slimCapabilityFor("yaml", "/tmp/k8s.yaml"), "preview");
  assert.equal(slimCapabilityFor("plaintext", "/tmp/k8s.yaml"), "preview");
  assert.equal(slimCapabilityFor("plaintext", "/tmp/ci.yml"), "preview");
  assert.equal(slimCapabilityFor("plaintext", "/tmp/CI.YML"), "preview");

  assert.equal(canApplySlim("yaml", "/tmp/k8s.yaml"), false);
  assert.equal(canPreviewSlim("yaml", "/tmp/k8s.yaml"), true);
});

// --- JSON / JSONC → preview only --------------------------------------------

test("JSON and JSONC are preview-only, never apply (#50)", () => {
  assert.equal(slimCapabilityFor("json", "/tmp/mcp.json"), "preview");
  assert.equal(slimCapabilityFor("jsonc", "/tmp/mcp.jsonc"), "preview");
  assert.equal(slimCapabilityFor("plaintext", "/tmp/mcp.json"), "preview");
  assert.equal(slimCapabilityFor("plaintext", "/tmp/mcp.jsonc"), "preview");

  assert.equal(canApplySlim("json", "/tmp/mcp.json"), false);
  assert.equal(canPreviewSlim("json", "/tmp/mcp.json"), true);
});

// --- everything else → none -------------------------------------------------

test("unrelated file types are not slim targets", () => {
  assert.equal(slimCapabilityFor("go", "/tmp/main.go"), "none");
  assert.equal(slimCapabilityFor("typescript", "/tmp/x.ts"), "none");
  assert.equal(slimCapabilityFor("plaintext", "/tmp/notes.txt"), "none");

  assert.equal(canApplySlim("go", "/tmp/main.go"), false);
  assert.equal(canPreviewSlim("go", "/tmp/main.go"), false);
});

// --- languageId beats a bare/unknown extension ------------------------------

test("languageId classification is honoured regardless of extension", () => {
  // A markdown buffer with no extension (e.g. untitled) is still apply-capable.
  assert.equal(slimCapabilityFor("markdown", "/tmp/Untitled-1"), "apply");
  // A yaml buffer with no yaml extension is still preview-capable.
  assert.equal(slimCapabilityFor("yaml", "/tmp/values"), "preview");
});

// --- data-safety hardening: config extension is never apply ------------------

test("a config-format extension is preview-only even under a manual markdown language override (#50)", () => {
  // `tokopt slim` routes by extension → TOON, so a .yaml/.json file can never
  // be safely overwritten in place, no matter how the buffer is classified.
  assert.equal(slimCapabilityFor("markdown", "/tmp/config.yaml"), "preview");
  assert.equal(slimCapabilityFor("markdown", "/tmp/config.yml"), "preview");
  assert.equal(slimCapabilityFor("markdown", "/tmp/mcp.json"), "preview");
  assert.equal(slimCapabilityFor("agent", "/tmp/data.jsonc"), "preview");

  assert.equal(canApplySlim("markdown", "/tmp/config.yaml"), false);
  assert.equal(canPreviewSlim("markdown", "/tmp/config.yaml"), true);
});
