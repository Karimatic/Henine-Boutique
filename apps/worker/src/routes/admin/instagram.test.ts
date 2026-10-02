import { describe, expect, it } from "vitest";
import { isInstagramCdn } from "./instagram";

describe("Instagram photo proxy", () => {
  it("only fetches Instagram / Facebook CDN addresses", () => {
    expect(isInstagramCdn("https://scontent.cdninstagram.com/v/t51/123_n.jpg?stp=x")).toBe(true);
    expect(isInstagramCdn("https://scontent-mrs2-1.cdninstagram.com/v/abc.jpg")).toBe(true);
    expect(isInstagramCdn("https://scontent.xx.fbcdn.net/v/abc.jpg")).toBe(true);
    expect(isInstagramCdn("http://scontent.cdninstagram.com/v/abc.jpg")).toBe(false);
    expect(isInstagramCdn("https://cdninstagram.com.evil.example/x.jpg")).toBe(false);
    expect(isInstagramCdn("https://evil.example/?u=cdninstagram.com")).toBe(false);
    expect(isInstagramCdn("https://127.0.0.1/x.jpg")).toBe(false);
    expect(isInstagramCdn("not a url")).toBe(false);
  });
});
