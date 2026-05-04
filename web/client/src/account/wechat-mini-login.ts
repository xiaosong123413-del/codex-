/**
 * Mini-program WeChat login modal for desktop and browser shells.
 *
 * The modal renders a locally generated QR code and polls the account service
 * until the mini program confirms the one-time challenge.
 */
import QRCode from "qrcode";

export interface MiniWeChatLoginChallenge {
  loginId: string;
  pollToken: string;
  qrPayload: string;
  expiresAt: string;
}

export interface MiniWeChatAccountSession {
  accountId: string;
  token: string;
  expiresAt: string;
}

export interface MiniWeChatLoginPollResult {
  status: "pending" | "confirmed" | "expired";
  accountSession?: MiniWeChatAccountSession;
  error?: string;
}

interface MiniWeChatLoginOptions {
  start: () => Promise<MiniWeChatLoginChallenge>;
  poll: (challenge: MiniWeChatLoginChallenge) => Promise<MiniWeChatLoginPollResult>;
}

interface MiniWeChatLoginModal {
  root: HTMLElement;
  qr: HTMLImageElement;
  status: HTMLElement;
  dispose: () => void;
  isCanceled: () => boolean;
}

const POLL_INTERVAL_MS = 1500;

export async function runMiniWeChatLogin(options: MiniWeChatLoginOptions): Promise<MiniWeChatAccountSession> {
  const modal = createMiniWeChatLoginModal();
  document.body.appendChild(modal.root);
  try {
    modal.status.textContent = "正在生成登录二维码...";
    const challenge = await options.start();
    modal.qr.src = await QRCode.toDataURL(challenge.qrPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
    });
    modal.status.textContent = "请使用 LLM Wiki 微信小程序扫码确认登录";
    return await waitForMiniWeChatLogin(challenge, options.poll, modal);
  } finally {
    modal.dispose();
  }
}

// fallow-ignore-next-line complexity
async function waitForMiniWeChatLogin(
  challenge: MiniWeChatLoginChallenge,
  poll: MiniWeChatLoginOptions["poll"],
  modal: MiniWeChatLoginModal,
): Promise<MiniWeChatAccountSession> {
  while (true) {
    if (modal.isCanceled()) throw new Error("已取消微信扫码登录。");
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error("微信登录二维码已过期。");
    await delay(POLL_INTERVAL_MS);

    const result = await poll(challenge);
    if (result.status === "pending") continue;
    if (result.status === "expired") throw new Error(result.error ?? "微信登录二维码已过期。");
    if (result.accountSession) return result.accountSession;
    throw new Error(result.error ?? "微信登录确认失败。");
  }
}

function createMiniWeChatLoginModal(): MiniWeChatLoginModal {
  let canceled = false;
  const root = document.createElement("div");
  root.className = "wechat-mini-login";
  root.innerHTML = `
    <section class="wechat-mini-login__panel" role="dialog" aria-modal="true" aria-label="微信扫码登录">
      <div class="wechat-mini-login__title">微信扫码登录</div>
      <img class="wechat-mini-login__qr" alt="微信小程序登录二维码" />
      <div class="wechat-mini-login__status"></div>
      <button class="btn btn-secondary" type="button" data-wechat-mini-cancel>取消</button>
    </section>
  `;
  root.querySelector("[data-wechat-mini-cancel]")?.addEventListener("click", () => {
    canceled = true;
  });
  return {
    root,
    qr: root.querySelector<HTMLImageElement>(".wechat-mini-login__qr")!,
    status: root.querySelector<HTMLElement>(".wechat-mini-login__status")!,
    dispose: () => root.remove(),
    isCanceled: () => canceled,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
