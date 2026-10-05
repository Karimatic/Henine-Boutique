import { describe, expect, it } from "vitest";
import { sniffAudio } from "./media";

const bytes = (head: string | number[], size = 16) => {
  const b = new Uint8Array(size);
  b.set(typeof head === "string" ? [...head].map((ch) => ch.charCodeAt(0)) : head);
  return b;
};

describe("sniffAudio (shop order sound)", () => {
  it("knows MP3, OGG, WAV and M4A from their first bytes", () => {
    expect(sniffAudio(bytes("ID3\u0004"))).toBe("mp3");
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90, 0x44]))).toBe("mp3");
    expect(sniffAudio(bytes("OggS"))).toBe("ogg");
    expect(sniffAudio(bytes("RIFF\0\0\0\0WAVEfmt "))).toBe("wav");
    expect(sniffAudio(bytes("\0\0\0\u0020ftypM4A "))).toBe("m4a");
  });
  it("refuses anything else, whatever its name", () => {
    expect(sniffAudio(bytes("<html><script>"))).toBeNull();
    expect(sniffAudio(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // a JPEG photo
  });
});
