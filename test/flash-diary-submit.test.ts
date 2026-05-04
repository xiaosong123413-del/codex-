import { describe, expect, it } from "vitest";
import { buildFlashDiarySubmission } from "../desktop-webui/src/flash-diary-submit.js";

const LONG_DOUYIN_SHARE_TEXT = [
  "2.07 NwF:/ 03/27 u@S.yT 我没想到居然有评委和观众哭了# 中山大学 # 比赛现场 # 演讲 # 文化传承 # 广西",
  "二编：①我在台上看到评委老师摘了几次眼镜，我紧张地以为是我的展示太无聊。",
  "②这个演讲很有意义，我真的真的真诚地希望大家能够认真听完。",
  "⑥散场的时候还有一个漂亮妹妹过来跟我说她听我的演讲听哭了，我的天呐我好感动。",
  "⑩我看到大家的评论了，真的很感动于有这么多人跟我共鸣。",
  "⑫希望大家专注于中华优秀传统文化，专注于我国各地区优秀的传统文化，谢谢大家配合！",
  "https://v.douyin.com/WN-2CwOCEg0/ 复制此链接，打开Dou音搜索，直接观看视频！",
].join(" ");

describe("flash diary clipping submission routing", () => {
  it("routes xiaohongshu clipping text to SmartClip MCP", () => {
    const submission = buildFlashDiarySubmission({
      target: "clipping",
      text: "我想存这个\nhttps://www.xiaohongshu.com/discovery/item/69e5e4880000000023022e76?xsec_token=test",
      mediaPaths: [],
    });

    expect(submission.endpoint).toBe("smartclip-mcp");
    expect(submission.body).toMatchObject({
      url: "https://www.xiaohongshu.com/discovery/item/69e5e4880000000023022e76?xsec_token=test",
      body: "我想存这个\nhttps://www.xiaohongshu.com/discovery/item/69e5e4880000000023022e76?xsec_token=test",
    });
  });

  it("routes generic clipping links to SmartClip MCP", () => {
    const submission = buildFlashDiarySubmission({
      target: "clipping",
      text: "https://x.com/example/status/123",
      mediaPaths: [],
    });

    expect(submission.endpoint).toBe("smartclip-mcp");
    expect(submission.body).toMatchObject({
      url: "https://x.com/example/status/123",
    });
  });

  it("keeps the clipping url and user comment in separate fields", () => {
    const submission = buildFlashDiarySubmission({
      target: "clipping",
      text: "",
      clippingUrl: "https://x.com/example/status/456",
      clippingComment: "用于研究这条视频的开场结构",
      mediaPaths: ["C:/tmp/frame.png"],
    });

    expect(submission.endpoint).toBe("smartclip-mcp");
    expect(submission.body).toMatchObject({
      url: "https://x.com/example/status/456",
      body: "用于研究这条视频的开场结构",
      mediaPaths: ["C:/tmp/frame.png"],
    });
  });

  it("keeps pasted clipping media on text-only clipping submissions", () => {
    const submission = buildFlashDiarySubmission({
      target: "clipping",
      text: "",
      clippingComment: "临时素材，后续整理成案例",
      mediaPaths: ["C:/tmp/pasted.mp4"],
    });

    expect(submission.endpoint).toBe("api/source-gallery/create");
    expect(submission.body).toMatchObject({
      type: "clipping",
      body: "临时素材，后续整理成案例",
      mediaPaths: ["C:/tmp/pasted.mp4"],
    });
  });

  it("extracts a clean douyin short link from share text", () => {
    const submission = buildFlashDiarySubmission({
      target: "clipping",
      text: "0.00 jCu:/ 05/21 f@O.KJ 深圳打工十年，35岁中登裸辞计划 https://v.douyin.com/pdtrF_y67Hq/复制此链接，打开Dou音搜索，直接观看视频！",
      mediaPaths: [],
    });

    expect(submission.endpoint).toBe("smartclip-mcp");
    expect(submission.body).toMatchObject({
      url: "https://v.douyin.com/pdtrF_y67Hq/",
    });
  });

  it("keeps long douyin share text while extracting only the short link", () => {
    const submission = buildFlashDiarySubmission({
      target: "clipping",
      text: LONG_DOUYIN_SHARE_TEXT,
      mediaPaths: [],
    });

    expect(submission.endpoint).toBe("smartclip-mcp");
    expect(submission.body).toMatchObject({
      url: "https://v.douyin.com/WN-2CwOCEg0/",
      body: LONG_DOUYIN_SHARE_TEXT,
    });
  });

  it("keeps clipping text without links on the source gallery create endpoint", () => {
    const submission = buildFlashDiarySubmission({
      target: "clipping",
      text: "只是一些想法",
      mediaPaths: [],
    });

    expect(submission.endpoint).toBe("api/source-gallery/create");
    expect(submission.body).toMatchObject({
      type: "clipping",
      body: "只是一些想法",
    });
  });

  it("keeps flash diary submissions on the flash diary endpoint", () => {
    const payload = {
      target: "flash-diary" as const,
      text: "今天的记录",
      mediaPaths: ["C:/tmp/a.png"],
    };
    const submission = buildFlashDiarySubmission(payload);

    expect(submission.endpoint).toBe("api/flash-diary/entry");
    expect(submission.body).toEqual(payload);
  });
});
