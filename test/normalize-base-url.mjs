import assert from "node:assert/strict";
import { normalizeBaseUrl } from "../dist/cli.js";

assert.equal(normalizeBaseUrl("outline.example.com"), "https://outline.example.com/api");
assert.equal(normalizeBaseUrl("outline.example.com/"), "https://outline.example.com/api");
assert.equal(normalizeBaseUrl("https://outline.example.com"), "https://outline.example.com/api");
assert.equal(normalizeBaseUrl("https://outline.example.com/api"), "https://outline.example.com/api");
assert.equal(normalizeBaseUrl("http://localhost:3000"), "http://localhost:3000/api");
assert.equal(normalizeBaseUrl(""), "https://app.getoutline.com/api");

console.log("normalize-base-url ok");
